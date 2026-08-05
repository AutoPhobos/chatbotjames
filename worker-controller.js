class WorkerController {
    constructor() {
        this.worker = null;
        this.toolsWorker = null;
        this.pythonWorker = null;
        this.activeGenerations = new Map(); // chatId -> targetId

        // Callbacks
        this.onWorkerStatus = null; // (status, statusText, e)
        this.onModelInfo = null;
        this.onWarmStart = null;
        this.onDownloadProgress = null;
        this.onWorkerDone = null; // (e.data.backend)
        this.onStreaming = null; // (chatId, targetId, message)
        this.onThinking = null; // (chatId, targetId)
        this.onComplete = null; // (chatId, targetId, message)
        this.onAborted = null; // (chatId, targetId, message)
        this.onToolCalls = null; // (message, targetId, chatId)
    }

    initWorkers(safeLocalStorage) {
        this.worker = new Worker('worker.js?v=3', { type: 'module' });
        this.toolsWorker = new Worker('tools-worker.js?v=3', { type: 'module' });
        this.pythonWorker = new Worker('python-worker.js?v=3');

        this.worker.onmessage = this.workerMessageHandler.bind(this);
        this.worker.onerror = (e) => {
            console.error('WORKER ERROR:', e);
            if (this.onWorkerStatus) this.onWorkerStatus('error', 'Worker failed to load: ' + e.message, e);
        };

        const _lastPreset = safeLocalStorage ? safeLocalStorage.getItem('james-last-preset-id') : null;
        this.worker.postMessage({ type: 'init', lastPresetId: _lastPreset || null });
        this.toolsWorker.postMessage({ type: 'init', lastPresetId: _lastPreset || null });
        this.pythonWorker.postMessage({ type: 'init' });
    }

    postQuery(messages, targetId, chatId) {
        this.activeGenerations.set(chatId, targetId);
        this.worker.postMessage({
            type: 'query',
            messages: messages,
            targetId: targetId,
            chatId: chatId
        });
    }

    workerMessageHandler(e) {
        const { status, message, loaded, total, file, targetId, chatId } = e.data;

        if (this.onWorkerStatus) {
            this.onWorkerStatus(status, message, e);
        }

        switch (status) {
            case 'clear-last-preset':
                if (this.onWorkerDone) this.onWorkerDone(e.data);
                break;
            case 'model-info':
                if (this.onModelInfo) this.onModelInfo(e.data);
                break;
            case 'warm-start':
                if (this.onWarmStart) this.onWarmStart(e.data.preset);
                break;
            case 'downloading':
                if (this.onDownloadProgress) this.onDownloadProgress(loaded, total, file);
                break;
            case 'done':
                this._recoveryInitDone = true; // flag used for UI recovery check
                if (this.onWorkerDone) this.onWorkerDone(e.data);
                break;
            case 'streaming':
                if (this.onStreaming) this.onStreaming(chatId, targetId, message);
                break;
            case 'thinking':
                if (this.onThinking) this.onThinking(chatId, targetId);
                break;
            case 'complete':
                if (this.onComplete) this.onComplete(chatId, targetId, message);
                if (this.onToolCalls && message && /```\s*tool:run\n/.test(message)) {
                    this.onToolCalls(message, targetId, chatId);
                }
                break;
            case 'aborted':
                if (this.onAborted) this.onAborted(chatId, targetId, message);
                break;
        }
    }

    callWorkerRPC(targetWorker, messageData, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const reqId = Date.now() + Math.random().toString(36).substring(2);
            const msg = { ...messageData, execId: reqId };
            
            const timeout = setTimeout(() => {
                targetWorker.removeEventListener('message', listener);
                reject(new Error('Worker RPC Timeout'));
            }, timeoutMs);

            const listener = (e) => {
                if (e.data && e.data.execId === reqId) {
                    clearTimeout(timeout);
                    targetWorker.removeEventListener('message', listener);
                    if (e.data.error) reject(new Error(e.data.error));
                    else resolve(e.data.result);
                }
            };
            targetWorker.addEventListener('message', listener);
            targetWorker.postMessage(msg);
        });
    }
}

export const workerController = new WorkerController();
