import { smallTalk } from './smalltalk.js';
import { toolRouter } from './tool-router.js';

// ─── Sound Engine (Web Audio API, no external files) ─────────────────────────
const _audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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

// Soft blip when user sends a message
function playSendSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 880, type: 'sine', gainPeak: 0.10, duration: 0.10, rampUp: 0.005, rampDown: 0.09 });
}

// Pleasant two-note chime when JAMES finishes responding
function playDoneSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 523.25, type: 'sine', gainPeak: 0.10, duration: 0.18, rampUp: 0.01 }); // C5
    setTimeout(() => _playTone({ freq: 783.99, type: 'sine', gainPeak: 0.08, duration: 0.22, rampUp: 0.01 }), 120); // G5
}
// ─────────────────────────────────────────────────────────────────────────────

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
let _isGeneratingUI = false;
function setIdleState(isIdle) {
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
        sendBtn.disabled = false; // Always keep enabled so we can stop
        _isGeneratingUI = true;

        cmdInput.classList.add('loading-state');
        cmdInput.placeholder = "JAMES is busy...";
    }
}

// Global Message Handler
let lastUpdate = 0;
let _gpuInfo = null;          // cached from worker 'model-info'
let _presets = [];            // cached from worker 'model-info'
let _activePresetId = null;   // the currently running preset
let _selectedPresetId = null; // user's pending selection in the panel
let _deviceRamGB = 4;         // from navigator.deviceMemory via worker

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

// ─── Window Memory Helper ───────────────────────────────────────────────────
const MAX_HISTORY = 10;

function getMessagesWindow(messages) {
    if (!messages || messages.length <= MAX_HISTORY) return messages;
    // Keep the first message (welcome/system context) and the most recent (MAX_HISTORY - 1)
    return [messages[0], ...messages.slice(-(MAX_HISTORY - 1))];
}

worker.onmessage = (e) => {
    const { status, message, loaded, total, file, targetId } = e.data;
    const statusText = document.getElementById('statusText');

    // 1. Force the status text to update properly for every state
    if (status === 'done' || status === 'complete' || status === 'error' || status === 'aborted') {
        setIdleState(true);
        updateStatusLight('idle');
        if (statusText) statusText.textContent = 'READY';
        if (status !== 'error' && status !== 'aborted') playDoneSound();
    } else {
        setIdleState(false);
        updateStatusLight('thinking');
        if (status === 'thinking' && statusText) statusText.textContent = 'THINKING...';
        if (status === 'streaming' && statusText) statusText.textContent = 'RESPONDING...';
    }

    switch (status) {
        case 'clear-last-preset':
            localStorage.removeItem('james-last-preset-id');
            console.log('🗑️ Cleared stale last-preset cache');
            break;

        case 'model-info': {
            // Worker detected GPU and compiled preset list — render the panel
            _gpuInfo = e.data.gpuInfo;
            _presets = e.data.presets;
            _deviceRamGB = e.data.ramGB ?? 4;
            renderModelPanel();
            break;
        }

        case 'warm-start': {
            // Worker is attempting to resume the last successfully loaded model
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
            const fill = document.querySelector('.progress-fill');
            const meta = document.querySelector('.status-meta');

            if (fill) fill.style.width = `${percent}%`;
            if (meta) {
                const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
                const mbTotal = (total / 1024 / 1024).toFixed(1);
                meta.innerText = `Downloading: ${file || 'weights'} (${mbLoaded}/${mbTotal} MB)`;
            }
            if (statusText) statusText.textContent = `DOWNLOADING (${Math.round(percent)}%)...`;
            break;
        }
        case 'done': {
            const metaDone = document.querySelector('.status-meta');
            const backend = e.data.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
            const deviceTag = e.data.isTV ? ' · TV Mode' : e.data.isMobile ? ' · Lightweight Mode' : '';
            if (metaDone) metaDone.innerText = `JAMES is online (${backend}${deviceTag})`;

            const fillDone = document.querySelector('.progress-fill');
            if (fillDone) fillDone.style.width = "100%";
            if (statusText) statusText.textContent = 'READY';

            // Find which preset is now running and mark it
            const runningPreset = _presets.find(
                p => p.backend === e.data.backend && p.dtype === e.data.dtype && p.model === e.data.model
            );
            if (runningPreset) {
                _activePresetId = runningPreset.id;
                _selectedPresetId = runningPreset.id;
                // ✔ Persist for warm-start on next page load
                localStorage.setItem('james-last-preset-id', runningPreset.id);
                refreshPresetCards();
                const lbl = document.getElementById('activeModelLabel');
                if (lbl) lbl.textContent = `Active: ${runningPreset.label}`;
                const applyBtn = document.getElementById('applyModelBtn');
                if (applyBtn) applyBtn.disabled = true;
            }
            break;
        }
        case 'streaming':
            // Only stream to the UI if we are still on the chat that requested it
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
};

async function handleToolCalls(message, targetId, originChatId) {
    const toolCalls = parseToolCalls(message);

    if (toolCalls.length === 0) {
        // If the user is still on the chat that initiated this request, update live.
        if (originChatId === currentChatId) {
            updateLiveBubble(message, targetId);
            chatHistory.push({ role: 'assistant', content: message });
            persistCurrentChat();
        } else {
            // Background update: user switched chats while this was generating.
            const bgChat = allChats.find(c => c.id === originChatId);
            if (bgChat) {
                bgChat.messages.push({ role: 'assistant', content: message });
                localStorage.setItem('chatbot-chats', JSON.stringify(allChats));
            }
        }
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

    // Persist the tool-call exchange (assistant tool call + user result) into the
    // correct chat history so context is intact on reload.
    const assistantToolTurn = { role: 'assistant', content: message };
    const toolResultTurn = { role: 'user', content: toolResultText };

    if (originChatId === currentChatId) {
        chatHistory.push(assistantToolTurn, toolResultTurn);
    } else {
        const bgChat = allChats.find(c => c.id === originChatId);
        if (bgChat) bgChat.messages.push(assistantToolTurn, toolResultTurn);
    }
    // Persist to localStorage so the history survives a reload.
    localStorage.setItem('chatbot-chats', JSON.stringify(allChats));

    // We must pass the correct chat array down. If the user switched chats, we use the background chat's array.
    const activeMessages = originChatId === currentChatId
        ? chatHistory
        : (allChats.find(c => c.id === originChatId)?.messages || []);

    // Update the original bubble so it doesn't stay as a frozen "..." forever.
    // We reuse the same targetId so the final answer overwrites this placeholder.
    if (originChatId === currentChatId) {
        const toolNames = toolCalls.map(c => c.tool).join(', ');
        updateLiveBubble(`🔧 Used tool: ${toolNames} — thinking…`, targetId);
    }

    // Apply the sliding memory window constraint before hitting inference again
    const messagesForModel = getMessagesWindow(activeMessages);

    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId,        // reuse the original bubble so it gets replaced by the answer
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

                    // Each line is one param: "key: value"
                    // Do NOT split on commas first — values can contain commas (e.g. "location: New York, NY")
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
    if (toolName === 'search_web') {
        try {
            const results = await import('./tools-search.js').then(m => m.performWebSearch(params.query || params.q));
            return results;
        } catch (error) {
            throw new Error('Web search failed: ' + error.message);
        }
    }
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

// toolsWorker messages are handled per-call via addEventListener inside executeTool.
// Timer messages are handled by the listener set up in tools-bridge.js setupToolsBridge.

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
        .replace(/(^|\n)#####\s*(.+)/g, '$1<h5>$2</h5>')
        .replace(/(^|\n)####\s*(.+)/g, '$1<h4>$2</h4>')
        .replace(/(^|\n)###\s*(.+)/g, '$1<h3>$2</h3>')
        .replace(/(^|\n)##\s*(.+)/g, '$1<h2>$2</h2>')
        .replace(/(^|\n)#\s*(.+)/g, '$1<h1>$2</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
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

    if (text === '...') {
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    } else {
        bubble.innerHTML = formatAssistantMessage(text);
    }
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
            cannedText = `⏱️ Timer started for **${result.seconds} seconds**. Watch the countdown widget above.`;
        } else if (toolName === 'python') {
            cannedText = result
                ? `Python output:\n\n\`\`\`\n${result}\n\`\`\``
                : `Python executed successfully with no output.`;
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
    if (!text || _isGeneratingUI) return;

    chatHistory.push({ role: 'user', content: text });
    appendUserMessage(text);
    cmdInput.value = '';

    // Sound + visual ripple on send
    playSendSound();
    sendBtn.classList.add('sending');
    sendBtn.addEventListener('animationend', () => sendBtn.classList.remove('sending'), { once: true });

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

    setIdleState(false);

    // Apply the sliding memory window constraint before hitting inference
    const messagesForModel = getMessagesWindow(chatHistory);

    worker.postMessage({
        type: 'query',
        messages: messagesForModel,
        targetId: Date.now(),
        chatId: currentChatId
    });
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
        content: `✨ **JAMES — Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
📱 Running in **lightweight mode** — tool use may be limited on this device.
${toolsBlock}
💬 Type a message below to begin.`
    };
}

function getFullWelcomeMessage(showTools = true) {
    const toolsBlock = showTools 
        ? `───────────────

🧰 **Tools available**
───────────────
🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🔍 search
🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard
───────────────

` 
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
🔄 Every session starts fresh.

${toolsBlock}💬 Type a message below to begin.`
    };
}

function getTVWelcomeMessage(showTools = true) {
    const toolsBlock = showTools 
        ? `\n───────────────\n🧰 **Tools available**\n───────────────\n🌤️ weather · ⏰ time · 💱 currency · 📚 wikipedia · 🔍 search\n🔑 uuid · 🔐 password · 🎨 palette · ⏳ timer · 📋 clipboard\n───────────────\n` 
        : '';

    return {
        role: 'assistant',
        content: `✨ **JAMES — Your local, private AI assistant.**
🛡️ Runs entirely in this browser — nothing leaves your device.
📺 Running in **TV mode** — lightweight model loaded for this device.
${toolsBlock}
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

        if (msg.role === 'assistant') {
            messageContent.innerHTML = formatAssistantMessage(msg.content);
            messageWrap.appendChild(messageContent);
        } else {
            messageContent.textContent = msg.content;

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-msg-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit this message';
            editBtn.onclick = () => window.editUserMessage(msg.content);

            const container = document.createElement('div');
            container.className = 'user-msg-container';
            container.appendChild(editBtn);
            container.appendChild(messageContent);
            messageWrap.appendChild(container);
        }

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
        chatText.style.pointerEvents = 'none'; // Ensure clicks bubble to the item

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
const _savedLastPresetId = localStorage.getItem('james-last-preset-id');
worker.postMessage({
    type: 'init',
    // Key must match the one written in the 'done' handler: 'james-last-preset-id' (lowercase)
    lastPresetId: _savedLastPresetId || null,
});
pythonWorker.postMessage({ type: 'init' });

// Show a helpful initial status — if we know the last model, say so
if (_savedLastPresetId) {
    document.getElementById('statusText').textContent = 'RESUMING LAST MODEL…';
} else {
    document.getElementById('statusText').textContent = 'INITIALIZING...';
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

sendBtn.addEventListener('click', () => {
    if (_isGeneratingUI) {
        // Send abort to worker
        worker.postMessage({ type: 'abort' });

        // Immediately reset UI state and indicators
        setIdleState(true);
        updateStatusLight('idle');
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.textContent = 'READY';

        // Flush active streaming queues so partial text remains visible
        streamQueues.forEach((_, targetId) => flushStreamQueue(targetId));
    } else {
        sendMessage();
    }
});
cmdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !_isGeneratingUI) sendMessage();
});

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
    localStorage.setItem('james-pwa-dismissed', 'true');
});

// ─── Model Selection Panel ────────────────────────────────────────────────────

const modelPanel = document.getElementById('modelPanel');
const modelPanelOverlay = document.getElementById('modelPanelOverlay');
const modelPanelBtn = document.getElementById('modelPanelBtn');
const modelPanelClose = document.getElementById('modelPanelClose');
const applyModelBtn = document.getElementById('applyModelBtn');

function openModelPanel() {
    modelPanel.classList.add('open');
    modelPanelOverlay.classList.add('visible');
}

function closeModelPanel() {
    modelPanel.classList.remove('open');
    modelPanelOverlay.classList.remove('visible');
}

modelPanelBtn?.addEventListener('click', openModelPanel);
modelPanelClose?.addEventListener('click', closeModelPanel);
modelPanelOverlay?.addEventListener('click', closeModelPanel);

/** Render (or re-render) the GPU status card and preset list. */
function renderModelPanel() {
    // ── GPU status card (informational only) ─────────────────────────────────
    const card = document.getElementById('gpuStatusCard');
    const icon = document.getElementById('gpuStatusIcon');
    const title = document.getElementById('gpuStatusTitle');
    const detail = document.getElementById('gpuStatusDetail');
    const badge = document.getElementById('gpuStatusBadge');

    if (_gpuInfo && card) {
        const { hasGpu, vendor, maxStorageMB, reason, isFallback } = _gpuInfo;

        if (hasGpu) {
            card.className = 'gpu-status-card gpu-ok';
            icon.textContent = '🚀';
            title.textContent = 'GPU Acceleration Available';
            badge.textContent = 'WebGPU';
        } else if (!navigator.gpu) {
            card.className = 'gpu-status-card gpu-none';
            icon.textContent = '❌';
            title.textContent = 'WebGPU Not Supported';
            badge.textContent = 'NO GPU';
        } else if (isFallback) {
            card.className = 'gpu-status-card gpu-warn';
            icon.textContent = '⚠️';
            title.textContent = 'Software Adapter Only';
            badge.textContent = 'SW ONLY';
        } else {
            card.className = 'gpu-status-card gpu-warn';
            icon.textContent = '⚠️';
            title.textContent = 'Integrated GPU — CPU Fallback';
            badge.textContent = 'CPU';
        }

        const vendorStr = vendor ? `Vendor: ${vendor}` : 'Vendor: hidden by browser';
        const bufStr = maxStorageMB ? ` · Buffer: ${maxStorageMB.toFixed(0)} MB` : '';
        const ramStr = `Device RAM: ~${_deviceRamGB} GB`;
        detail.textContent = `${reason}\n${vendorStr}${bufStr} · ${ramStr}`;
    }

    // ── Preset cards (grouped by category, all always enabled) ───────────────
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

        // Section divider
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

            // All presets are always clickable — user knows what they're doing
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
    document.getElementById('statusText').textContent = 'LOADING MODEL…';

    worker.postMessage({ type: 'init', forcePresetId: _selectedPresetId });
});