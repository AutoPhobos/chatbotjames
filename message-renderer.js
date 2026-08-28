import { CONFIG } from './config.js';
import { marked } from 'https://esm.sh/marked@11.1.0';
import DOMPurify from 'https://esm.sh/dompurify@3.0.8';

// Configure marked to use GitHub Flavored Markdown and breaks
marked.setOptions({
    gfm: true,
    breaks: true
});

const RENDER_WINDOW = CONFIG.ui.renderWindowMessages;
let _renderOffset = 0;
let _chatObserver = null;
let _lastRenderTime = 0;

let _getChatHistory = () => [];
let _getIsGenerating = () => false;
let _onEditUserMsg = null;
let _onAppendMsg = null;

export function setupMessageRenderer(options) {
    if (options.getChatHistory) _getChatHistory = options.getChatHistory;
    if (options.getIsGenerating) _getIsGenerating = options.getIsGenerating;
    if (options.onEditUserMsg) _onEditUserMsg = options.onEditUserMsg;
    if (options.onAppendMsg) _onAppendMsg = options.onAppendMsg;
}

export function updateStatusLight(state) {
    const led = document.querySelector('.status-led');
    if (!led) return;
    led.className = state === 'idle' ? 'status-led led-idle' : 'status-led led-thinking';
}

export function escapeHTML(raw) {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatAssistantMessage(text) {
    // ── Step 1: Extract tool:run blocks BEFORE parsing ────────────────────────
    const toolBoxes = [];
    const TOOL_PLACEHOLDER = 'TOOLBOX_PLACEHOLDER_XYZ_'; // Unique placeholder
    let processedText = text.replace(/```\s*tool:run\n?([\s\S]*?)```/g, (_, code) => {
        const lines = code.trim().split('\n');
        const toolName = escapeHTML(lines[0] || 'Unknown');
        const params = lines.slice(1).map(l => escapeHTML(l)).join('<br>');
        const html = `<div class="tool-usage-box" style="margin: 8px 0; padding: 10px; background: rgba(0,0,0,0.2); border-left: 3px solid #3b82f6; border-radius: 4px; font-family: monospace; font-size: 0.9em;">
            <div style="color: #60a5fa; font-weight: bold; margin-bottom: 4px;">\uD83D\uDD27 Tool: ${toolName}</div>
            <div style="color: #94a3b8;">${params}</div>
        </div>`;
        const idx = toolBoxes.push(html) - 1;
        return `\n\n${TOOL_PLACEHOLDER}${idx}\n\n`;
    });

    // ── Step 1.5: Extract <think> blocks ─────────────────────────────────────
    const thinkBoxes = [];
    const THINK_PLACEHOLDER = 'THINKBOX_PLACEHOLDER_XYZ_';
    
    // Match closed <think> blocks
    processedText = processedText.replace(/<think>([\s\S]*?)<\/think>/g, (_, content) => {
        const parsedContent = DOMPurify.sanitize(marked.parse(content.trim(), { async: false }));
        const html = `<details class="think-box" style="margin: 8px 0; background: rgba(0,0,0,0.1); border-left: 3px solid #8b5cf6; padding: 8px 12px; border-radius: 4px; font-size: 0.9em;"><summary style="color: #a78bfa; font-weight: bold; cursor: pointer; user-select: none;">🤔 Thinking Process</summary><div style="margin-top: 8px; color: #94a3b8;">${parsedContent}</div></details>`;
        const idx = thinkBoxes.push(html) - 1;
        return `\n\n${THINK_PLACEHOLDER}${idx}\n\n`;
    });

    // Match unclosed <think> block (for streaming)
    const unclosedThinkIdx = processedText.indexOf('<think>');
    if (unclosedThinkIdx !== -1) {
        const content = processedText.substring(unclosedThinkIdx + 7);
        const parsedContent = DOMPurify.sanitize(marked.parse(content.trim(), { async: false }));
        const html = `<details class="think-box" open style="margin: 8px 0; background: rgba(0,0,0,0.1); border-left: 3px solid #8b5cf6; padding: 8px 12px; border-radius: 4px; font-size: 0.9em;"><summary style="color: #a78bfa; font-weight: bold; cursor: pointer; user-select: none;">🤔 Thinking Process...</summary><div style="margin-top: 8px; color: #94a3b8;">${parsedContent}</div></details>`;
        const idx = thinkBoxes.push(html) - 1;
        processedText = processedText.substring(0, unclosedThinkIdx) + `\n\n${THINK_PLACEHOLDER}${idx}\n\n`;
    }

    // ── Step 2: Apply markdown formatting ────────────────────────────────────
    let html = marked.parse(processedText, { async: false });

    // ── Step 3: Sanitize the parsed HTML ─────────────────────────────────────
    html = DOMPurify.sanitize(html);

    // ── Step 4: Restore tool blocks & think blocks ────────────────────────────
    toolBoxes.forEach((box, i) => { 
        html = html.replace(`<p>${TOOL_PLACEHOLDER}${i}</p>`, box).replace(`${TOOL_PLACEHOLDER}${i}`, box); 
    });
    thinkBoxes.forEach((box, i) => { 
        html = html.replace(`<p>${THINK_PLACEHOLDER}${i}</p>`, box).replace(`${THINK_PLACEHOLDER}${i}`, box); 
    });

    return html;
}

export function appendUserMessage(text, historyIdx = -1) {
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
    editBtn.onclick = () => window.editUserMessage(historyIdx);

    const container = document.createElement('div');
    container.className = 'user-msg-container';
    container.appendChild(editBtn);
    container.appendChild(messageContent);

    messageWrap.appendChild(container);
    const gameBoardWrap = chatLog.querySelector('.game-board-wrap');
    if (gameBoardWrap) {
        chatLog.insertBefore(messageWrap, gameBoardWrap);
    } else {
        chatLog.appendChild(messageWrap);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
}

window.editUserMessage = function (historyIdx) {
    if (_getIsGenerating()) return;
    if (_onEditUserMsg) _onEditUserMsg(historyIdx);
};

export function updateLiveBubble(text, targetId, force = false) {
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
        const gameBoardWrap = chatLog.querySelector('.game-board-wrap');
        if (gameBoardWrap) {
            chatLog.insertBefore(messageWrap, gameBoardWrap);
        } else {
            chatLog.appendChild(messageWrap);
        }
    }

    if (text === '...') {
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        chatLog.scrollTop = chatLog.scrollHeight;
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

export function appendErrorToChat(errorMessage) {
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
    const gameBoardWrap = chatLog.querySelector('.game-board-wrap');
    if (gameBoardWrap) {
        chatLog.insertBefore(messageWrap, gameBoardWrap);
    } else {
        chatLog.appendChild(messageWrap);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
}

export function scrollToBottom() {
    const chatContainer = document.getElementById('chatLog') || document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/** Build a single message DOM element (shared by renderChatLog and loadOlderMessages). */
export function createMessageElement(msg, historyIdx = -1, isLastAssistant = false) {
    // Skip background-injected system messages entirely (used by append mode)
    if (msg.isBackground) {
        const el = document.createElement('div');
        el.style.display = 'none';
        return el;
    }
    if (msg.hidden) {
        const el = document.createElement('div');
        el.style.display = 'none';
        return el;
    }

    const messageWrap = document.createElement('div');
    if (msg.type === 'tool_result') {
        messageWrap.className = 'message-wrap tool-result-msg';
        const displayContent = msg.content.replace('[SYSTEM: Tool results below. Interpret them and reply naturally to the user.]\n', '');
        
        const details = document.createElement('details');
        details.style.cssText = 'background: rgba(0, 0, 0, 0.1); border-left: 3px solid #10b981; padding: 8px 12px; border-radius: 4px; margin: 8px 0; font-family: monospace; font-size: 0.85em; cursor: pointer; color: #94a3b8;';
        
        const summary = document.createElement('summary');
        summary.style.cssText = 'color: #34d399; font-weight: bold; margin-bottom: 4px; list-style: none; display: flex; align-items: center; gap: 6px; user-select: none;';
        summary.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> <span>Tool Result (Click to expand)</span>';
        
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin: 8px 0 0 0; white-space: pre-wrap; word-break: break-all; color: #cbd5e1; max-height: 300px; overflow-y: auto;';
        pre.textContent = displayContent;
        
        details.appendChild(summary);
        details.appendChild(pre);
        messageWrap.appendChild(details);
        return messageWrap;
    }
    if (msg.role === 'system') {
        messageWrap.className = 'message-wrap system-msg';
        if (msg.displayContent) {
            messageWrap.innerHTML = DOMPurify.sanitize(msg.displayContent);
        } else {
            messageWrap.style.cssText = 'text-align: center; color: #888; font-size: 12px; margin: 8px 0; font-family: monospace; opacity: 0.8;';
            messageWrap.textContent = msg.content;
        }
        return messageWrap;
    }
    messageWrap.className = `message-wrap ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;
    if (msg.type === 'game_board') {
        messageWrap.className = 'message-wrap assistant-msg game-board-wrap';
        messageWrap.style.cssText = 'align-items: center; justify-content: center; width: 100%; margin: 8px 0;';
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content game-board-message live-game-view';
        messageContent.id = 'liveGameView';
        messageWrap.appendChild(messageContent);
        return messageWrap;
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-msg-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy message';
    copyBtn.onclick = () => navigator.clipboard.writeText(msg.content);

    if (msg.role === 'assistant') {
        messageContent.innerHTML = formatAssistantMessage(msg.content);
        const container = document.createElement('div');
        container.className = 'assistant-msg-container';
        container.style.position = 'relative';
        container.appendChild(messageContent);
        container.appendChild(copyBtn);


        messageWrap.appendChild(container);
    } else {
        if (msg.displayContent) {
            messageContent.textContent = msg.displayContent;
        } else {
            let display = msg.content;
            const gameStateIdx = display.indexOf('\n\n[Game State]');
            if (gameStateIdx !== -1) display = display.substring(0, gameStateIdx);
            messageContent.textContent = display;
        }
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-msg-btn';
        editBtn.innerHTML = '\u270f\ufe0f';
        editBtn.title = 'Edit this message';
        editBtn.onclick = () => window.editUserMessage(historyIdx);
        const container = document.createElement('div');
        container.className = 'user-msg-container';
        container.style.position = 'relative';
        container.appendChild(editBtn);
        container.appendChild(copyBtn);
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
export function renderChatLog(options = {}) {
    const chatLog = options.chatLogEl || document.getElementById('chatLog');
    if (!chatLog) return;

    if (_chatObserver) { _chatObserver.disconnect(); _chatObserver = null; }
    chatLog.innerHTML = '';

    const history = options.chatHistory || _getChatHistory();
    const displayHistory = history.filter(m => m.type !== 'game_board');
    _renderOffset = Math.max(0, displayHistory.length - RENDER_WINDOW);

    if (_renderOffset > 0) {
        const sentinel = _makeSentinel();
        chatLog.appendChild(sentinel);
        _attachSentinelObserver(chatLog, sentinel);
    }

    // Find the index of the last assistant message so we can add the append button
    const sliced = displayHistory.slice(_renderOffset);
    const lastAssistantRelIdx = sliced.map((m, i) => ({ m, i })).filter(({ m }) => m.role === 'assistant' && !m.hidden && !m.isBackground).map(({ i }) => i).at(-1);
    sliced.forEach((msg, i) => chatLog.appendChild(createMessageElement(msg, _renderOffset + i, i === lastAssistantRelIdx)));

    // Render active game board at the bottom of the chat log ONLY IF a game is currently active in this memory context
    if (window.gameController && window.gameController.activeGame) {
        const gameWrap = document.createElement('div');
        gameWrap.className = 'message-wrap assistant-msg game-board-wrap';
        gameWrap.style.cssText = 'align-items: center; justify-content: center; width: 100%; margin: 12px 0 4px 0;';
        const gameContent = document.createElement('div');
        gameContent.className = 'message-content game-board-message live-game-view';
        gameContent.id = 'liveGameView';
        gameWrap.appendChild(gameContent);
        chatLog.appendChild(gameWrap);

        window.gameController.refreshGameBoardUI();
    }

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
    const rawHistory = _getChatHistory();
    const history = rawHistory.filter(m => m.type !== 'game_board');
    if (!chatLog || _renderOffset === 0 || !history.length) return;

    const batchSize = Math.min(20, _renderOffset);
    const newOffset = _renderOffset - batchSize;
    const olderMsgs = history.slice(newOffset, _renderOffset);
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
    olderMsgs.forEach((msg, i) => fragment.appendChild(createMessageElement(msg, newOffset + i, false)));
    chatLog.insertBefore(fragment, chatLog.firstChild);

    // Keep the user's viewport stable (no jump)
    chatLog.scrollTop = chatLog.scrollHeight - prevScrollHeight;

    // Re-attach observer if more messages remain
    if (_renderOffset > 0) {
        const newSentinel = document.getElementById('chat-sentinel');
        if (newSentinel) _attachSentinelObserver(chatLog, newSentinel);
    }
};
