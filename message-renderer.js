import { CONFIG } from './config.js';

const RENDER_WINDOW = CONFIG.ui.renderWindowMessages;
let _renderOffset = 0;
let _chatObserver = null;
let _lastRenderTime = 0;

let _getChatHistory = () => [];
let _getIsGenerating = () => false;
let _onEditUserMsg = null;

export function setupMessageRenderer(options) {
    if (options.getChatHistory) _getChatHistory = options.getChatHistory;
    if (options.getIsGenerating) _getIsGenerating = options.getIsGenerating;
    if (options.onEditUserMsg) _onEditUserMsg = options.onEditUserMsg;
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
    // ── Step 1: Extract tool:run blocks BEFORE HTML escaping ──────────────────
    const toolBoxes = [];
    const TOOL_PLACEHOLDER = '\x01TOOLBOX_'; // \x01 is not affected by escapeHTML
    const textWithPlaceholders = text.replace(/```\s*tool:run\n?([\s\S]*?)```/g, (_, code) => {
        const lines = code.trim().split('\n');
        const toolName = escapeHTML(lines[0] || 'Unknown');
        const params = lines.slice(1).map(l => escapeHTML(l)).join('<br>');
        const html = `<div class="tool-usage-box" style="margin: 8px 0; padding: 10px; background: rgba(0,0,0,0.2); border-left: 3px solid #3b82f6; border-radius: 4px; font-family: monospace; font-size: 0.9em;">
            <div style="color: #60a5fa; font-weight: bold; margin-bottom: 4px;">\uD83D\uDD27 Tool: ${toolName}</div>
            <div style="color: #94a3b8;">${params}</div>
        </div>`;
        const idx = toolBoxes.push(html) - 1;
        return `${TOOL_PLACEHOLDER}${idx}\x01`;
    });

    // ── Step 2: Escape HTML on remaining text ─────────────────────────────────
    let html = escapeHTML(textWithPlaceholders);

    // ── Step 3: Apply markdown formatting ────────────────────────────────────
    html = html
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
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
            const rawUrl = url.trim();
            const lowerUrl = rawUrl.toLowerCase();
            const isUnsafe = lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:') || lowerUrl.startsWith('vbscript:');
            const cleanUrl = isUnsafe ? '#' : escapeHTML(rawUrl);
            return `<a href="${cleanUrl}" target="_blank" rel="noreferrer noopener">${linkText}</a>`;
        })
        .replace(/\n/g, '<br>');

    // ── Step 4: Restore tool blocks (placeholders survive escapeHTML intact) ──
    toolBoxes.forEach((box, i) => { html = html.replace(`${TOOL_PLACEHOLDER}${i}\x01`, box); });

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
    chatLog.appendChild(messageWrap);
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
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;
}

export function scrollToBottom() {
    const chatContainer = document.getElementById('chatLog') || document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/** Build a single message DOM element (shared by renderChatLog and loadOlderMessages). */
export function createMessageElement(msg, historyIdx = -1) {
    if (msg.hidden) {
        const el = document.createElement('div');
        el.style.display = 'none';
        return el;
    }

    const messageWrap = document.createElement('div');
    if (msg.role === 'system') {
        messageWrap.className = 'message-wrap system-msg';
        messageWrap.style.cssText = 'text-align: center; color: #888; font-size: 12px; margin: 8px 0; font-family: monospace; opacity: 0.8;';
        messageWrap.textContent = msg.content;
        return messageWrap;
    }
    messageWrap.className = `message-wrap ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;
    if (msg.type === 'game_board') {
        messageWrap.classList.add('game-board-placeholder');
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content game-board-message';
        messageContent.id = `game-board-container`;
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
        messageContent.textContent = msg.content;
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
export function renderChatLog() {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;

    if (_chatObserver) { _chatObserver.disconnect(); _chatObserver = null; }
    chatLog.innerHTML = '';

    const history = _getChatHistory();
    _renderOffset = Math.max(0, history.length - RENDER_WINDOW);

    if (_renderOffset > 0) {
        const sentinel = _makeSentinel();
        chatLog.appendChild(sentinel);
        _attachSentinelObserver(chatLog, sentinel);
    }

    history.slice(_renderOffset).forEach((msg, i) => chatLog.appendChild(createMessageElement(msg, _renderOffset + i)));
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
    const history = _getChatHistory();
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
    olderMsgs.forEach((msg, i) => fragment.appendChild(createMessageElement(msg, newOffset + i)));
    chatLog.insertBefore(fragment, chatLog.firstChild);

    // Keep the user's viewport stable (no jump)
    chatLog.scrollTop = chatLog.scrollHeight - prevScrollHeight;

    // Re-attach observer if more messages remain
    if (_renderOffset > 0) {
        const newSentinel = document.getElementById('chat-sentinel');
        if (newSentinel) _attachSentinelObserver(chatLog, newSentinel);
    }
};
