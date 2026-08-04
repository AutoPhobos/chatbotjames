import { smallTalk } from './smalltalk.js';
import { toolRouter } from './tool-router.js';
import { ChessGame, CheckersGame } from './game-logic.js';
import { renderGameBoard } from './game-ui.js';
import { CONFIG } from './config.js';
import { BUILD_NUMBER } from './build.js';

let activeGame = null;
let activeGameUI = null;

// ─── IndexedDB Chat Storage ──────────────────────────────────────────────────
// Replaces safeLocalStorage for chat history — no 5 MB limit, async, fast.

const IDB_NAME = 'james-chats-db';
const IDB_STORE = 'chats';
let _idb = null;

async function openChatDB() {
    if (_idb) return _idb;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
        req.onerror = (e) => reject(e.target.error);
    });
}

/** Fire-and-forget: persist a single chat to IndexedDB. */
function dbSaveChat(chat) {
    if (!chat) return;
    openChatDB()
        .then(db => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(chat);
        })
        .catch(e => console.warn('IDB save failed:', e));
}

/** Fire-and-forget: delete a chat from IndexedDB by id. */
function dbDeleteChat(id) {
    openChatDB()
        .then(db => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).delete(id);
        })
        .catch(e => console.warn('IDB delete failed:', e));
}

/** Load all chats, sorted newest-first (id is a timestamp). */
async function dbLoadAllChats() {
    try {
        const db = await openChatDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).getAll();
            req.onsuccess = (e) => {
                const chats = (e.target.result || []).sort((a, b) => b.id - a.id);
                resolve(chats);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('IDB load failed, falling back to empty state:', e);
        return [];
    }
}

/**
 * One-time migration: move existing safeLocalStorage chats into IndexedDB,
 * then clear the old key so this only runs once.
 */
async function migrateFromLocalStorage() {
    const raw = safeLocalStorage.getItem('chatbot-chats');
    if (!raw) return;
    try {
        const chats = JSON.parse(raw);
        if (Array.isArray(chats) && chats.length > 0) {
            console.log(`📦 Migrating ${chats.length} chat(s) from safeLocalStorage → IndexedDB…`);
            await openChatDB();
            for (const chat of chats) dbSaveChat(chat);
            safeLocalStorage.removeItem('chatbot-chats');
            console.log('✅ Migration complete');
        }
    } catch (e) {
        console.warn('safeLocalStorage migration failed:', e);
    }
}

// ─── Screen Wake Lock ───────────────────────────────────────────────────
// Keeps the screen on during model downloads, which can take several minutes.

let _wakeLock = null;

async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || _wakeLock) return;
    try {
        _wakeLock = await navigator.wakeLock.request('screen');
        // Browser may release it on tab-switch; re-acquire on return
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
        document.addEventListener('visibilitychange', _onWakeLockVisibilityChange);
        console.log('🔆 Screen Wake Lock acquired');
    } catch (e) {
        console.warn('Wake Lock unavailable:', e.message);
    }
}

function _onWakeLockVisibilityChange() {
    if (document.visibilityState === 'visible') acquireWakeLock();
}

function releaseWakeLock() {
    if (_wakeLock) {
        _wakeLock.release().catch(() => {});
        _wakeLock = null;
        document.removeEventListener('visibilitychange', _onWakeLockVisibilityChange);
        console.log('🔅 Screen Wake Lock released');
    }
}

// ─── Virtual Scroll State ───────────────────────────────────────────────
const RENDER_WINDOW = CONFIG.ui.renderWindowMessages;  // max DOM-rendered messages at a time
let _renderOffset = 0;     // chatHistory index where the render window begins
let _chatObserver = null;  // IntersectionObserver watching the top sentinel

// ─── Sound Engine (Web Audio API, no external files) ─────────────────────────
const _audioCtx = new (window.AudioContext || window.webkitAudioContext)();

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupFileAttachment();
});

function _playTone({ freq = 440, type = 'sine', gainPeak = 0.18, duration = 0.12, rampUp = 0.01, rampDown = 0.10 } = {}) {
    try {
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, _audioCtx.currentTime);
        gain.gain.setValueAtTime(0, _audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(gainPeak, _audioCtx.currentTime + rampUp);
        gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + duration);
        osc.start(_audioCtx.currentTime);
        osc.stop(_audioCtx.currentTime + duration + 0.02);
    } catch (e) { /* silently ignore if AudioContext not ready */ }
}

function playSendSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 880, type: 'sine', gainPeak: 0.10, duration: 0.10, rampUp: 0.005, rampDown: 0.09 });
}

function playDoneSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 523.25, type: 'sine', gainPeak: 0.10, duration: 0.18, rampUp: 0.01 }); // C5
    setTimeout(() => _playTone({ freq: 783.99, type: 'sine', gainPeak: 0.08, duration: 0.22, rampUp: 0.01 }), 120); // G5
}
// ─────────────────────────────────────────────────────────────────────────────

// Cached DOM elements for performance during tight rendering loops
let _progressFillEl = null;
let _statusMetaEl = null;

// Initialize Workers
let worker = new Worker('worker.js', { type: 'module' });
const toolsWorker = new Worker('tools-worker.js', { type: 'module' });
const pythonWorker = new Worker('python-worker.js');
const pythonCallbacks = new Map();

// UI References
const cmdInput = document.getElementById('cmdInput')
    || document.getElementById('userInput')
    || document.getElementById('user-input');

const sendBtn = document.getElementById('sendBtn')
    || document.getElementById('sendButton')
    || document.getElementById('send-button');

/**
 * Modern UI Toggle
 * Manages the "Redesign" state and interaction locks
 */
let _isGeneratingUI = false;
function setIdleState(isIdle) {
    try {
        if (isIdle) {
            cmdInput.disabled = false;
            sendBtn.innerHTML = '➔';
            sendBtn.classList.remove('stop-btn');
            _isGeneratingUI = false;

            cmdInput.classList.remove('loading-state');
            cmdInput.placeholder = "Message JAMES...";
            cmdInput.focus();
        } else {
            cmdInput.disabled = true;
            sendBtn.innerHTML = '⏹';
            sendBtn.classList.add('stop-btn');
            sendBtn.disabled = false;
            _isGeneratingUI = true;

            cmdInput.classList.add('loading-state');
            cmdInput.placeholder = "JAMES is busy...";
        }
    }
    catch (err) { console.log(err); }
}

// Global State & Message Handlers
let lastUpdate = 0;
let _gpuInfo = null;
let _presets = [];
let _activePresetId = null;
let _selectedPresetId = null;
let _deviceRamGB = 4;
let attachedFiles = [];

// ─── Word-by-word Streaming Animation ────────────────────────────────────────
const streamQueues = new Map();

function queueStreamText(targetId, fullText) {
    if (!streamQueues.has(targetId)) {
        streamQueues.set(targetId, { pending: fullText, displayed: '', running: false });
    } else {
        streamQueues.get(targetId).pending = fullText;
    }
    const state = streamQueues.get(targetId);
    if (!state.running) drainStreamQueue(targetId);
}

function drainStreamQueue(targetId) {
    const state = streamQueues.get(targetId);
    if (!state || state.displayed.length >= state.pending.length) {
        if (state) state.running = false;
        return;
    }
    state.running = true;

    const from = state.displayed.length;
    state.displayed = state.pending.slice(0, from + 1);
    updateLiveBubble(state.displayed, targetId);

    setTimeout(() => drainStreamQueue(targetId), CONFIG.ui.streamRenderIntervalMs);
}

function flushStreamQueue(targetId) {
    const state = streamQueues.get(targetId);
    if (state) updateLiveBubble(state.pending, targetId, true);
    streamQueues.delete(targetId);
}

// ─── Window Memory Helper ───────────────────────────────────────────────────
const MAX_HISTORY = CONFIG.ui.maxHistory;
const MAX_TOOL_DEPTH = CONFIG.ui.maxToolDepth; // Max consecutive tool call cycles before breaking the loop
let _toolCallDepth = 0;

function getMessagesWindow(messages) {
    if (!messages || messages.length <= MAX_HISTORY) {
        // Strip leading assistant message (e.g. welcome msg) so the model
        // always receives a history that starts with a user turn.
        if (messages && messages.length > 0 && messages[0].role !== 'user') {
            return messages.slice(1);
        }
        return messages;
    }
    let sliced = messages.slice(-MAX_HISTORY);
    if (sliced.length > 0 && sliced[0].role !== 'user') {
        sliced = sliced.slice(1);
    }
    return sliced;
}

// Unified Worker Message Handler
function workerMessageHandler(e) {
    const { status, message, loaded, total, file, targetId } = e.data;
    const statusText = document.getElementById('statusText');

    if (status === 'done' || status === 'complete' || status === 'error' || status === 'aborted') {
        setIdleState(true);
        updateStatusLight('idle');
        if (statusText) statusText.textContent = 'READY';
        if (status !== 'error' && status !== 'aborted') playDoneSound();
        // Release wake lock once the model finishes loading (success or failure)
        if (status === 'done' || status === 'error') releaseWakeLock();
    } else {
        setIdleState(false);
        updateStatusLight('thinking');
        if (status === 'thinking' && statusText) statusText.textContent = 'THINKING...';
        if (status === 'streaming' && statusText) statusText.textContent = 'RESPONDING...';
        // Acquire wake lock during model download / warm-start (can take minutes)
        if (status === 'downloading' || status === 'warm-start') acquireWakeLock();
    }

    switch (status) {
        case 'clear-last-preset':
            safeLocalStorage.removeItem('james-last-preset-id');
            console.log('🗑️ Cleared stale last-preset cache');
            break;

        case 'model-info': {
            _gpuInfo = e.data.gpuInfo;
            _presets = e.data.presets;
            _deviceRamGB = e.data.ramGB ?? 4;
            renderModelPanel();
            break;
        }

        case 'warm-start': {
            const preset = e.data.preset;
            const meta = document.querySelector('.status-meta');
            if (meta) meta.innerText = `Resuming: ${preset.label}…`;
            if (statusText) statusText.textContent = `RESUMING ${preset.label.toUpperCase()}…`;
            break;
        }

        case 'downloading': {
            const now = Date.now();
            if (now - lastUpdate < 100) return;
            lastUpdate = now;

            const percent = total ? (loaded / total * 100) : 0;
            _progressFillEl = _progressFillEl || document.querySelector('.progress-fill');
            _statusMetaEl = _statusMetaEl || document.querySelector('.status-meta');

            if (_progressFillEl) _progressFillEl.style.width = `${percent}%`;
            if (_statusMetaEl) {
                const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
                const mbTotal = (total / 1024 / 1024).toFixed(1);
                _statusMetaEl.innerText = `Downloading: ${file || 'weights'} (${mbLoaded}/${mbTotal} MB)`;
            }
            if (statusText) statusText.textContent = `DOWNLOADING (${Math.round(percent)}%)...`;
            break;
        }

        case 'done': {
            _statusMetaEl = _statusMetaEl || document.querySelector('.status-meta');
            const backend = e.data.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
            const deviceTag = e.data.isTV ? ' · TV Mode' : e.data.isMobile ? ' · Lightweight Mode' : '';
            if (_statusMetaEl) _statusMetaEl.innerText = `JAMES is online (${backend}${deviceTag})`;

            _progressFillEl = _progressFillEl || document.querySelector('.progress-fill');
            if (_progressFillEl) _progressFillEl.style.width = "100%";
            if (statusText) statusText.textContent = 'READY';

            const runningPreset = _presets.find(
                p => p.backend === e.data.backend && p.dtype === e.data.dtype && p.model === e.data.model
            );
            if (runningPreset) {
                _activePresetId = runningPreset.id;
                _selectedPresetId = runningPreset.id;
                safeLocalStorage.setItem('james-last-preset-id', runningPreset.id);
                refreshPresetCards();
                const lbl = document.getElementById('activeModelLabel');
                if (lbl) lbl.textContent = `Active: ${runningPreset.label}`;
                const applyBtn = document.getElementById('applyModelBtn');
                if (applyBtn) applyBtn.disabled = true;
            }
            break;
        }

        case 'streaming':
            if (e.data.chatId === currentChatId) {
                queueStreamText(targetId, message);
            }
            break;

        case 'thinking':
            if (e.data.chatId === currentChatId) {
                updateLiveBubble("...", targetId);
            }
            break;

        case 'complete':
            flushStreamQueue(targetId);
            handleToolCalls(message, targetId, e.data.chatId);
            break;

        case 'aborted': {
            flushStreamQueue(targetId);
            if (e.data.chatId === currentChatId && message) {
                // If there's partial text generated before the abort, keep it in the history
                updateLiveBubble(message, targetId);
                chatHistory.push({ role: 'assistant', content: message });
                persistCurrentChat();
            } else if (e.data.chatId !== currentChatId && message) {
                const bgChat = allChats.find(c => c.id === e.data.chatId);
                if (bgChat) {
                    bgChat.messages.push({ role: 'assistant', content: message });
                    dbSaveChat(bgChat);
                }
            }
            break;
        }

        case 'error': {
            const errorText = typeof message === 'string' ? message : JSON.stringify(message);
            console.error('James Error payload:', e.data);

            if (errorText.includes('Instance reference no longer exists') || errorText.includes('failed to call OrtRun')) {
                appendErrorToChat("WebGPU Context Lost (GPU crashed or ran out of memory). Reloading the page in 3 seconds to recover...");
                setTimeout(() => window.location.reload(), 3000);
            } else {
                appendErrorToChat(errorText);
            }

            const metaErr = document.querySelector('.status-meta');
            if (metaErr) metaErr.innerText = `Error initializing or generating: ${errorText}`;
            if (statusText) statusText.textContent = 'ERROR';
            break;
        }
    }
}
worker.onmessage = workerMessageHandler;


function initWorker() {
    if (worker) {
        worker.terminate();
    }
    worker = new Worker('worker.js', { type: 'module' });
    // Re-attach the message handler so the new worker isn't silent
    worker.onmessage = workerMessageHandler;
    // Re-initialize the model so the new worker is fully operational
    const _lastPreset = safeLocalStorage.getItem('james-last-preset-id');
    worker.postMessage({ type: 'init', lastPresetId: _lastPreset || null });
}

// ─── File Attachment & Plaintext View ───────────────────────────────────────

function setupFileAttachment() {
    const attachButton = document.getElementById('attachButton') || document.getElementById('attach-button');
    const fileInput = document.getElementById('fileInput') || document.getElementById('file-input');

    if (attachButton && fileInput) {
        attachButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
            fileInput.value = '';
        });
    }
}

function handleFilesSelected(files) {
    const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-httpd-php|x-sh|x-python|yaml|toml|csv|rtf|sql|typescript))/i;
    Array.from(files).forEach(file => {
        // Warn if file is likely binary (not a recognisable text type)
        if (file.type && !TEXT_TYPES.test(file.type)) {
            appendErrorToChat(`⚠️ "${file.name}" appears to be a binary file (${file.type || 'unknown type'}). Only plain-text files can be attached. Try exporting as .txt or .csv.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            attachedFiles.push({
                name: file.name,
                content: e.target.result // Read as plaintext string
            });
            renderAttachmentPreviews();
        };
        reader.readAsText(file);
    });
}


function renderAttachmentPreviews() {
    const previewContainer = document.getElementById('attachmentPreview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';
    attachedFiles.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';
        chip.innerHTML = `
            <span>📄 ${escapeHTML(file.name)}</span>
            <button type="button" onclick="window.removeAttachment(${index})">&times;</button>
        `;
        previewContainer.appendChild(chip);
    });
}

window.removeAttachment = function (index) {
    attachedFiles.splice(index, 1);
    renderAttachmentPreviews();
};

// ─── Message Sending & Archiving ────────────────────────────────────────────

function sendMessage() {
    const text = cmdInput.value.trim();
    if ((!text && attachedFiles.length === 0) || _isGeneratingUI) return;

    let fullPrompt = text;
    if (attachedFiles.length > 0) {
        let fileContext = "\n\n[Attached Files Content]:\n";
        attachedFiles.forEach(file => {
            fileContext += `\n--- START FILE: ${file.name} ---\n${file.content}\n--- END FILE: ${file.name} ---\n`;
        });
        fullPrompt = (text ? text + "\n" : "Please analyze the attached file(s):") + fileContext;
    }

    const displayMessage = text + (attachedFiles.length > 0 ? ` [Attached: ${attachedFiles.map(f => f.name).join(', ')}]` : '');

    // Store fullPrompt in history so the model actually receives file content
    chatHistory.push({ role: 'user', content: fullPrompt });
    // Show only the display message in the UI (not raw file content)
    appendUserMessage(displayMessage);

    cmdInput.value = '';
    const filesToSend = [...attachedFiles];
    attachedFiles = [];
    renderAttachmentPreviews();
    persistCurrentChat();

    playSendSound();
    sendBtn.classList.add('sending');
    sendBtn.addEventListener('animationend', () => sendBtn.classList.remove('sending'), { once: true });

    if (currentChatId) {
        const chat = allChats.find(c => c.id === currentChatId);
        if (chat && chat.name === 'New Chat') {
            const titleSource = text || attachedFiles.map(f => f.name).join(', ') || 'File upload';
            chat.name = titleSource.substring(0, 30) + (titleSource.length > 30 ? '...' : '');
            dbSaveChat(chat);
            updateChatList();
            updateChatListActive(currentChatId);
        }
    }

    if (filesToSend.length === 0) {
        const canned = smallTalk.match(text);
        if (canned) {
            simulateCannedResponse(canned);
            return;
        }

        const toolMatch = toolRouter.match(text);
        if (toolMatch) {
            const simulatedAssistantMessage = "```tool:run\n" + toolMatch.tool + "\n" + Object.entries(toolMatch.params).map(([k,v]) => `${k}: ${v}`).join('\n') + "\n```";
            setIdleState(false);
            updateStatusLight('thinking');
            const statusText = document.getElementById('statusText');
            if (statusText) statusText.textContent = 'ROUTING...';
            
            const targetId = Date.now();
            updateLiveBubble('...', targetId);
            
            setTimeout(() => {
                handleToolCalls(simulatedAssistantMessage, targetId, currentChatId);
            }, 300);
            return;
        }
    }

    setIdleState(false);
    const messagesForModel = getMessagesWindow(chatHistory);

    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId: Date.now(),
        chatId: currentChatId
    });
}

function setupEventListeners() {
    const sendButton = document.getElementById('sendBtn') || document.getElementById('sendButton');
    const inputField = document.getElementById('cmdInput') || document.getElementById('userInput');
    const stopButton = document.getElementById('stopButton') || document.getElementById('stop-button');

    if (sendButton && inputField) {
        sendButton.addEventListener('click', () => {
            if (_isGeneratingUI) {
                handleStopGeneration();
            } else {
                sendMessage();
            }
        });
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!_isGeneratingUI) sendMessage();
            }
        });
    }

    if (stopButton) {
        stopButton.addEventListener('click', handleStopGeneration);
    }
}

function handleStopGeneration() {
    if (!_isGeneratingUI) return;

    if (worker) {
        worker.postMessage({ type: 'abort' });
    }
    
    // Reset tool call depth so next conversation starts fresh
    _toolCallDepth = 0;

    // Immediately set UI to idle state to stop thinking animation
    setIdleState(true);
    updateStatusLight('idle');
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.textContent = 'READY';
    
    streamQueues.forEach((_, targetId) => flushStreamQueue(targetId));
}

function scrollToBottom() {
    const chatContainer = document.getElementById('chatLog') || document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// ─── Tool Execution Handler ─────────────────────────────────────────────────

async function handleToolCalls(message, targetId, originChatId) {
    const toolCalls = parseToolCalls(message);

    if (toolCalls.length === 0) {
        // Reset tool depth when we get a plain response (no tool calls)
        _toolCallDepth = 0;

        let interceptedGameMove = false;
        if (activeGame && originChatId === currentChatId) {
            // Try to parse the AI's response as a game move
            const moveMade = activeGame.makeSanMove(message);
            if (moveMade) {
                if (activeGameUI) activeGameUI.update();
                interceptedGameMove = true;
            } else if (message.includes('[Game State]')) {
               // AI failed to make a valid move. We could auto-retry, but for now just let the user see the text.
            }
        }

        if (originChatId === currentChatId) {
            updateLiveBubble(message, targetId);
            chatHistory.push({ role: 'assistant', content: message });
            persistCurrentChat();
        } else {
            const bgChat = allChats.find(c => c.id === originChatId);
            if (bgChat) {
                bgChat.messages.push({ role: 'assistant', content: message });
                dbSaveChat(bgChat);
            }
        }
        return;
    }

    // Guard against infinite tool call loops
    _toolCallDepth++;
    if (_toolCallDepth > MAX_TOOL_DEPTH) {
        _toolCallDepth = 0;
        console.warn(`Tool call depth exceeded (${MAX_TOOL_DEPTH}). Breaking loop.`);
        const loopError = `[Tool loop broken after ${MAX_TOOL_DEPTH} consecutive tool calls. Please try rephrasing your question.]`;
        if (originChatId === currentChatId) {
            updateLiveBubble(loopError, targetId);
            chatHistory.push({ role: 'assistant', content: loopError });
            persistCurrentChat();
        }
        setIdleState(true);
        updateStatusLight('idle');
        return;
    }

    const toolResults = [];
    for (const call of toolCalls) {
        try {
            const result = await executeTool(call.tool, call.params);
            toolResults.push({ tool: call.tool, result });
        } catch (error) {
            toolResults.push({ tool: call.tool, error: error.message });
        }
    }

    const toolResultText = toolResults.map(r =>
        r.error
            ? `[${r.tool} error]:${r.error}`
            : `[${r.tool} result]:${JSON.stringify(r.result)}`
    ).join('\n');

    const assistantToolTurn = { role: 'assistant', content: message };
    const toolResultTurn = { role: 'user', content: toolResultText };

    if (originChatId === currentChatId) {
        chatHistory.push(assistantToolTurn, toolResultTurn);
    } else {
        const bgChat = allChats.find(c => c.id === originChatId);
        if (bgChat) bgChat.messages.push(assistantToolTurn, toolResultTurn);
    }
    // Persist whichever chat was modified
    if (originChatId === currentChatId) {
        persistCurrentChat();
    } else {
        const bgChatToSave = allChats.find(c => c.id === originChatId);
        if (bgChatToSave) dbSaveChat(bgChatToSave);
    }

    const activeMessages = originChatId === currentChatId
        ? chatHistory
        : (allChats.find(c => c.id === originChatId)?.messages || []);

    if (originChatId === currentChatId) {
        // Ensure the original message with the tool call block is visible
        updateLiveBubble(message, targetId);
    }

    const messagesForModel = getMessagesWindow(activeMessages);
    const nextTargetId = Date.now(); // Create a new bubble for the follow-up response

    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId: nextTargetId,
        chatId: originChatId
    });
}

function parseToolCalls(text) {
    const toolRegex = /```\s*tool:run\s*([\s\S]*?)(?:\s*```|$)/g;
    const calls = [];
    let match;
    while ((match = toolRegex.exec(text)) !== null) {
        try {
            const lines = match[1].trim().split('\n');
            if (lines.length > 0) {
                const toolName = lines[0].trim();
                const params = {};
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const colonIdx = line.indexOf(':');
                    if (colonIdx !== -1) {
                        const key = line.substring(0, colonIdx).trim();
                        let value = line.substring(colonIdx + 1).trim();

                        if (value === 'true') value = true;
                        else if (value === 'false') value = false;
                        else if (!isNaN(Number(value)) && value !== '') value = Number(value);

                        params[key] = value;
                    }
                }
                calls.push({ tool: toolName, params });
            }
        } catch (e) {
            console.error('Failed to parse tool call:', match[1], e);
        }
    }
    return calls;
}

async function executeTool(toolName, params) {
    if (toolName === 'start_game') {
        const gameType = params.game;
        activeGame = gameType === 'checkers' ? new CheckersGame() : new ChessGame();
        
        setTimeout(() => {
            const chatLog = document.getElementById('chatLog');
            activeGameUI = renderGameBoard(activeGame, chatLog, (moveInfo) => {
                const aiPrompt = activeGame.type === 'chess' 
                    ? `[Game State] Current FEN: ${activeGame.getFen()}. You are playing Black. The user just moved. What is your next move in standard algebraic notation (e.g. e5, Nf6)? Use the make_move tool.`
                    : `[Game State] Current Checkers Board: ${activeGame.getFen()}. You are playing Black (b/B). The user just moved. What is your next move in 'from_r,from_c to to_r,to_c' format? Use the make_move tool.`;
                
                chatHistory.push({ role: 'user', content: aiPrompt });
                appendUserMessage(`[Moved piece]`);
                persistCurrentChat();
                
                setIdleState(false);
                const messagesForModel = getMessagesWindow(chatHistory);
                worker.postMessage({
                    type: 'query',
                    messages: messagesForModel,
                    targetId: Date.now(),
                    chatId: currentChatId
                });
            });
        }, 500);

        return { status: "game_started", game: gameType };
    }

    if (toolName === 'make_move') {
        if (!activeGame) throw new Error("No active game to make a move in.");
        const moveStr = String(params.move || '');
        const moveMade = activeGame.makeSanMove(moveStr);
        if (moveMade) {
            if (activeGameUI) activeGameUI.update();
            return { status: "moved", move: moveStr, newState: activeGame.getFen() };
        } else {
            throw new Error(`Invalid or illegal move: ${moveStr}. Please check the board state and try a valid move.`);
        }
    }

    if (toolName === 'search_web' || toolName === 'web_search') {
        try {
            return await import('./tools-search.js').then(m => m.performWebSearch(params.query || params.q));
        } catch (error) {
            throw new Error('Web search failed: ' + error.message);
        }
    }
    if (toolName === 'location') {
        try {
            return await import('./tools-bridge.js').then(m => m.getLocation());
        } catch (error) {
            throw new Error('Location access failed: ' + error.message);
        }
    }
    if (toolName === 'clipboard') {
        try {
            const content = await import('./tools-bridge.js').then(m => m.readClipboard());
            return { content, length: content.length };
        } catch (error) {
            throw new Error('Clipboard access failed: ' + error.message);
        }
    }
    if (toolName === 'python') {
        if (!params || !params.code) throw new Error('Python tool requires a code parameter');
        return new Promise((resolve, reject) => {
            const execId = crypto.randomUUID();
            let timeoutId;
            const handler = (e) => {
                if (e.data.execId === execId) {
                    clearTimeout(timeoutId);
                    pythonWorker.removeEventListener('message', handler);
                    e.data.status === 'done'
                        ? resolve(e.data.output)
                        : reject(new Error(e.data.error || 'Python execution failed'));
                }
            };
            pythonWorker.addEventListener('message', handler);
            pythonWorker.postMessage({ type: 'run', code: params.code, execId });
            timeoutId = setTimeout(() => {
                pythonWorker.removeEventListener('message', handler);
                reject(new Error('Python execution timed out'));
            }, 30000);
        });
    }

    return new Promise((resolve, reject) => {
        const execId = crypto.randomUUID();
        let timeoutId;
        const handler = (e) => {
            if (e.data.execId === execId) {
                clearTimeout(timeoutId);
                toolsWorker.removeEventListener('message', handler);
                if (e.data.status === 'done') resolve(e.data.result);
                else if (e.data.status === 'error') reject(new Error(e.data.error));
            }
        };
        toolsWorker.addEventListener('message', handler);
        toolsWorker.postMessage({ execId, tool: toolName, params });
        timeoutId = setTimeout(() => {
            toolsWorker.removeEventListener('message', handler);
            reject(new Error('Tool execution timeout'));
        }, 30000);
    });
}


pythonWorker.onmessage = (e) => {
    const { status, output, error, execId } = e.data;
    if (status === 'ready') { console.log('Python worker ready'); return; }
    const callback = pythonCallbacks.get(execId);
    if (!callback) return;
    pythonCallbacks.delete(execId);
    status === 'done' ? callback.resolve(output) : callback.reject(new Error(error || 'Python execution failed'));
};

function updateStatusLight(state) {
    const led = document.querySelector('.status-led');
    if (!led) return;
    led.className = state === 'idle' ? 'status-led led-idle' : 'status-led led-thinking';
}

function escapeHTML(raw) {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAssistantMessage(text) {
    const escaped = escapeHTML(text);
    return escaped
        .replace(/```\s*tool:run\n?([\s\S]*?)```/g, (_, code) => {
            const lines = code.trim().split('\n');
            const toolName = lines[0] || 'Unknown';
            const params = lines.slice(1).join('<br>');
            return `<div class="tool-usage-box" style="margin: 8px 0; padding: 10px; background: rgba(0,0,0,0.2); border-left: 3px solid #3b82f6; border-radius: 4px; font-family: monospace; font-size: 0.9em;">
                <div style="color: #60a5fa; font-weight: bold; margin-bottom: 4px;">🔧 Tool: ${toolName}</div>
                <div style="color: #94a3b8;">${params}</div>
            </div>`;
        })
        .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
        .replace(/(^|\n)######\s*(.+)/g, '$1<h6>$2</h6>')
        .replace(/(^|\n)#####\s*(.+)/g, '$1<h5>$2</h5>')
        .replace(/(^|\n)####\s*(.+)/g, '$1<h4>$2</h4>')
        .replace(/(^|\n)###\s*(.+)/g, '$1<h3>$2</h3>')
        .replace(/(^|\n)##\s*(.+)/g, '$1<h2>$2</h2>')
        .replace(/(^|\n)#\s*(.+)/g, '$1<h1>$2</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
            const cleanUrl = url.trim().toLowerCase().startsWith('javascript:') ? '#' : url.trim();
            return `<a href="${cleanUrl}" target="_blank" rel="noreferrer noopener">${text}</a>`;
        })
        .replace(/\n/g, '<br>');
}

function appendUserMessage(text) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    const messageWrap = document.createElement('div');
    messageWrap.className = 'message-wrap user-msg';

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = text;

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-msg-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit this message';
    editBtn.onclick = () => window.editUserMessage(text);

    const container = document.createElement('div');
    container.className = 'user-msg-container';
    container.appendChild(editBtn);
    container.appendChild(messageContent);

    messageWrap.appendChild(container);
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;
}

window.editUserMessage = function (text) {
    if (_isGeneratingUI) return;
    const idx = chatHistory.findLastIndex(m => m.role === 'user' && m.content === text);
    if (idx !== -1) {
        chatHistory = chatHistory.slice(0, idx);
        persistCurrentChat();
        cmdInput.value = text;
        cmdInput.focus();
        renderChatLog();
    }
};

let _lastRenderTime = 0;
function updateLiveBubble(text, targetId, force = false) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    let bubble = document.getElementById(`bubble-${targetId}`);

    if (!bubble) {
        const messageWrap = document.createElement('div');
        messageWrap.className = 'message-wrap assistant-msg';
        bubble = document.createElement('div');
        bubble.id = `bubble-${targetId}`;
        bubble.className = 'message-content';
        messageWrap.appendChild(bubble);
        chatLog.appendChild(messageWrap);
    }

    if (text === '...') {
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        return;
    }
    
    const now = Date.now();
    if (!force && now - _lastRenderTime < CONFIG.ui.throttleFpsMs) {
        return; // Throttle heavy markdown regexes to ~30fps
    }
    _lastRenderTime = now;

    bubble.innerHTML = formatAssistantMessage(text);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendErrorToChat(errorMessage) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    const messageWrap = document.createElement('div');
    messageWrap.className = 'message-wrap assistant-msg';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.style.borderColor = '#ef4444';
    messageContent.style.color = '#dc2626';
    messageContent.textContent = `⚠️ Error: ${errorMessage}`;
    messageWrap.appendChild(messageContent);
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;
}

async function simulateCannedResponse(canned, targetId = null) {
    if (!targetId) targetId = Date.now();
    const statusText = document.getElementById('statusText');

    setIdleState(false);
    updateStatusLight('thinking');
    if (statusText) statusText.textContent = 'THINKING...';
    updateLiveBubble('...', targetId);

    await new Promise(r => setTimeout(r, 400 + Math.random() * 500));

    // If the user stopped before we finished the thinking delay, bail out
    if (!_isGeneratingUI) return;

    if (statusText) statusText.textContent = 'RESPONDING...';
    queueStreamText(targetId, canned);

    const wordCount = canned.split(/\s+/).length;
    await new Promise(r => setTimeout(r, wordCount * 35 + 300));

    // Check again — user may have stopped during the stream animation
    if (!_isGeneratingUI) return;

    chatHistory.push({ role: 'assistant', content: canned });
    persistCurrentChat();
    setIdleState(true);
    updateStatusLight('idle');
    if (statusText) statusText.textContent = 'READY';
}

// ─── Chat History Management ────────────────────────────────────────────────

let chatHistory = [];
let allChats = [];
let currentChatId = null;

function isMobileDevice() {
    const ua = navigator.userAgent;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const isNarrowScreen = window.screen.width < 1024;
    const hasTouchPoints = navigator.maxTouchPoints > 1;
    return isMobileUA || (hasTouchPoints && isNarrowScreen);
}

function isTVDevice() {
    const ua = navigator.userAgent;
    return /SmartTV|SMART-TV|Tizen|WebOS|Web0S|HbbTV|BRAVIA|NetCast|Roku|AFT[A-Z]|CrKey|AppleTV|Android TV|googletv/i.test(ua);
}

function getLightweightWelcomeMessage(showTools = true) {
    const toolsBlock = showTools
        ? `\n───────────────\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🔍 search\n🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard\n───────────────\n`
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**\n🛡️ Runs entirely in this browser — nothing leaves your device.\n📱 Running in **lightweight mode** — tool use may be limited on this device.\n${toolsBlock}\n💬 Type a message below to begin.`
    };
}

function getFullWelcomeMessage(showTools = true) {
    const toolsBlock = showTools
        ? `───────────────\n\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🔍 search\n🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard\n───────────────\n\n`
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**\n🛡️ Runs entirely in this browser — nothing leaves your device.\n🔄 Every session starts fresh.\n\n${toolsBlock}💬 Type a message below to begin.`
    };
}

function getTVWelcomeMessage(showTools = true) {
    const toolsBlock = showTools
        ? `\n───────────────\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🔍 search\n🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard\n───────────────\n`
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**\n🛡️ Runs entirely in this browser — nothing leaves your device.\n📺 Running in **TV mode** — lightweight model loaded for this device.\n${toolsBlock}\n💬 Use a keyboard or remote to type a message below.`
    };
}

function getWelcomeMessage() {
    if (isTVDevice()) return getTVWelcomeMessage();
    if (isMobileDevice()) return getLightweightWelcomeMessage();
    return getFullWelcomeMessage();
}

function persistCurrentChat() {
    if (!currentChatId) return;
    const chat = allChats.find(c => c.id === currentChatId);
    if (chat) {
        chat.messages = [...chatHistory];
        dbSaveChat(chat); // fire-and-forget async IDB write
    }
}

function loadChatHistory(chatId) {
    const chat = allChats.find(c => c.id === chatId);
    if (!chat) return;

    persistCurrentChat();
    currentChatId = chatId;
    chatHistory = [...chat.messages];
    renderChatLog();
    updateChatListActive(currentChatId);
}

function startNewChat() {
    persistCurrentChat();

    const welcome = getWelcomeMessage();
    chatHistory = [welcome];

    const newChat = {
        id: Date.now(),
        name: 'New Chat',
        messages: [...chatHistory],
    };
    currentChatId = newChat.id;
    allChats.unshift(newChat);
    dbSaveChat(newChat);

    updateChatList();
    renderChatLog();
    updateChatListActive(currentChatId);
    if (cmdInput) cmdInput.focus();
}

/** Build a single message DOM element (shared by renderChatLog and loadOlderMessages). */
function createMessageElement(msg) {
    const messageWrap = document.createElement('div');
    messageWrap.className = `message-wrap ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    if (msg.role === 'assistant') {
        messageContent.innerHTML = formatAssistantMessage(msg.content);
        messageWrap.appendChild(messageContent);
    } else {
        messageContent.textContent = msg.content;
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-msg-btn';
        editBtn.innerHTML = '\u270f\ufe0f';
        editBtn.title = 'Edit this message';
        editBtn.onclick = () => window.editUserMessage(msg.content);
        const container = document.createElement('div');
        container.className = 'user-msg-container';
        container.appendChild(editBtn);
        container.appendChild(messageContent);
        messageWrap.appendChild(container);
    }
    return messageWrap;
}

/**
 * Renders the chat log with IntersectionObserver-driven virtual scrolling.
 * Only the most recent RENDER_WINDOW messages are in the DOM at once.
 * Scrolling to the top auto-loads older batches (20 at a time).
 */
function renderChatLog() {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;

    if (_chatObserver) { _chatObserver.disconnect(); _chatObserver = null; }
    chatLog.innerHTML = '';

    _renderOffset = Math.max(0, chatHistory.length - RENDER_WINDOW);

    if (_renderOffset > 0) {
        const sentinel = _makeSentinel();
        chatLog.appendChild(sentinel);
        _attachSentinelObserver(chatLog, sentinel);
    }

    chatHistory.slice(_renderOffset).forEach(msg => chatLog.appendChild(createMessageElement(msg)));
    chatLog.scrollTop = chatLog.scrollHeight;
}

/** Create the "N earlier messages" banner at the top of the chat log. */
function _makeSentinel() {
    const el = document.createElement('div');
    el.id = 'chat-sentinel';
    el.className = 'chat-sentinel';
    el.textContent = `\u2191 ${_renderOffset} earlier message${_renderOffset !== 1 ? 's' : ''} — scroll up to load`;
    return el;
}

function _attachSentinelObserver(chatLog, sentinel) {
    _chatObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) window.loadOlderMessages();
    }, { root: chatLog, rootMargin: '0px', threshold: 0.1 });
    _chatObserver.observe(sentinel);
}

/** Load the next batch of older messages when the sentinel scrolls into view. */
window.loadOlderMessages = function () {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog || _renderOffset === 0) return;

    const batchSize = Math.min(20, _renderOffset);
    const newOffset = _renderOffset - batchSize;
    const olderMsgs = chatHistory.slice(newOffset, _renderOffset);
    _renderOffset = newOffset;

    // Remove existing sentinel + observer before we mutate the DOM
    if (_chatObserver) { _chatObserver.disconnect(); _chatObserver = null; }
    document.getElementById('chat-sentinel')?.remove();

    const prevScrollHeight = chatLog.scrollHeight;
    const fragment = document.createDocumentFragment();

    if (_renderOffset > 0) {
        const newSentinel = _makeSentinel();
        fragment.appendChild(newSentinel);
    }
    olderMsgs.forEach(msg => fragment.appendChild(createMessageElement(msg)));
    chatLog.insertBefore(fragment, chatLog.firstChild);

    // Keep the user's viewport stable (no jump)
    chatLog.scrollTop = chatLog.scrollHeight - prevScrollHeight;

    // Re-attach observer if more messages remain
    if (_renderOffset > 0) {
        const newSentinel = document.getElementById('chat-sentinel');
        if (newSentinel) _attachSentinelObserver(chatLog, newSentinel);
    }
};

function updateChatList() {
    const chatListEl = document.getElementById('chatList');
    if (!chatListEl) return;
    chatListEl.innerHTML = '';
    allChats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chatId = chat.id;

        const chatText = document.createElement('span');
        chatText.textContent = chat.name;
        chatText.style.pointerEvents = 'none';

        chatItem.onclick = () => {
            loadChatHistory(chat.id);
            if (window.innerWidth <= 768) closeSidebar();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.className = 'delete-chat-btn';
        deleteBtn.onclick = (e) => { e.stopPropagation(); deleteChat(chat.id); };

        chatItem.appendChild(chatText);
        chatItem.appendChild(deleteBtn);
        chatListEl.appendChild(chatItem);
    });
}

function updateChatListActive(chatId) {
    document.querySelectorAll('#chatList .chat-item').forEach(item => {
        item.classList.toggle('active', chatId != null && Number(item.dataset.chatId) === chatId);
    });
}

function deleteChat(chatId) {
    allChats = allChats.filter(c => c.id !== chatId);
    dbDeleteChat(chatId); // async remove from IndexedDB

    if (chatId === currentChatId) {
        currentChatId = null;
        if (allChats.length > 0) {
            loadChatHistory(allChats[0].id);
        } else {
            startNewChat();
        }
    } else {
        updateChatList();
        updateChatListActive(currentChatId);
    }
}

async function loadSavedChats() {
    await migrateFromLocalStorage(); // no-op after first run
    allChats = await dbLoadAllChats();
    if (allChats.length > 0) updateChatList();
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

// Bootstrap: load chats from IndexedDB before rendering anything
(async () => {
    await loadSavedChats();
    if (allChats.length > 0) {
        loadChatHistory(allChats[0].id);
    } else {
        startNewChat();
    }
})();

if (isTVDevice()) {
    document.body.classList.add('tv-mode');
    document.getElementById('sidebar')?.classList.add('collapsed');
}
if (window.innerWidth <= 768) document.getElementById('sidebar')?.classList.add('collapsed');

setIdleState(false);
const _savedLastPresetId = safeLocalStorage.getItem('james-last-preset-id');
worker.postMessage({
    type: 'init',
    lastPresetId: _savedLastPresetId || null,
});
pythonWorker.postMessage({ type: 'init' });

const statusTextEl = document.getElementById('statusText');
if (statusTextEl) {
    statusTextEl.textContent = _savedLastPresetId ? 'RESUMING LAST MODEL…' : 'INITIALIZING...';
}

// ─── Sidebar & Panel Controls ───────────────────────────────────────────────

const newChatBtn = document.getElementById('newChatBtn');
if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

function closeSidebar() {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('sidebarOverlay')?.classList.remove('visible');
}

document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const nowCollapsed = sidebar?.classList.toggle('collapsed');
    overlay?.classList.toggle('visible', !nowCollapsed);
});

document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

import('./tools-bridge.js').then(module => {
    module.setupToolsBridge({
        worker: toolsWorker,
        DOM: { log: document.getElementById('chatLog'), cmd: cmdInput },
        submit: sendMessage
    });
}).catch(() => { });

// ─── PWA Installation ────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
}

let deferredPrompt;
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const dismissBtn = document.getElementById('dismissInstallBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    if (!safeLocalStorage.getItem('james-pwa-dismissed')) {
        installBanner?.classList.remove('hidden');
    }
});

installBtn?.addEventListener('click', async () => {
    installBanner?.classList.add('hidden');
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
    }
});

dismissBtn?.addEventListener('click', () => {
    installBanner?.classList.add('hidden');
    safeLocalStorage.setItem('james-pwa-dismissed', 'true');
});

// ─── Model Selection Panel ────────────────────────────────────────────────────

const modelPanel = document.getElementById('modelPanel');
const modelPanelOverlay = document.getElementById('modelPanelOverlay');
const modelPanelBtn = document.getElementById('modelPanelBtn');
const modelPanelClose = document.getElementById('modelPanelClose');
const applyModelBtn = document.getElementById('applyModelBtn');

function openModelPanel() {
    modelPanel?.classList.add('open');
    modelPanelOverlay?.classList.add('visible');
}

function closeModelPanel() {
    modelPanel?.classList.remove('open');
    modelPanelOverlay?.classList.remove('visible');
}

modelPanelBtn?.addEventListener('click', openModelPanel);
modelPanelClose?.addEventListener('click', closeModelPanel);
modelPanelOverlay?.addEventListener('click', closeModelPanel);

function renderModelPanel() {
    const card = document.getElementById('gpuStatusCard');
    const icon = document.getElementById('gpuStatusIcon');
    const title = document.getElementById('gpuStatusTitle');
    const detail = document.getElementById('gpuStatusDetail');
    const badge = document.getElementById('gpuStatusBadge');

    if (_gpuInfo && card) {
        const { hasGpu, vendor, maxStorageMB, reason, isFallback } = _gpuInfo;

        if (hasGpu) {
            card.className = 'gpu-status-card gpu-ok';
            if (icon) icon.textContent = '🚀';
            if (title) title.textContent = 'GPU Acceleration Available';
            if (badge) badge.textContent = 'WebGPU';
        } else if (!navigator.gpu) {
            card.className = 'gpu-status-card gpu-none';
            if (icon) icon.textContent = '❌';
            if (title) title.textContent = 'WebGPU Not Supported';
            if (badge) badge.textContent = 'NO GPU';
        } else if (isFallback) {
            card.className = 'gpu-status-card gpu-warn';
            if (icon) icon.textContent = '⚠️';
            if (title) title.textContent = 'Software Adapter Only';
            if (badge) badge.textContent = 'SW ONLY';
        } else {
            card.className = 'gpu-status-card gpu-warn';
            if (icon) icon.textContent = '⚠️';
            if (title) title.textContent = 'Integrated GPU — CPU Fallback';
            if (badge) badge.textContent = 'CPU';
        }

        const vendorStr = vendor ? `Vendor: ${vendor}` : 'Vendor: hidden by browser';
        const bufStr = maxStorageMB ? ` · Buffer: ${maxStorageMB.toFixed(0)} MB` : '';
        const ramStr = `Device RAM: ~${_deviceRamGB} GB`;
        if (detail) detail.textContent = `${reason}\n${vendorStr}${bufStr} · ${ramStr}`;
    }

    const list = document.getElementById('modelPresetList');
    if (!list || !_presets.length) return;
    list.innerHTML = '';

    const GROUPS = [
        { key: 'gpu', title: '⚡ GPU · WebGPU', filter: p => p.requires === 'gpu' },
        { key: 'cpu', title: '🧠 CPU · WASM', filter: p => p.requires === 'cpu' && !p.id.startsWith('lite-') },
        { key: 'lite', title: '🪶 Lite · Constrained', filter: p => p.id.startsWith('lite-') },
    ];

    GROUPS.forEach(group => {
        const presets = _presets.filter(group.filter);
        if (!presets.length) return;

        const divider = document.createElement('div');
        divider.className = 'preset-group-title';
        divider.textContent = group.title;
        list.appendChild(divider);

        presets.forEach(preset => {
            const isRunning = preset.id === _activePresetId;
            const isSelected = preset.id === _selectedPresetId;

            let pillClass = 'pill-cpu';
            let pillText = 'CPU';
            if (preset.requires === 'gpu') { pillClass = 'pill-gpu'; pillText = 'GPU'; }
            if (preset.id.startsWith('lite-')) { pillClass = 'pill-lite'; pillText = 'LITE'; }
            if (isRunning) { pillClass = 'pill-active'; pillText = 'ACTIVE'; }

            const sizeStr = preset.sizeMB
                ? preset.sizeMB >= 1000
                    ? `${(preset.sizeMB / 1024).toFixed(1)} GB`
                    : `${preset.sizeMB} MB`
                : '';
            const ramStr = preset.ram ? `${preset.ram} RAM` : '';
            const metaStr = [preset.dtype.toUpperCase(), sizeStr, ramStr].filter(Boolean).join(' · ');
            const autoTag = preset.autoSelect !== false ? ' <span class="preset-auto-tag">AUTO</span>' : '';

            const el = document.createElement('div');
            el.className = [
                'preset-card',
                isSelected && !isRunning ? 'preset-selected' : '',
                isRunning ? 'preset-active-running' : '',
            ].filter(Boolean).join(' ');
            el.dataset.presetId = preset.id;

            el.innerHTML = `
                <div class="preset-info">
                    <div class="preset-label">${preset.label}${autoTag}</div>
                    <div class="preset-tags">${metaStr}</div>
                </div>
                <span class="preset-pill ${pillClass}">${pillText}</span>
                <div class="preset-check"></div>`;

            el.addEventListener('click', () => selectPreset(preset.id));
            list.appendChild(el);
        });
    });
}

function selectPreset(id) {
    _selectedPresetId = id;
    document.querySelectorAll('.preset-card').forEach(el => {
        const elId = el.dataset.presetId;
        el.classList.toggle('preset-selected', elId === id && elId !== _activePresetId);
        el.classList.toggle('preset-active-running', elId === _activePresetId);
    });
    if (applyModelBtn) applyModelBtn.disabled = (id === _activePresetId);
}

function refreshPresetCards() {
    if (document.getElementById('modelPresetList')?.children.length > 0) {
        renderModelPanel();
    }
}

applyModelBtn?.addEventListener('click', () => {
    if (!_selectedPresetId || _selectedPresetId === _activePresetId) return;
    closeModelPanel();

    const fill = document.querySelector('.progress-fill');
    if (fill) fill.style.width = '0%';
    const meta = document.querySelector('.status-meta');
    if (meta) meta.innerText = 'Loading selected model…';

    setIdleState(false);
    const statusTextEl = document.getElementById('statusText');
    if (statusTextEl) statusTextEl.textContent = 'LOADING MODEL…';

    worker.postMessage({ type: 'init', forcePresetId: _selectedPresetId });
});



