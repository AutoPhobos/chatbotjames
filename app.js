import { smallTalk } from './smalltalk.js';
import { toolRouter } from './tool-router.js';
// Initialize Workers
const worker = new Worker('worker.js', { type: 'module' });
const toolsWorker = new Worker('tools-worker.js', { type: 'module' });
const pythonWorker = new Worker('python-worker.js');
const pythonCallbacks = new Map();

// UI References
const cmdInput = document.getElementById('cmdInput');
const sendBtn = document.getElementById('sendBtn');

/**
 * Modern UI Toggle
 * Manages the "Redesign" state and interaction locks
 */
function setIdleState(isIdle) {
    cmdInput.disabled = !isIdle;
    sendBtn.disabled = !isIdle;

    if (isIdle) {
        cmdInput.classList.remove('loading-state');
        cmdInput.placeholder = "Message James...";
        cmdInput.focus();
    } else {
        cmdInput.classList.add('loading-state');
        cmdInput.placeholder = "James is busy...";
    }
}

// Global Message Handler
let lastUpdate = 0;

// ─── Word-by-word Streaming Animation ────────────────────────────────────────
const streamQueues = new Map(); // targetId → { pending, displayed, running }

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

    // Advance to the end of the next word
    const from = state.displayed.length;
    const nextSpace = state.pending.indexOf(' ', from + 1);
    state.displayed = state.pending.slice(0, nextSpace === -1 ? state.pending.length : nextSpace + 1);
    updateLiveBubble(state.displayed, targetId);

    setTimeout(() => drainStreamQueue(targetId), 35);
}

function flushStreamQueue(targetId) {
    const state = streamQueues.get(targetId);
    if (state) updateLiveBubble(state.pending, targetId);
    streamQueues.delete(targetId);
}

worker.onmessage = (e) => {
    const { status, message, loaded, total, file, targetId } = e.data;
    const statusText = document.getElementById('statusText');

    // 1. Force the status text to update properly for every state
    if (status === 'done' || status === 'complete' || status === 'error') {
        setIdleState(true);
        updateStatusLight('idle');
        if (statusText) statusText.textContent = 'READY';
    } else {
        setIdleState(false);
        updateStatusLight('thinking');
        if (status === 'thinking' && statusText) statusText.textContent = 'THINKING...';
        if (status === 'streaming' && statusText) statusText.textContent = 'RESPONDING...';
    }

    switch (status) {
        case 'downloading': {
            const now = Date.now();
            if (now - lastUpdate < 100) return;
            lastUpdate = now;

            const percent = total ? (loaded / total * 100) : 0;
            const fill = document.querySelector('.progress-fill');
            const meta = document.querySelector('.status-meta');

            if (fill) fill.style.width = `${percent}%`;
            if (meta) {
                const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
                const mbTotal  = (total  / 1024 / 1024).toFixed(1);
                meta.innerText = `Downloading: ${file || 'weights'} (${mbLoaded}/${mbTotal} MB)`;
            }
            if (statusText) statusText.textContent = `DOWNLOADING (${Math.round(percent)}%)...`;
            break;
        }
        case 'done': {
            const metaDone = document.querySelector('.status-meta');
            const backend = e.data.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
            const deviceTag = e.data.isTV ? ' · TV Mode' : e.data.isMobile ? ' · Lightweight Mode' : '';
            if (metaDone) metaDone.innerText = `James is online (${backend}${deviceTag})`;

            const fillDone = document.querySelector('.progress-fill');
            if (fillDone) fillDone.style.width = "100%";
            if (statusText) statusText.textContent = 'READY';
            break;
        }
        case 'streaming':
            queueStreamText(targetId, message);
            break;
            
        case 'thinking':
            updateLiveBubble("...", targetId);
            break;
        
        case 'complete':
            flushStreamQueue(targetId);
            handleToolCalls(message, targetId);
            break;

        case 'error': {
            const errorText = typeof message === 'string' ? message : JSON.stringify(message);
            console.error('James Error payload:', e.data);
            appendErrorToChat(errorText);
            const metaErr = document.querySelector('.status-meta');
            if (metaErr) metaErr.innerText = `Error initializing or generating: ${errorText}`;
            if (statusText) statusText.textContent = 'ERROR';
            break;
        }
    }
};

async function handleToolCalls(message, targetId) {
    const toolCalls = parseToolCalls(message);

    if (toolCalls.length === 0) {
        updateLiveBubble(message, targetId);
        chatHistory.push({ role: 'assistant', content: message });
        persistCurrentChat();
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
            ? `[${r.tool} error]: ${r.error}`
            : `[${r.tool} result]: ${JSON.stringify(r.result)}`
    ).join('\n');

    // Spread full chatHistory so the model knows the original question,
    // then append the assistant's tool-call turn and the tool results.
    worker.postMessage({
        type: 'query',
        messages: [
            ...chatHistory,
            { role: 'assistant', content: message },
            { role: 'user',      content: toolResultText }
        ],
        targetId: Date.now()
    });
}

function parseToolCalls(text) {
    // Capture everything between ```tool:run and ``` — let JSON.parse handle nested objects.
    // The old [^}]* pattern broke on params: { ... } because it stopped at the first }.
    const toolRegex = /```tool:run\s*([\s\S]*?)\s*```/g;
    const calls = [];
    let match;
    while ((match = toolRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.tool && parsed.params) calls.push(parsed);
        } catch (e) {
            console.error('Failed to parse tool call:', match[1], e);
        }
    }
    return calls;
}

async function executeTool(toolName, params) {
    if (toolName === 'location') {
        try {
            const location = await import('./tools-bridge.js').then(m => m.getLocation());
            return location;
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
            const execId = Date.now() + Math.random();
            const handler = (e) => {
                if (e.data.execId === execId) {
                    pythonWorker.removeEventListener('message', handler);
                    e.data.status === 'done'
                        ? resolve(e.data.output)
                        : reject(new Error(e.data.error || 'Python execution failed'));
                }
            };
            pythonWorker.addEventListener('message', handler);
            pythonWorker.postMessage({ type: 'run', code: params.code, execId });
            setTimeout(() => {
                pythonWorker.removeEventListener('message', handler);
                reject(new Error('Python execution timed out'));
            }, 30000);
        });
    }

    return new Promise((resolve, reject) => {
        const execId = Date.now() + Math.random();
        const handler = (e) => {
            if (e.data.execId === execId) {
                toolsWorker.removeEventListener('message', handler);
                if (e.data.status === 'done') resolve(e.data.result);
                else if (e.data.status === 'error') reject(new Error(e.data.error));
            }
        };
        toolsWorker.addEventListener('message', handler);
        toolsWorker.postMessage({ execId, tool: toolName, params });
        setTimeout(() => {
            toolsWorker.removeEventListener('message', handler);
            reject(new Error('Tool execution timeout'));
        }, 30000);
    });
}

toolsWorker.onmessage = (e) => {
    if (e.data.status === 'timer') { /* handled by tools-bridge.js */ }
};

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
        .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
        .replace(/(^|\n)######\s*(.+)/g, '$1<h6>$2</h6>')
        .replace(/(^|\n)#####\s*(.+)/g,  '$1<h5>$2</h5>')
        .replace(/(^|\n)####\s*(.+)/g,   '$1<h4>$2</h4>')
        .replace(/(^|\n)###\s*(.+)/g,    '$1<h3>$2</h3>')
        .replace(/(^|\n)##\s*(.+)/g,     '$1<h2>$2</h2>')
        .replace(/(^|\n)#\s*(.+)/g,      '$1<h1>$2</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,     '<em>$1</em>')
        .replace(/`([^`\n]+?)`/g,  '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
        .replace(/\n/g, '<br>');
}

function appendUserMessage(text) {
    const chatLog = document.getElementById('chatLog');
    const messageWrap = document.createElement('div');
    messageWrap.className = 'message-wrap user-msg';
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = text;
    messageWrap.appendChild(messageContent);
    chatLog.appendChild(messageWrap);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function updateLiveBubble(text, targetId) {
    const chatLog = document.getElementById('chatLog');
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
    
    bubble.innerHTML = formatAssistantMessage(text);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendErrorToChat(errorMessage) {
    const chatLog = document.getElementById('chatLog');
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

    if (statusText) statusText.textContent = 'RESPONDING...';
    queueStreamText(targetId, canned);

    const wordCount = canned.split(/\s+/).length;
    await new Promise(r => setTimeout(r, wordCount * 35 + 300));

    chatHistory.push({ role: 'assistant', content: canned });
    persistCurrentChat();
    setIdleState(true);
    updateStatusLight('idle');
    if (statusText) statusText.textContent = 'READY';
}

async function executeDirectTool(toolName, params) {
    const targetId = Date.now();
    const statusText = document.getElementById('statusText');

    setIdleState(false);
    updateStatusLight('thinking');
    if (statusText) statusText.textContent = 'USING TOOL...';
    updateLiveBubble('...', targetId);

    try {
        const result = await executeTool(toolName, params);
        
        let cannedText = '';
        if (toolName === 'weather') {
            cannedText = `The weather in ${result.location} is ${result.condition.toLowerCase()} with a temperature of ${result.temperature}.`;
        } else if (toolName === 'currency') {
            cannedText = `${result.amount} ${result.from} is equal to ${result.converted} ${result.to}. (Rate: ${result.rate})`;
        } else if (toolName === 'time') {
            cannedText = `The current time in ${result.timezone} is ${result.time}.`;
        } else if (toolName === 'websearch') {
            cannedText = `I couldn't find a direct answer. [Click here to search DuckDuckGo for "${result.query}"](${result.url})`;
        } else if (toolName === 'wikipedia') {
            if (result.type === 'fallback') {
                cannedText = `No Wikipedia article found. [Click here to search DuckDuckGo for "${result.query}"](${result.url})`;
            } else {
                cannedText = `Here is a summary for "${result.title}" from Wikipedia:\n\n${result.summary}\n\n[Read more on Wikipedia](${result.url})`;
            }
        } else if (toolName === 'uuid') {
            cannedText = `Here are your generated UUIDs:\n\n${result.uuids.join('\n')}`;
        } else if (toolName === 'password') {
            cannedText = `Here is your generated password:\n\n${result.passwords.join('\n')}`;
        } else if (toolName === 'timer') {
            cannedText = `I have started a timer for ${result.seconds} seconds.`;
        } else if (toolName === 'date') {
            if (result.iso) cannedText = `The current date/time is ${result.local}.`;
            else if (result.days !== undefined) cannedText = `The difference is ${result.days} days, ${result.hours} hours, and ${result.minutes} minutes.`;
            else if (result.formatted) cannedText = `The date is ${result.day}, ${result.formatted}.`;
            else cannedText = `Date tool result:\n${JSON.stringify(result, null, 2)}`;
        } else if (toolName === 'location') {
            cannedText = `Your current location is Latitude: ${result.latitude}, Longitude: ${result.longitude} (Accuracy: ${result.accuracy}).`;
        } else if (toolName === 'clipboard') {
            cannedText = `Your clipboard contains:\n\n${result.content}`;
        } else {
            cannedText = `Tool ${toolName} completed:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        }

        // Bypass the LLM entirely! Stream the formatted response.
        simulateCannedResponse(cannedText, targetId);
    } catch (err) {
        const msg = `⚠️ Tool error (${toolName}): ${err.message}`;
        updateLiveBubble(msg, targetId);
        chatHistory.push({ role: 'assistant', content: msg });
        persistCurrentChat();
        setIdleState(true);
        updateStatusLight('idle');
        if (statusText) statusText.textContent = 'READY';
    }
}

function sendMessage() {
    const text = cmdInput.value.trim();
    if (!text || cmdInput.disabled) return;

    chatHistory.push({ role: 'user', content: text });
    appendUserMessage(text);
    cmdInput.value = '';

    if (currentChatId) {
        const chat = allChats.find(c => c.id === currentChatId);
        if (chat && chat.name === 'New Chat') {
            chat.name = text.substring(0, 30) + (text.length > 30 ? '...' : '');
            localStorage.setItem('chatbot-chats', JSON.stringify(allChats));
            updateChatList();
            updateChatListActive(currentChatId);
        }
    }

    // 1. Small talk — instant canned response, no LLM
    const canned = smallTalk.match(text);
    if (canned) {
        simulateCannedResponse(canned);
        return;
    }

    // 2. Regex tool routing — guaranteed tool execution, LLM only formats result
    const route = toolRouter.match(text);
    if (route) {
        executeDirectTool(route.tool, route.params);
        return;
    }

    setIdleState(false);
    worker.postMessage({
        type: 'query',
        messages: chatHistory,
        targetId: Date.now()
    });
}

// ─── Chat History Management ────────────────────────────────────────────────

let chatHistory   = [];
let allChats      = [];
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

function getLightweightWelcomeMessage() {
    return {
        role: 'assistant',
        content: `✨ **Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
📱 Running in **lightweight mode** — tool use may be limited on this device.

💬 Type a message below to begin.`
    };
}

function getFullWelcomeMessage() {
    return {
        role: 'assistant',
        content: `✨ **Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
🔄 Every session starts fresh.

───────────────

🧰 **Tools available**
───────────────
🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia
🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard
───────────────

💬 Type a message below to begin.`
    };
}

function getTVWelcomeMessage() {
    return {
        role: 'assistant',
        content: `✨ **Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
📺 Running in **TV mode** — lightweight model loaded for this device.

💬 Use a keyboard or remote to type a message below.`
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
        localStorage.setItem('chatbot-chats', JSON.stringify(allChats));
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
    localStorage.setItem('chatbot-chats', JSON.stringify(allChats));

    updateChatList();
    renderChatLog();
    updateChatListActive(currentChatId);
    cmdInput.focus();
}

function renderChatLog() {
    const chatLog = document.getElementById('chatLog');
    chatLog.innerHTML = '';
    chatHistory.forEach(msg => {
        const messageWrap = document.createElement('div');
        messageWrap.className = `message-wrap ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`;
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.innerHTML = msg.role === 'assistant'
            ? formatAssistantMessage(msg.content)
            : (messageContent.textContent = msg.content, messageContent.textContent);
        messageWrap.appendChild(messageContent);
        chatLog.appendChild(messageWrap);
    });
    chatLog.scrollTop = chatLog.scrollHeight;
}

function updateChatList() {
    const chatListEl = document.getElementById('chatList');
    chatListEl.innerHTML = '';
    allChats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chatId = chat.id;

        const chatText = document.createElement('span');
        chatText.textContent = chat.name;
        chatText.onclick = () => loadChatHistory(chat.id);

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
    localStorage.setItem('chatbot-chats', JSON.stringify(allChats));

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

function loadSavedChats() {
    const saved = localStorage.getItem('chatbot-chats');
    if (saved) {
        try { allChats = JSON.parse(saved); } catch { allChats = []; }
        updateChatList();
    }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

loadSavedChats();

if (allChats.length > 0) {
    loadChatHistory(allChats[0].id);
} else {
    startNewChat();
}

// Apply device-specific body classes
if (isTVDevice()) {
    document.body.classList.add('tv-mode');
    document.getElementById('sidebar').classList.add('collapsed');
}
if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('collapsed');

// Start loading the model immediately
setIdleState(false);
worker.postMessage({ type: 'init' });
pythonWorker.postMessage({ type: 'init' });
document.getElementById('statusText').textContent = 'INITIALIZING...';

// ─── Event Listeners ─────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendMessage);
cmdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

document.getElementById('newChatBtn').addEventListener('click', startNewChat);

function closeSidebar() {
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('sidebarOverlay').classList.remove('visible');
}

document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const nowCollapsed = sidebar.classList.toggle('collapsed');
    overlay.classList.toggle('visible', !nowCollapsed);
});

document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

import('./tools-bridge.js').then(module => {
    module.setupToolsBridge({
        worker: toolsWorker,
        DOM: { log: document.getElementById('chatLog'), cmd: cmdInput },
        submit: sendMessage
    });
});

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
    
    if (!localStorage.getItem('james-pwa-dismissed')) {
        installBanner.classList.remove('hidden');
    }
});

installBtn?.addEventListener('click', async () => {
    installBanner.classList.add('hidden');
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
    }
});

dismissBtn?.addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('james-pwa-dismissed', 'true');
});