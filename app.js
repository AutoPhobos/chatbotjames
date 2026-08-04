import { smallTalk } from './smalltalk.js';
import { toolRouter } from './tool-router.js';
import { ChessGame, CheckersGame, parseUserMove, extractAIMove } from './game-logic.js';
import { renderGameBoard } from './game-ui.js';
import { CONFIG } from './config.js';
import {
    safeLocalStorage,
    dbSaveChat,
    dbDeleteChat,
    dbLoadAllChats,
    migrateFromLocalStorage
} from './chat-db.js';
import {
    acquireWakeLock,
    releaseWakeLock,
    playSendSound,
    playDoneSound,
    playGameMoveSound,
    playGameWinSound,
    playGameLoseSound,
    playGameBuffSound
} from './audio-wakelock.js';
import {
    streamQueues,
    getNextTargetId,
    queueStreamText,
    flushStreamQueue
} from './stream-manager.js';
import {
    setupMessageRenderer,
    updateStatusLight,
    escapeHTML,
    appendUserMessage,
    updateLiveBubble,
    appendErrorToChat,
    renderChatLog
} from './message-renderer.js';
import {
    setupModelPanel,
    updateModelInfo,
    refreshPresetCards
} from './model-panel.js';

let activeGame = null;
let activeGameUI = null;

// UI State Locks
let _isGeneratingUI = false;
let lastUpdate = 0;
const activeGenerations = new Map(); // chatId -> targetId
let _gpuInfo = null;
let _presets = [];
let _activePresetId = null;
let _selectedPresetId = null;
let _deviceRamGB = 4;
let attachedFiles = [];

// Window Memory Helper
const MAX_HISTORY = CONFIG.ui.maxHistory;
const MAX_TOOL_DEPTH = CONFIG.ui.maxToolDepth;
let _toolCallDepth = 0;

// Chat History State
let chatHistory = [];
let allChats = [];
let currentChatId = null;

// Cached DOM elements
let _progressFillEl = null;
let _statusMetaEl = null;

// Initialize Workers
let worker = new Worker('worker.js?v=2', { type: 'module' });
const toolsWorker = new Worker('tools-worker.js', { type: 'module' });
const pythonWorker = new Worker('python-worker.js');

// UI References
const cmdInput = document.getElementById('cmdInput')
    || document.getElementById('userInput')
    || document.getElementById('user-input');

const sendBtn = document.getElementById('sendBtn')
    || document.getElementById('sendButton')
    || document.getElementById('send-button');

// Wire up Message Renderer callbacks
setupMessageRenderer({
    getChatHistory: () => chatHistory,
    getIsGenerating: () => _isGeneratingUI,
    onEditUserMsg: (historyIdx) => {
        if (historyIdx < 0 || historyIdx >= chatHistory.length) return;
        const msg = chatHistory[historyIdx];
        if (!msg || msg.role !== 'user') return;
        let originalText = msg.content;
        const fileMarker = '\n\n[Attached Files Content]:';
        const markerIdx = originalText.indexOf(fileMarker);
        if (markerIdx !== -1) originalText = originalText.substring(0, markerIdx).trim();
        chatHistory = chatHistory.slice(0, historyIdx);
        persistCurrentChat();
        if (cmdInput) {
            cmdInput.value = originalText;
            cmdInput.focus();
        }
        renderChatLog();
    }
});

// Wire up Model Panel callbacks
setupModelPanel({
    onApplyModel: (selectedId) => {
        const fill = document.querySelector('.progress-fill');
        if (fill) fill.style.width = '0%';
        const meta = document.querySelector('.status-meta');
        if (meta) meta.innerText = 'Loading selected model…';

        setIdleState(false);
        const statusTextEl = document.getElementById('statusText');
        if (statusTextEl) statusTextEl.textContent = 'LOADING MODEL…';

        worker.postMessage({ type: 'init', forcePresetId: selectedId });
    }
});

function setIdleState(isIdle) {
    if (!cmdInput || !sendBtn) return;
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

function getMessagesWindow(messages) {
    let filtered = messages ? messages.filter(m => m.role !== 'system') : [];
    if (filtered.length <= MAX_HISTORY) {
        if (filtered.length > 0 && filtered[0].role !== 'user') {
            return filtered.slice(1);
        }
        return filtered;
    }
    let sliced = filtered.slice(-MAX_HISTORY);
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
        if (status === 'done' || status === 'error') releaseWakeLock();
        if (status === 'aborted' && e.data.chatId) activeGenerations.delete(e.data.chatId);
        if (status === 'complete' && e.data.chatId) activeGenerations.delete(e.data.chatId);
        if (status === 'error' && e.data.chatId) activeGenerations.delete(e.data.chatId);
    } else {
        if (!_isGeneratingUI) {
            setIdleState(false);
            updateStatusLight('thinking');
        }
        if (status === 'thinking' && statusText) statusText.textContent = 'THINKING...';
        if (status === 'streaming' && statusText) statusText.textContent = 'RESPONDING...';
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
            updateModelInfo({ gpuInfo: _gpuInfo, presets: _presets, ramGB: _deviceRamGB });
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
                updateModelInfo({ activePresetId: _activePresetId, selectedPresetId: _selectedPresetId });
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
            if (e.data.chatId === currentChatId && message !== undefined && message !== null) {
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
            const errorText = typeof message === 'string' ? message : (message ? JSON.stringify(message) : 'An error occurred');
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
worker.onerror = (e) => { console.error('WORKER ERROR:', e); const _sm = document.querySelector('.status-meta'); if (_sm) _sm.innerText = 'Worker failed to load: ' + e.message; };

function initWorker() {
    if (worker) {
        worker.terminate();
    }
    worker = new Worker('worker.js?v=2', { type: 'module' });
    worker.onmessage = workerMessageHandler;
    worker.onerror = (e) => { console.error('WORKER ERROR:', e); const _sm = document.querySelector('.status-meta'); if (_sm) _sm.innerText = 'Worker failed to load: ' + e.message; };
    const _lastPreset = safeLocalStorage.getItem('james-last-preset-id');
    worker.postMessage({ type: 'init', lastPresetId: _lastPreset || null });
}

// File Attachment Setup
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
        if (file.type && !TEXT_TYPES.test(file.type)) {
            appendErrorToChat(`⚠️ "${file.name}" appears to be a binary file (${file.type || 'unknown type'}). Only plain-text files can be attached. Try exporting as .txt or .csv.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            attachedFiles.push({
                name: file.name,
                content: e.target.result
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

// Message Sending Logic
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

    let userMovePlayed = null;
    if (activeGame) {
        userMovePlayed = parseUserMove(text, activeGame);
        if (userMovePlayed) {
            if (activeGameUI) activeGameUI.update(userMovePlayed.notation);
            if (userMovePlayed.move.promotion || userMovePlayed.move.jump || userMovePlayed.move.multiJump) {
                playGameBuffSound();
            } else {
                playGameMoveSound();
            }
        }

        const turnColor = activeGame.getTurn() === 'w' ? 'White' : 'Black';
        const aiColor = 'Black';
        const gameTypeLabel = activeGame.type === 'chess' ? 'FEN' : 'Checkers Board';
        
        if (userMovePlayed) {
            fullPrompt += `\n\n[Game State] Current ${gameTypeLabel}: ${activeGame.getFen()}. You are playing ${aiColor}. The user just played ${userMovePlayed.notation}. It is NOW YOUR TURN. You MUST use the make_move tool immediately to play your move. Do NOT ask the user for their move—they just played it!`;
        } else {
            fullPrompt += `\n\n[Game State] Current ${gameTypeLabel}: ${activeGame.getFen()}. You are playing ${aiColor}. It is currently ${turnColor}'s turn. If the user provided a move in text, you MUST use the make_move tool to apply their move first, then (after seeing the result) use make_move again to play your own move.`;
        }
    }

    const displayMessage = text + (attachedFiles.length > 0 ? ` [Attached: ${attachedFiles.map(f => f.name).join(', ')}]` : '');

    chatHistory.push({ role: 'user', content: fullPrompt });
    appendUserMessage(displayMessage, chatHistory.length - 1);

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
            const titleSource = text || filesToSend.map(f => f.name).join(', ') || 'File upload';
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
            const simulatedAssistantMessage = "```tool:run\n" + toolMatch.tool + "\n" + Object.entries(toolMatch.params).map(([k, v]) => `${k}: ${v}`).join('\n') + "\n```";
            setIdleState(false);
            updateStatusLight('thinking');
            const statusText = document.getElementById('statusText');
            if (statusText) statusText.textContent = 'ROUTING...';

            const targetId = getNextTargetId();
            updateLiveBubble('...', targetId);

            setTimeout(() => {
                handleToolCalls(simulatedAssistantMessage, targetId, currentChatId);
            }, 300);
            return;
        }
    }

    setIdleState(false);
    const messagesForModel = getMessagesWindow(chatHistory);
    const targetId = getNextTargetId();
    activeGenerations.set(currentChatId, targetId);

    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId: targetId,
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

    _toolCallDepth = 0;
    setIdleState(true);
    updateStatusLight('idle');
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.textContent = 'READY';

    streamQueues.forEach((_, targetId) => flushStreamQueue(targetId));
}

// Tool Execution Handler
async function handleToolCalls(message, targetId, originChatId) {
    const toolCalls = parseToolCalls(message);

    if (toolCalls.length === 0 && activeGame && originChatId === currentChatId) {
        const extracted = extractAIMove(message, activeGame);
        if (extracted) {
            toolCalls.push({ tool: 'make_move', params: { move: extracted } });
        }
    }

    if (toolCalls.length === 0) {
        _toolCallDepth = 0;

        if (originChatId === currentChatId) {
            chatHistory.push({ role: 'assistant', content: message });
            persistCurrentChat();
            refreshGameBoardUI();
        } else {
            const bgChat = allChats.find(c => c.id === originChatId);
            if (bgChat) {
                bgChat.messages.push({ role: 'assistant', content: message });
                dbSaveChat(bgChat);
            }
        }
        return;
    }

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

    const isGameTool = toolCalls.some(call => call.tool === 'make_move' || call.tool === 'start_game');
    const assistantToolTurn = { role: 'assistant', content: message, hidden: isGameTool };
    const toolResultTurn = { role: 'user', type: 'tool_result', content: '[SYSTEM: Tool results below. Interpret them and reply naturally to the user.]\n' + toolResultText, hidden: isGameTool };

    if (originChatId === currentChatId) {
        chatHistory.push(assistantToolTurn, toolResultTurn);
    } else {
        const bgChat = allChats.find(c => c.id === originChatId);
        if (bgChat) bgChat.messages.push(assistantToolTurn, toolResultTurn);
    }
    if (originChatId === currentChatId) {
        persistCurrentChat();
        refreshGameBoardUI();
    } else {
        const bgChatToSave = allChats.find(c => c.id === originChatId);
        if (bgChatToSave) dbSaveChat(bgChatToSave);
    }

    const activeMessages = originChatId === currentChatId
        ? chatHistory
        : (allChats.find(c => c.id === originChatId)?.messages || []);

    const messagesForModel = getMessagesWindow(activeMessages);
    const nextTargetId = getNextTargetId();
    activeGenerations.set(originChatId, nextTargetId);

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

                        if (key === 'code') {
                            const restLines = lines.slice(i + 1);
                            params[key] = (value + (restLines.length ? '\n' + restLines.join('\n') : '')).trimEnd();
                            break;
                        }

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

function callWorkerRPC(targetWorker, messageData, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const execId = crypto.randomUUID();
        let timeoutId;
        const handler = (e) => {
            if (e.data?.execId === execId) {
                clearTimeout(timeoutId);
                targetWorker.removeEventListener('message', handler);
                if (e.data.status === 'done') {
                    resolve(e.data.result !== undefined ? e.data.result : e.data.output);
                } else if (e.data.status === 'error') {
                    reject(new Error(e.data.error || 'Worker execution failed'));
                }
            }
        };
        targetWorker.addEventListener('message', handler);
        targetWorker.postMessage({ ...messageData, execId });
        timeoutId = setTimeout(() => {
            targetWorker.removeEventListener('message', handler);
            reject(new Error('Worker execution timed out'));
        }, timeoutMs);
    });
}

function refreshGameBoardUI() {
    if (activeGame) {
        const idx = chatHistory.findIndex(m => m.type === 'game_board');
        if (idx !== -1 && idx !== chatHistory.length - 1) {
            const [msg] = chatHistory.splice(idx, 1);
            chatHistory.push(msg);
        }
    }
    
    renderChatLog();
    
    if (activeGame) {
        setTimeout(() => {
            const placeholders = document.querySelectorAll('.game-board-message');
            if (placeholders.length > 0) {
                const container = placeholders[placeholders.length - 1];
                activeGameUI = renderGameBoard(activeGame, container, handleGameMove);
            }
        }, 50);
    }
}

function handleGameMove(moveInfo) {
    const gameOver = activeGame.isGameOver();

    if (gameOver) {
        const winner = activeGame.getWinner ? activeGame.getWinner() : null; // Checkers only
        if (winner === 'w') playGameWinSound();
        else if (winner === 'b') playGameLoseSound();
        else if (activeGame.type === 'chess' && activeGame.game.isCheckmate()) {
            if (activeGame.game.turn() === 'b') playGameWinSound();
            else playGameLoseSound();
        } else {
            playGameMoveSound(); // Draw / game over catchall
        }
    } else if (moveInfo.promotion || moveInfo.multiJump || moveInfo.jump) {
        playGameBuffSound();
    } else {
        playGameMoveSound();
    }

    const result = activeGame.type === 'checkers' && activeGame.getWinner
        ? (activeGame.getWinner() === 'w' ? 'White wins!' : 'Black wins!')
        : 'Game over!';
    const msg = `[Game Over] ${result} The board has been updated.`;
    
    if (gameOver) {
        chatHistory.push({ role: 'user', content: msg, hidden: true });
        chatHistory.push({ role: 'system', content: `[Game Over] ${result}` });
        persistCurrentChat();
        setIdleState(false);
        worker.postMessage({
            type: 'query',
            messages: getMessagesWindow(chatHistory),
            targetId: getNextTargetId(),
            chatId: currentChatId
        });
        return;
    }

    const moveNotation = moveInfo.notation || '';
    const aiColor = activeGame.getTurn() === 'w' ? 'White' : 'Black';
    const checkersAiColor = activeGame.getTurn() === 'w' ? 'White (w/W)' : 'Black (b/B)';
    const aiPrompt = activeGame.type === 'chess'
        ? `[Game State] Current FEN: ${activeGame.getFen()}. You are playing ${aiColor}. The user just moved${moveNotation ? ` (${moveNotation})` : ''}. It is NOW YOUR TURN. You MUST immediately use the make_move tool to play your move in standard algebraic notation (e.g. e5, Nf6). Do NOT say 'your turn' — it is your turn right now.`
        : `[Game State] Current Checkers Board: ${activeGame.getFen()}. You are playing ${checkersAiColor}. The user just moved${moveNotation ? ` (${moveNotation})` : ''}. It is NOW YOUR TURN. You MUST immediately use the make_move tool with 'from_r,from_c to to_r,to_c' format. Do NOT say 'your turn' — it is your turn right now.`;

    chatHistory.push({ role: 'user', content: aiPrompt, hidden: true });
    chatHistory.push({ role: 'system', content: `[Moved piece: ${moveNotation || 'done'}]` });
    persistCurrentChat();
    
    // Refresh chat log and board to show the new system message
    refreshGameBoardUI();

    setIdleState(false);
    const messagesForModel = getMessagesWindow(chatHistory);
    const targetId = getNextTargetId();
    activeGenerations.set(currentChatId, targetId);
    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId: targetId,
        chatId: currentChatId
    });
}

function handleStartGame(params) {
    const gameType = params.game;
    activeGame = gameType === 'checkers' ? new CheckersGame() : new ChessGame();
    
    chatHistory.push({ role: 'assistant', type: 'game_board', content: '' });
    persistCurrentChat();
    
    refreshGameBoardUI();

    return { status: "game_started", game: gameType };
}

function handleMakeMove(params) {
    if (!activeGame) throw new Error("No active game to make a move in.");
    const moveStr = String(params.move || '');
    const movesMade = activeGame.makeSanMove(moveStr);
    if (movesMade) {
        const moves = Array.isArray(movesMade) ? movesMade : [movesMade];
        let lastMove = null;
        for (const move of moves) {
            let notation = null;
            if (activeGame.type === 'chess') {
                notation = move.san || moveStr;
                lastMove = move;
            } else {
                notation = `(${move.from.r},${move.from.c})→(${move.to.r},${move.to.c})`;
                lastMove = move;
            }
            if (activeGameUI) activeGameUI.update(notation);
        }
        
        const newState = activeGame.getFen();
        const gameOver = activeGame.isGameOver();
        
        if (gameOver) {
            const winner = activeGame.getWinner ? activeGame.getWinner() : null; // Checkers only
            if (winner === 'w') playGameWinSound();
            else if (winner === 'b') playGameLoseSound();
            else if (activeGame.type === 'chess' && activeGame.game.isCheckmate()) {
                if (activeGame.game.turn() === 'b') playGameWinSound();
                else playGameLoseSound();
            } else {
                playGameMoveSound(); // Draw / game over catchall
            }
            
            const result = activeGame.type === 'checkers' && activeGame.getWinner
                ? (activeGame.getWinner() === 'w' ? 'White wins!' : 'Black wins!')
                : 'Game over!';
            return { status: "moved", move: moveStr, newState, gameOver: true, result };
        }
        
        if (activeGame.type === 'checkers' && lastMove && lastMove.multiJump) {
            playGameBuffSound();
            return {
                status: "multi_jump_required",
                move: moveStr,
                mustJumpFrom: activeGame.mustJumpFrom,
                newState,
                message: `Jump completed! Multi-jump required from (${activeGame.mustJumpFrom.r},${activeGame.mustJumpFrom.c}). You MUST call make_move again immediately for the next jump.`
            };
        }
        
        if (lastMove && (lastMove.promotion || lastMove.jump)) {
            playGameBuffSound();
        } else {
            playGameMoveSound();
        }
        
        return { status: "moved", move: moveStr, newState };
    } else {
        throw new Error(`Invalid or illegal move: ${moveStr}. Please check the board state and try a valid move.`);
    }
}

async function executeTool(toolName, params) {
    switch (toolName) {
        case 'start_game':
            return handleStartGame(params);
        case 'make_move':
            return handleMakeMove(params);
        case 'search_web':
        case 'web_search':
        case 'websearch':
            return import('./tools-search.js').then(m => m.performWebSearch(params.query || params.q));
        case 'location':
            return import('./tools-bridge.js').then(m => m.getLocation());
        case 'clipboard':
            return import('./tools-bridge.js').then(m => m.readClipboard()).then(content => ({ content, length: content.length }));
        case 'python':
            if (!params?.code) throw new Error('Python tool requires a code parameter');
            return callWorkerRPC(pythonWorker, { type: 'run', code: params.code });
        default:
            return callWorkerRPC(toolsWorker, { tool: toolName, params });
    }
}

pythonWorker.onmessage = (e) => {
    if (e.data.status === 'ready') { console.log('Python worker ready'); }
};

let _cannedGenId = 0;

async function simulateCannedResponse(canned, targetId = null) {
    if (!targetId) targetId = getNextTargetId();
    const myGenId = ++_cannedGenId;
    const myChatId = currentChatId;
    const statusText = document.getElementById('statusText');

    setIdleState(false);
    updateStatusLight('thinking');
    if (statusText) statusText.textContent = 'THINKING...';
    updateLiveBubble('...', targetId);

    await new Promise(r => setTimeout(r, 400 + Math.random() * 500));

    if (myGenId !== _cannedGenId || !_isGeneratingUI || currentChatId !== myChatId) return;

    if (statusText) statusText.textContent = 'RESPONDING...';
    queueStreamText(targetId, canned);

    const wordCount = canned.split(/\s+/).length;
    await new Promise(r => setTimeout(r, wordCount * 35 + 300));

    if (myGenId !== _cannedGenId || !_isGeneratingUI || currentChatId !== myChatId) return;

    chatHistory.push({ role: 'assistant', content: canned });
    persistCurrentChat();
    setIdleState(true);
    updateStatusLight('idle');
    if (statusText) statusText.textContent = 'READY';
}

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
        ? `\n───────────────\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🌐 web search\n🔑 uuid · 🔐 password · ⏳ timer · 📋 clipboard · 🔤 ascii\n🎨 palette · 📁 file · 🔍 search · ♟️ chess · 🔴 checkers · 🐍 python\n───────────────\n`
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**\n🛡️ Runs entirely in this browser — nothing leaves your device.\n📱 Running in **lightweight mode** — tool use may be limited on this device.\n${toolsBlock}\n💬 Type a message below to begin.`
    };
}

function getFullWelcomeMessage(showTools = true) {
    const toolsBlock = showTools
        ? `───────────────\n\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🌐 web search\n🔑 uuid · 🔐 password · ⏳ timer · 📋 clipboard · 🔤 ascii\n🎨 palette · 📁 file · 🔍 search · ♟️ chess · 🔴 checkers · 🐍 python\n───────────────\n\n`
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**\n🛡️ Runs entirely in this browser — nothing leaves your device.\n🔄 Every session starts fresh.\n\n${toolsBlock}💬 Type a message below to begin.`
    };
}

function getTVWelcomeMessage(showTools = true) {
    const toolsBlock = showTools
        ? `\n───────────────\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🌐 web search\n🔑 uuid · 🔐 password · ⏳ timer · 📋 clipboard · 🔤 ascii\n🎨 palette · 📁 file · 🔍 search · ♟️ chess · 🔴 checkers · 🐍 python\n───────────────\n`
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
        if (activeGame) {
            chat.gameState = { type: activeGame.type, state: activeGame.getState() };
        } else {
            chat.gameState = null;
        }
        dbSaveChat(chat);
    }
}

function loadChatHistory(chatId) {
    const chat = allChats.find(c => c.id === chatId);
    if (!chat) return;

    persistCurrentChat();
    currentChatId = chatId;
    safeLocalStorage.setItem('james-last-chat-id', currentChatId);
    chatHistory = [...chat.messages];
    
    if (chat.gameState) {
        if (chat.gameState.type === 'checkers') {
            activeGame = new CheckersGame(chat.gameState.state);
        } else {
            activeGame = new ChessGame(chat.gameState.state.fen, chat.gameState.state.moveHistory);
        }
    } else {
        activeGame = null;
        activeGameUI = null;
    }

    refreshGameBoardUI();
    updateChatListActive(currentChatId);
    
    if (activeGenerations.has(chatId)) {
        const tId = activeGenerations.get(chatId);
        const hasText = streamQueues.has(tId) && streamQueues.get(tId).displayed.length > 0;
        if (!hasText) {
            updateLiveBubble('...', tId, true);
        }
    }
}

function startNewChat() {
    persistCurrentChat();

    const welcome = getWelcomeMessage();
    chatHistory = [welcome];

    const newChat = {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        name: 'New Chat',
        messages: [...chatHistory],
    };
    currentChatId = newChat.id;
    safeLocalStorage.setItem('james-last-chat-id', currentChatId);
    allChats.unshift(newChat);
    dbSaveChat(newChat);

    updateChatList();
    renderChatLog();
    updateChatListActive(currentChatId);
    if (cmdInput) cmdInput.focus();
}

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
    dbDeleteChat(chatId);

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
    await migrateFromLocalStorage();
    allChats = await dbLoadAllChats();
    if (allChats.length > 0) updateChatList();
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupFileAttachment();
});

(async () => {
    await loadSavedChats();
    const lastChatId = Number(safeLocalStorage.getItem('james-last-chat-id'));
    const lastChat = allChats.find(c => c.id === lastChatId);
    
    if (lastChat) {
        loadChatHistory(lastChatId);
    } else if (allChats.length > 0) {
        loadChatHistory(allChats[0].id);
    } else {
        startNewChat();
    }
})();

if (isTVDevice()) {
    document.body.classList.add('tv-mode');
    document.getElementById('sidebar')?.classList.add('collapsed');
} else {
    const savedSidebar = safeLocalStorage.getItem('james-sidebar-collapsed');
    if (savedSidebar === 'true' || window.innerWidth <= 768) {
        document.getElementById('sidebar')?.classList.add('collapsed');
    } else if (savedSidebar === 'false') {
        document.getElementById('sidebar')?.classList.remove('collapsed');
    }
}

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

// Sidebar Controls
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
    safeLocalStorage.setItem('james-sidebar-collapsed', nowCollapsed);
});

document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

import('./tools-bridge.js').then(module => {
    module.setupToolsBridge({
        worker: toolsWorker,
        DOM: { log: document.getElementById('chatLog'), cmd: cmdInput },
        submit: sendMessage
    });
}).catch(() => { });

// PWA Installation
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
