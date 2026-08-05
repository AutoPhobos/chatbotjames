import { globalState } from './global-state.js';
import { chatManager } from './chat-manager.js';
import { gameController } from './game-controller.js?v=2';
import { attachmentManager } from './attachment-manager.js';
import { uiManager } from './ui-manager.js';
import { workerController } from './worker-controller.js';

import { smallTalk } from './smalltalk.js';
import { toolRouter } from './tool-router.js';
import { CONFIG } from './config.js';
import { safeLocalStorage, dbSaveNote, dbDeleteNote, dbClearNotes } from './chat-db.js';
import { playSendSound } from './audio-wakelock.js';
import { getNextTargetId } from './stream-manager.js';
import {
    setupMessageRenderer,
    updateStatusLight,
    escapeHTML,
    appendUserMessage,
    updateLiveBubble,
    appendErrorToChat,
    renderChatLog as coreRender
} from './message-renderer.js';
import { setupModelPanel, updateModelInfo, refreshPresetCards } from './model-panel.js';
import { UserInputProcessor } from './input-processor.js';

// ==========================================
// MANAGER WIRING & CALLBACKS
// ==========================================

function renderChatLog() {
    coreRender({
        chatHistory: chatManager.chatHistory,
        chatLogEl: document.getElementById('chatLog'),
        activeGenerations: workerController.activeGenerations,
        currentChatId: chatManager.currentChatId,
        onCopy: () => _showCopyToast(),
        onEdit: (idx, txt) => {
            uiManager.cmdInput.value = txt;
            chatManager.chatHistory = chatManager.chatHistory.slice(0, idx);
            chatManager.persistCurrentChat(() => gameController.getGameState());
            renderChatLog();
        }
    });
}

window.gameController = gameController;
window.chatManager = chatManager;
window.renderChatLog = renderChatLog;
window.globalState = globalState;
window.sendMessage = sendMessage;


// Chat Manager Callbacks
chatManager.onChatListUpdated = () => {
    const chatListEl = document.getElementById('chatList');
    if (!chatListEl) return;
    chatListEl.innerHTML = '';
    chatManager.allChats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chatId = chat.id;

        const chatText = document.createElement('span');
        chatText.textContent = chat.name;
        chatText.style.pointerEvents = 'none';

        chatItem.onclick = () => {
            chatManager.loadChatHistory(
                chat.id, 
                () => gameController.getGameState(), 
                (state) => gameController.restoreGameState(state),
                safeLocalStorage
            );
            if (window.innerWidth <= 768) uiManager.closeSidebar();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'x';
        deleteBtn.className = 'delete-chat-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            chatManager.deleteChat(
                chat.id, 
                safeLocalStorage,
                () => gameController.getGameState(), 
                (state) => gameController.restoreGameState(state),
                () => uiManager.getWelcomeMessage(isMobileDevice(), isTVDevice(), true)
            );
        };

        chatItem.appendChild(chatText);
        chatItem.appendChild(deleteBtn);
        chatListEl.appendChild(chatItem);
    });
    
    updateChatListActive(chatManager.currentChatId);
};

function updateChatListActive(chatId) {
    document.querySelectorAll('#chatList .chat-item').forEach(item => {
        item.classList.toggle('active', chatId != null && Number(item.dataset.chatId) === chatId);
    });
}

chatManager.onChatChanged = (chatId) => {
    updateChatListActive(chatId);
    renderChatLog();
};

chatManager.onNotesLoaded = (notes) => {
    _updateNotesUI(notes);
};

// Game Controller Callbacks
gameController.onGameStateChange = () => {
    chatManager.persistCurrentChat(() => gameController.getGameState());
};

window.closeActiveGame = function() {
    gameController.closeActiveGame((sysMsg) => {
        chatManager.chatHistory.push({ role: 'system', content: sysMsg });
    });
    chatManager.persistCurrentChat(() => gameController.getGameState());
};

// Worker Controller Callbacks
workerController.onWorkerStatus = (status, message, e) => {
    if (status === 'done' || status === 'complete' || status === 'error' || status === 'aborted') {
        uiManager.setIdleState(true, (v) => globalState.isGeneratingUI = v);
        updateStatusLight('idle');
        uiManager.updateStatusText('READY');
        if (status === 'aborted' && e.data.chatId) workerController.activeGenerations.delete(e.data.chatId);
        if (status === 'complete' && e.data.chatId) workerController.activeGenerations.delete(e.data.chatId);
        if (status === 'error' && e.data.chatId) workerController.activeGenerations.delete(e.data.chatId);
    } else {
        if (!globalState.isGeneratingUI) {
            uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
            updateStatusLight('thinking');
        }
        if (status === 'thinking') uiManager.updateStatusText('THINKING...');
        if (status === 'streaming') uiManager.updateStatusText('RESPONDING...');
    }
};

workerController.onModelInfo = (data) => {
    globalState.gpuInfo = data.gpuInfo;
    globalState.presets = data.presets;
    globalState.deviceRamGB = data.ramGB ?? 4;
    updateModelInfo({ gpuInfo: globalState.gpuInfo, presets: globalState.presets, ramGB: globalState.deviceRamGB });
};

workerController.onWarmStart = (preset) => {
    uiManager.updateStatusMeta(`Resuming: ${preset.label}…`);
    uiManager.updateStatusText(`RESUMING ${preset.label.toUpperCase()}…`);
};

workerController.onDownloadProgress = (loaded, total, file) => {
    const percent = total ? (loaded / total * 100) : 0;
    uiManager.updateProgress(percent);
    const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
    const mbTotal = (total / 1024 / 1024).toFixed(1);
    uiManager.updateStatusMeta(`Downloading: ${file || 'weights'} (${mbLoaded}/${mbTotal} MB)`);
    uiManager.updateStatusText(`DOWNLOADING (${Math.round(percent)}%)...`);
};

workerController.onWorkerDone = (data) => {
    if (data && data.backend) {
        const backend = data.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
        const deviceTag = data.isTV ? ' · TV Mode' : data.isMobile ? ' · Lightweight Mode' : '';
        uiManager.updateStatusMeta(`JAMES is online (${backend}${deviceTag})`);
        uiManager.updateProgress(100);
        uiManager.updateStatusText('READY');

        const runningPreset = globalState.presets.find(
            p => p.backend === data.backend && p.dtype === data.dtype && p.model === data.model
        );
        if (runningPreset) {
            globalState.activePresetId = runningPreset.id;
            globalState.selectedPresetId = runningPreset.id;
            safeLocalStorage.setItem('james-last-preset-id', runningPreset.id);
            updateModelInfo({ activePresetId: globalState.activePresetId, selectedPresetId: globalState.selectedPresetId });
            refreshPresetCards();
            uiManager.updateActiveModelLabel(runningPreset.label);
        }
    }
    
    if (window._chatsLoadedForRecovery) {
        initRecovery();
    }
};

workerController.onStreaming = (chatId, targetId, message) => {
    if (chatId === chatManager.currentChatId) {
        import('./stream-manager.js').then(sm => sm.queueStreamText(targetId, message));
    }
};

workerController.onThinking = (chatId, targetId) => {
    if (chatId === chatManager.currentChatId) {
        updateLiveBubble("...", targetId);
    }
};

workerController.onComplete = (chatId, targetId, message) => {
    import('./stream-manager.js').then(sm => sm.flushStreamQueue(targetId));
    if (chatId === chatManager.currentChatId) {
        if (!message || message.trim() === '') {
            const bubble = document.getElementById(`bubble-${targetId}`);
            if (bubble && bubble.parentElement) {
                bubble.parentElement.remove();
            }
        } else {
            updateLiveBubble(message, targetId, true);
            chatManager.chatHistory.push({ role: 'assistant', content: message });
            
            if (gameController.activeGame) {
                import('./game-logic.js').then(({ extractAIMove }) => {
                    const aiMove = extractAIMove(message, gameController.activeGame);
                    if (aiMove) {
                        gameController.handleMakeMove({ move: aiMove }, null, (v) => uiManager.setIdleState(v, (x) => globalState.isGeneratingUI = x), null);
                        chatManager.persistCurrentChat(() => gameController.getGameState());
                    }
                });
            }
            chatManager.persistCurrentChat(() => gameController.getGameState());
        }
    }
};

workerController.onToolCalls = (message, targetId, chatId) => {
    handleToolCalls(message, targetId, chatId);
};

workerController.onAborted = (chatId, targetId, message) => {
    import('./stream-manager.js').then(sm => sm.flushStreamQueue(targetId));
    if (chatId === chatManager.currentChatId && message !== undefined && message !== null) {
        updateLiveBubble(message, targetId);
        chatManager.chatHistory.push({ role: 'assistant', content: message });
        
        if (window.gameController && window.gameController.activeGame) {
            import('./game-logic.js').then(({ extractAIMove }) => {
                const aiMove = extractAIMove(message, window.gameController.activeGame);
                if (aiMove) {
                    window.gameController.handleMakeMove({ move: aiMove }, null, (v) => uiManager.setIdleState(v, (x) => globalState.isGeneratingUI = x), null);
                    chatManager.persistCurrentChat(() => window.gameController.getGameState());
                }
            });
        }
        
        chatManager.persistCurrentChat(() => gameController.getGameState());
    } else if (chatId !== chatManager.currentChatId && message) {
        const bgChat = chatManager.allChats.find(c => c.id === chatId);
        if (bgChat) {
            bgChat.messages.push({ role: 'assistant', content: message });
            import('./chat-db.js').then(db => db.dbSaveChat(bgChat));
        }
    }
    renderChatLog();
};

// Attachment Manager Callbacks
attachmentManager.onPreviewsUpdated = () => {
    const previewContainer = document.getElementById('attachmentPreview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';
    attachmentManager.attachedFiles.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';
        chip.innerHTML = `
            <span>📄 ${escapeHTML(file.name)}</span>
            <button type="button" onclick="attachmentManager.removeAttachment(${index})">&times;</button>
        `;
        previewContainer.appendChild(chip);
    });
};
window.attachmentManager = attachmentManager;

// ==========================================
// CORE SEND LOGIC
// ==========================================

function getMessagesWindow(messages) {
    const background = messages.filter(m => m.isBackground);
    const regular    = messages.filter(m => !m.isBackground);

    let windowed = regular;
    if (regular.length > CONFIG.ui.maxHistory) {
        windowed = regular.slice(-CONFIG.ui.maxHistory);
    }
    while (windowed.length > 0 && windowed[0].role !== 'user') {
        windowed = windowed.slice(1);
    }
    return [...windowed, ...background];
}

function sendMessage(preExecutedMove = null) {
    const text = uiManager.cmdInput.value.trim();
    if ((!text && attachmentManager.attachedFiles.length === 0 && !preExecutedMove) || globalState.isGeneratingUI) return;

    const processedText = UserInputProcessor.process(text);
    let fullPrompt = processedText;

    if (attachmentManager.attachedFiles.length > 0) {
        let fileContext = "\n\n[Attached Files Content]:\n";
        attachmentManager.attachedFiles.forEach(file => {
            fileContext += `\n--- START FILE: ${file.name} ---\n${file.content}\n--- END FILE: ${file.name} ---\n`;
        });
        fullPrompt = (processedText ? processedText + "\n" : "Please analyze the attached file(s):") + fileContext;
    }

    let userMovePlayed = null;
    if (gameController.activeGame) {
        if (preExecutedMove) {
            userMovePlayed = preExecutedMove;
        } else {
            userMovePlayed = gameController.parseUserMove(text);
        }
        
        if (userMovePlayed) {
            gameController.handleGameMove(
                userMovePlayed, 
                null, 
                (v) => uiManager.setIdleState(v, (x) => globalState.isGeneratingUI = x), 
                null,
                !!preExecutedMove // indicates UI already handled notation update
            );
        }

        const turnColor = gameController.activeGame.getTurn() === 'w' ? 'White' : 'Black';
        const aiColor = gameController.activeGame.aiColor === 'w' ? 'White' : 'Black';
        const gameTypeLabel = gameController.activeGame.type === 'chess' ? 'FEN' : 'Checkers Board';
        const formatReminder = gameController.activeGame.type === 'chess' 
            ? 'IMPORTANT: You must format your move using Standard Algebraic Notation (SAN) for chess (e.g. "e5", "Nf3", "O-O", "Bxc6"). Do NOT use "from to" coordinate format like "c6 to c5".' 
            : 'IMPORTANT: You must format your move using Standard Checkers Notation (1-32) (e.g. "11-15", or "11x18x25" for multi-jumps). Do NOT use coordinates.';
        
        if (userMovePlayed) {
            fullPrompt += `\n\n[Game State] Current ${gameTypeLabel}: ${gameController.activeGame.getFen()}. You are playing ${aiColor}. The user just played ${userMovePlayed.notation}. It is NOW YOUR TURN. You MUST use the make_move tool immediately to play your move. ${formatReminder} Do NOT ask the user for their move—they just played it!`;
        } else {
            fullPrompt += `\n\n[Game State] Current ${gameTypeLabel}: ${gameController.activeGame.getFen()}. You are playing ${aiColor}. It is currently ${turnColor}'s turn. If the user's message is just normal chat, reply normally without using any game tools. If you are making a move, remember: ${formatReminder}`;
        }
    }

    const displayMessage = processedText + (attachmentManager.attachedFiles.length > 0 ? ` [Attached: ${attachmentManager.attachedFiles.map(f => f.name).join(', ')}]` : '');

    chatManager.chatHistory.push({ role: 'user', content: fullPrompt, displayContent: displayMessage });
    appendUserMessage(displayMessage, chatManager.chatHistory.length - 1);

    uiManager.cmdInput.value = '';
    const filesToSend = [...attachmentManager.attachedFiles];
    attachmentManager.clearAttachments();
    chatManager.persistCurrentChat(() => gameController.getGameState());

    playSendSound();
    uiManager.sendBtn.classList.add('sending');
    uiManager.sendBtn.addEventListener('animationend', () => uiManager.sendBtn.classList.remove('sending'), { once: true });

    chatManager.updateChatName(chatManager.currentChatId, text || filesToSend.map(f => f.name).join(', ') || 'File upload');

    if (filesToSend.length === 0) {
        const canned = smallTalk.match(processedText);
        if (canned) {
            simulateCannedResponse(canned); // Need to patch simulateCannedResponse to use global state
            return;
        }

        const toolMatch = toolRouter.match(processedText);
        if (toolMatch) {
            const simulatedAssistantMessage = "```tool:run\n" + toolMatch.tool + "\n" + Object.entries(toolMatch.params).map(([k, v]) => `${k}: ${v}`).join('\n') + "\n```";
            uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
            updateStatusLight('thinking');
            uiManager.updateStatusText('ROUTING...');
            
            const targetId = getNextTargetId();
            workerController.activeGenerations.set(chatManager.currentChatId, targetId);
            updateLiveBubble('...', targetId);
            
            setTimeout(() => {
                chatManager.chatHistory.push({ role: 'assistant', content: simulatedAssistantMessage });
                chatManager.persistCurrentChat(() => gameController.getGameState());
                renderChatLog();
                handleToolCalls(simulatedAssistantMessage, targetId, chatManager.currentChatId);
            }, 300);
            return;
        }
    }

    uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
    updateStatusLight('thinking');
    uiManager.updateStatusText('THINKING...');

    const messagesForModel = getMessagesWindow(chatManager.chatHistory);
    const targetId = getNextTargetId();
    updateLiveBubble('...', targetId);
    workerController.postQuery(messagesForModel, targetId, chatManager.currentChatId);
}

function handleStopGeneration() {
    if (workerController.activeGenerations.has(chatManager.currentChatId)) {
        workerController.worker.postMessage({ type: 'abort', targetId: workerController.activeGenerations.get(chatManager.currentChatId) });
        uiManager.updateStatusText('STOPPING...');
    }
}

window.simulateCannedResponse = function(text) {
    globalState.cannedGenId++;
    const currentGenId = globalState.cannedGenId;
    uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
    updateStatusLight('thinking');
    uiManager.updateStatusText('THINKING...');
    
    const targetId = getNextTargetId();
    workerController.activeGenerations.set(chatManager.currentChatId, targetId);
    updateLiveBubble('...', targetId);
    
    let chars = 0;
    const interval = setInterval(() => {
        if (!globalState.isGeneratingUI || globalState.cannedGenId !== currentGenId) {
            clearInterval(interval);
            return;
        }
        chars += 3;
        uiManager.updateStatusText('RESPONDING...');
        if (chars >= text.length) {
            clearInterval(interval);
            updateLiveBubble(text, targetId);
            chatManager.chatHistory.push({ role: 'assistant', content: text });
            chatManager.persistCurrentChat(() => gameController.getGameState());
            renderChatLog();
            uiManager.setIdleState(true, (v) => globalState.isGeneratingUI = v);
            updateStatusLight('idle');
            uiManager.updateStatusText('READY');
            workerController.activeGenerations.delete(chatManager.currentChatId);
        } else {
            updateLiveBubble(text.substring(0, chars) + '...', targetId);
        }
    }, 30);
};

async function handleToolCalls(message, targetId, originChatId, _depth = 0) {
    if (_depth > CONFIG.ui.maxToolDepth) {
        appendErrorToChat("Maximum tool depth exceeded.");
        uiManager.setIdleState(true, (v) => globalState.isGeneratingUI = v);
        return;
    }

    const regex = /```\s*tool:run\n?([\s\S]*?)```/g;
    let match;
    const calls = [];
    while ((match = regex.exec(message)) !== null) {
        calls.push(match[1].trim());
    }

    if (calls.length === 0) {
        uiManager.setIdleState(true, (v) => globalState.isGeneratingUI = v);
        return;
    }

    // Push the assistant's message with tool calls to history
    chatManager.chatHistory.push({ role: 'assistant', content: message });
    chatManager.persistCurrentChat(() => gameController.getGameState());

    for (const callBlock of calls) {
        const lines = callBlock.split('\n').map(l => l.trim()).filter(l => l);
        const toolName = lines[0];
        const params = {};
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(':');
            if (parts.length >= 2) {
                const k = parts[0].trim();
                const v = parts.slice(1).join(':').trim();
                params[k] = v;
            }
        }

        uiManager.updateStatusText(`RUNNING ${toolName.toUpperCase()}...`);
        let toolResult = null;

        try {
            if (toolName === 'start_game') {
                gameController.handleStartGame(
                    params, 
                    (msg) => chatManager.chatHistory.push({ role: 'system', content: msg }), 
                    () => {}
                );
                toolResult = `Game started: ${params.game || 'chess'}. Wait for user's move.`;
            } else if (toolName === 'make_move') {
                const moveResult = gameController.handleMakeMove(
                    params, 
                    (msg) => {
                        if (!msg.includes('Failed to make move')) {
                            chatManager.chatHistory.push({ role: 'system', content: msg });
                        }
                    }, 
                    (v) => uiManager.setIdleState(v, (x) => globalState.isGeneratingUI = x),
                    () => {} 
                );
                if (moveResult && moveResult.success === false) {
                    toolResult = moveResult.error;
                } else {
                    toolResult = `Move ${params.move} played. Wait for user's next move.`;
                }
            } else if (toolName === 'eval_python' || toolName === 'python') {
                toolResult = await workerController.callWorkerRPC(workerController.pythonWorker, { type: 'python', code: params.code }, 30000);
            } else {
                // Route all other tools to toolsWorker
                // Note: tools-worker expects 'tool', not 'type'
                toolResult = await workerController.callWorkerRPC(workerController.toolsWorker, { tool: toolName, params }, 30000);
            }
        } catch (e) {
            toolResult = `Error executing tool: ${e.message}`;
            appendErrorToChat(toolResult);
        }

        if (toolResult) {
            chatManager.chatHistory.push({ role: 'system', content: `[Tool Result: ${toolName}]\n${toolResult}` });
            chatManager.persistCurrentChat(() => gameController.getGameState());
            renderChatLog();
        }
    }

    uiManager.updateStatusText('THINKING...');
    const nextTargetId = getNextTargetId();
    workerController.postQuery(getMessagesWindow(chatManager.chatHistory), nextTargetId, originChatId);
    updateLiveBubble('...', nextTargetId);
}

// ==========================================
// RECOVERY LOGIC
// ==========================================
function initRecovery() {
    if (!chatManager.chatHistory || chatManager.chatHistory.length === 0) return;
    const lastMsg = chatManager.chatHistory[chatManager.chatHistory.length - 1];
    if (lastMsg.role !== 'user') return;

    const overlay = document.getElementById('recoveryOverlay');
    const modal = document.getElementById('recoveryModal');
    if (!overlay || !modal) return;

    overlay.classList.add('active');
    modal.classList.add('active');

    const lastInput = lastMsg.displayContent || lastMsg.content || '(previous message)';
    const promptTextEl = modal.querySelector('#recoveryPromptText');
    if (promptTextEl) {
        promptTextEl.textContent = `"${lastInput.substring(0, 80)}${lastInput.length > 80 ? '…' : ''}"`;
    } else {
        const modalBody = modal.querySelector('.recovery-body');
        if (modalBody) {
            modalBody.innerHTML = `
            It looks like the page was refreshed while JAMES was generating a response to:<br><br>
            <strong id="recoveryPromptText" style="color: var(--primary-blue);"></strong><br><br>
            Would you like to try regenerating the last message?
        `;
            modal.querySelector('#recoveryPromptText').textContent = `"${lastInput.substring(0, 80)}${lastInput.length > 80 ? '…' : ''}"`;
        }
    }

    const closePopup = () => {
        overlay.classList.remove('active');
        modal.classList.remove('active');
    };

    document.getElementById('recoveryNo')?.addEventListener('click', closePopup);
    document.getElementById('recoveryClose')?.addEventListener('click', closePopup);

    document.getElementById('recoveryYes')?.addEventListener('click', () => {
        closePopup();
        uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
        updateStatusLight('thinking');
        uiManager.updateStatusText('RESUMING...');

        const targetId = getNextTargetId();
        updateLiveBubble('...', targetId, true);
        workerController.postQuery(getMessagesWindow(chatManager.chatHistory), targetId, chatManager.currentChatId);
    });
}

window.initRecovery = initRecovery;
window.uiManager = uiManager;
window.gameController = gameController;

// ==========================================
// INITIALIZATION
// ==========================================
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
function isTVDevice() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches && navigator.userAgent.toLowerCase().includes('tv');
}

function setupEventListeners() {
    if (uiManager.sendBtn && uiManager.cmdInput) {
        uiManager.sendBtn.addEventListener('click', () => {
            if (globalState.isGeneratingUI) handleStopGeneration();
            else sendMessage();
        });
        uiManager.cmdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (globalState.isGeneratingUI) handleStopGeneration();
                else sendMessage();
            }
        });
    }

    document.getElementById('stopButton')?.addEventListener('click', handleStopGeneration);
    document.getElementById('stop-button')?.addEventListener('click', handleStopGeneration);
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    attachmentManager.setupFileAttachment('attachButton', 'fileInput', 'chatWindow');
});

(async () => {
    await chatManager.loadSavedChats((await import('./chat-db.js')).migrateFromLocalStorage, (await import('./crypto-utils.js')).initEncryption);
    const lastChatId = Number(safeLocalStorage.getItem('james-last-chat-id'));
    const lastChat = chatManager.allChats.find(c => c.id === lastChatId);
    
    if (lastChat) {
        chatManager.loadChatHistory(
            lastChatId, 
            () => gameController.getGameState(), 
            (state) => gameController.restoreGameState(state),
            safeLocalStorage
        );
    } else if (chatManager.allChats.length > 0) {
        chatManager.loadChatHistory(
            chatManager.allChats[0].id,
            () => gameController.getGameState(), 
            (state) => gameController.restoreGameState(state),
            safeLocalStorage
        );
    } else {
        chatManager.startNewChat(
            () => uiManager.getWelcomeMessage(isMobileDevice(), isTVDevice(), true), 
            safeLocalStorage,
            () => gameController.getGameState(),
            (state) => gameController.restoreGameState(state)
        );
    }
    
    window._chatsLoadedForRecovery = true;
    if (workerController._recoveryInitDone) initRecovery();
})();

uiManager.initSidebarState(safeLocalStorage.getItem('james-sidebar-collapsed'));
if (isTVDevice()) uiManager.initTVMode();

uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
const _savedLastPresetId = safeLocalStorage.getItem('james-last-preset-id');
workerController.initWorkers(safeLocalStorage);
uiManager.updateStatusText(_savedLastPresetId ? 'RESUMING LAST MODEL…' : 'INITIALIZING...');

const newChatBtn = document.getElementById('newChatBtn');
if (newChatBtn) {
    newChatBtn.addEventListener('click', () => chatManager.startNewChat(
        () => uiManager.getWelcomeMessage(isMobileDevice(), isTVDevice(), true), 
        safeLocalStorage,
        () => gameController.getGameState(),
        (state) => gameController.restoreGameState(state)
    ));
}

document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    const nowCollapsed = uiManager.toggleSidebar();
    safeLocalStorage.setItem('james-sidebar-collapsed', nowCollapsed);
});

document.getElementById('sidebarOverlay')?.addEventListener('click', () => uiManager.closeSidebar());

setupMessageRenderer({
    getChatHistory: () => chatManager.chatHistory,
    getIsGenerating: () => globalState.isGeneratingUI,
    onEditUserMsg: (historyIdx) => {
        if (historyIdx < 0 || historyIdx >= chatManager.chatHistory.length) return;
        const msg = chatManager.chatHistory[historyIdx];
        if (!msg || msg.role !== 'user') return;
        let originalText = msg.displayContent || msg.content;
        const fileMarker = '\n\n[Attached Files Content]:';
        const markerIdx = originalText.indexOf(fileMarker);
        if (markerIdx !== -1) originalText = originalText.substring(0, markerIdx).trim();
        chatManager.chatHistory = chatManager.chatHistory.slice(0, historyIdx);
        chatManager.persistCurrentChat(() => gameController.getGameState());
        if (uiManager.cmdInput) {
            uiManager.cmdInput.value = originalText;
            uiManager.cmdInput.focus();
        }
        renderChatLog();
    }
});

setupModelPanel({
    onApplyModel: (selectedId) => {
        uiManager.updateProgress(0);
        uiManager.updateStatusMeta('Loading selected model…');
        uiManager.setIdleState(false, (v) => globalState.isGeneratingUI = v);
        uiManager.updateStatusText('LOADING MODEL…');
        workerController.worker.postMessage({ type: 'init', forcePresetId: selectedId });
    }
});

let _noteToastTimeout = null;
function _showCopyToast() {
    const toast = document.getElementById('copyToast');
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function _updateNotesUI(notes) {
    const notesContent = document.getElementById('notesContent');
    const notesCount = document.getElementById('notesCount');
    const btn = document.getElementById('notesBtn');
    
    if (btn) {
        btn.title = notes && notes.length > 0
            ? `JAMES remembers ${notes.length} thing${notes.length !== 1 ? 's' : ''} about you`
            : 'No memory notes yet';
        btn.classList.toggle('notes-active', notes && notes.length > 0);
    }
    
    if (!notesContent) return;

    if (!notes || notes.length === 0) {
        notesContent.innerHTML = '<div style="padding:1rem;color:var(--text-color);opacity:0.6;">No notes saved yet. JAMES will automatically remember important details about you.</div>';
        if (notesCount) notesCount.textContent = '0';
        return;
    }

    if (notesCount) notesCount.textContent = notes.length.toString();
    notesContent.innerHTML = notes.map(note => `
        <div class="note-item" style="padding:0.75rem;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
            <div style="font-size:0.9rem;line-height:1.4;flex:1;">${escapeHTML(note.text)}</div>
            <button class="icon-btn" onclick="window._deleteNote(${note.id})" title="Delete Note" style="padding:4px;color:var(--error-color);">🗑️</button>
        </div>
    `).join('');
}
window._deleteNote = async (id) => {
    await dbDeleteNote(id);
    _updateNotesUI(await import('./chat-db.js').then(m => m.dbLoadNotes()));
};
document.getElementById('notesClearBtn')?.addEventListener('click', async () => {
    if (confirm('Clear all notes?')) {
        await dbClearNotes();
        _updateNotesUI([]);
    }
});

function _setupNotesPanel() {
    const btn      = document.getElementById('notesBtn');
    const panel    = document.getElementById('notesPanel');
    const overlay  = document.getElementById('notesPanelOverlay');
    const closeBtn = document.getElementById('notesPanelClose');
    if (!btn || !panel) return;

    const openPanel  = () => { panel.classList.add('active'); overlay?.classList.add('active'); };
    const closePanel = () => { panel.classList.remove('active'); overlay?.classList.remove('active'); };

    btn.addEventListener('click', openPanel);
    overlay?.addEventListener('click', closePanel);
    closeBtn?.addEventListener('click', closePanel);
}
_setupNotesPanel();

import('./tools-bridge.js').then(module => {
    module.setupToolsBridge({
        worker: workerController.toolsWorker,
        DOM: { log: document.getElementById('chatLog'), cmd: uiManager.cmdInput },
        submit: sendMessage
    });
}).catch(() => { });

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
}

const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const dismissBtn = document.getElementById('dismissInstallBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalState.pwaDeferredPrompt = e;
    if (!safeLocalStorage.getItem('james-pwa-dismissed')) {
        installBanner?.classList.remove('hidden');
    }
});

installBtn?.addEventListener('click', async () => {
    installBanner?.classList.add('hidden');
    if (globalState.pwaDeferredPrompt) {
        globalState.pwaDeferredPrompt.prompt();
        await globalState.pwaDeferredPrompt.userChoice;
        globalState.pwaDeferredPrompt = null;
    }
});

dismissBtn?.addEventListener('click', () => {
    installBanner?.classList.add('hidden');
    safeLocalStorage.setItem('james-pwa-dismissed', 'true');
});
