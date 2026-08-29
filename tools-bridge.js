// tools-bridge.js
// Handles browser APIs that workers can't access directly.
// Import this in your main thread and call setupToolsBridge(neuralLink)

import { executeSearch } from './tools-search.js';

// ── Tool Parsing (Bypass Markdown & sanitize quotes) ───────────────────────
export function extractToolCall(text) {
    // Matches {"tool": "...", "params": {...}} using either single or double quotes
    const regex = /\{\s*['"]tool['"]\s*:\s*['"]([a-zA-Z0-9_]+)['"]\s*,\s*['"]params['"]\s*:\s*(\{[\s\S]*?\})\s*\}/;
    const match = text.match(regex);

    if (match) {
        // Sanitize: convert single quotes to double quotes to handle WebGPU model quirks
        const sanitizedJson = match[0].replace(/'/g, '"');

        try {
            return JSON.parse(sanitizedJson);
        } catch (err) {
            console.error("Failed to parse tool JSON:", err);
            return null;
        }
    }
    return null;
}

// ── Tool Execution ─────────────────────────────────────────────────────────
export async function handleToolCall(toolName, args) {
    switch (toolName) {
        case 'web_search':
            return await executeSearch(args.query);
        default:
            return {
                success: false,
                error: `Unknown tool: ${toolName}`
            };
    }
}

export function setupToolsBridge(neuralLink) {

    // ── File drop / upload handler ─────────────────────────────────────────
    const log = neuralLink.DOM.log;

    log.addEventListener('dragover', (e) => {
        e.preventDefault();
        log.style.outline = '2px dashed #00ff41';
    });

    log.addEventListener('dragleave', () => {
        log.style.outline = '';
    });

    log.addEventListener('drop', async (e) => {
        e.preventDefault();
        log.style.outline = '';
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        // Process all dropped files, not just the first
        for (const file of files) {
            await handleFileUpload(file, neuralLink);
        }
    });

    // File input button (optional — add <input type="file" id="file-input" hidden> to HTML)
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files);
            if (!files.length) return;
            for (const file of files) {
                await handleFileUpload(file, neuralLink);
            }
            fileInput.value = '';
        });
    }

    // Timer display logic moved to direct call via showTimer() export
}

// ── File upload ────────────────────────────────────────────────────────────
async function handleFileUpload(file, neuralLink) {
    const maxSize = 1024 * 1024; // 1MB limit
    if (file.size > maxSize) {
        // Log directly to the chat area instead of circular import
        console.warn(`File too large (max 1MB): ${file.name}`);
        const chatLog = neuralLink.DOM.log;
        if (chatLog) {
            const warn = document.createElement('div');
            warn.className = 'message-wrap assistant-msg';
            const inner = document.createElement('div');
            inner.className = 'message-content';
            inner.style.color = '#ef4444';
            inner.textContent = `⚠️ File too large (max 1 MB): ${file.name}`;
            warn.appendChild(inner);
            chatLog.appendChild(warn);
        }
        return;
    }

    const text = await file.text();
    const prompt = `I've uploaded a file called "${file.name}". Here's its content:\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n[...truncated]' : ''}`;

    console.log(`📎 File uploaded: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);

    // Inject as a user message
    neuralLink.DOM.cmd.value = prompt;
    neuralLink.submit();
}

// ── Clipboard reader (called from main thread on demand) ───────────────────
export async function readClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        return text;
    } catch (e) {
        throw new Error('Clipboard access denied. Please allow clipboard permissions.');
    }
}

// ── Geolocation (called from main thread on demand) ────────────────────────
export function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported by this browser'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            }),
            (err) => reject(new Error(`Location error: ${err.message}`))
        );
    });
}

// ── Timer UI ───────────────────────────────────────────────────────────────
export function showTimer(seconds, label, neuralLink) {
    const logEl = neuralLink.DOM.log;
    const div = document.createElement('div');
    div.className = 'msg msg-sys timer-widget';

    let remaining = Number.isFinite(Number(seconds)) ? Math.max(1, Math.floor(Number(seconds))) : 1;
    const timerLabel = String(label ?? 'Timer');

    function fmt(s) {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    }

    const icon = document.createElement('span');
    icon.style.fontSize = '1.2em';
    icon.textContent = '⏱️';
    const title = document.createElement('strong');
    title.textContent = timerLabel;
    const display = document.createElement('span');
    display.className = 'timer-display';
    display.style.fontFamily = 'monospace';
    display.style.fontSize = '1.4em';
    display.style.margin = '0 12px';
    display.textContent = fmt(remaining);
    const stopBtn = document.createElement('button');
    stopBtn.className = 'timer-stop-btn';
    stopBtn.style.fontSize = '0.8em';
    stopBtn.style.padding = '2px 8px';
    stopBtn.textContent = 'Stop';
    div.append(icon, title, display, stopBtn);

    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;

    const interval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(interval);
            display.textContent = '00:00';
            div.replaceChildren();
            const done = document.createElement('span');
            done.style.color = '#00ff41';
            done.textContent = '✅ Done!';
            div.append('⏱️ ', document.createElement('strong'), ' — ', done);
            div.querySelector('strong').textContent = timerLabel;
            import('./audio-wakelock.js').then(m => m.playDoneSound());
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification('JAMES Timer', { body: `${timerLabel} finished!` });
            }
        } else {
            display.textContent = fmt(remaining);
        }
    }, 1000);

    stopBtn.onclick = () => {
        clearInterval(interval);
        div.replaceChildren();
        const stopped = document.createElement('strong');
        stopped.textContent = timerLabel;
        div.append('⏱️ ', stopped, ` — stopped at ${fmt(remaining)}`);
    };

    // Request notification permission for timer completion
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}