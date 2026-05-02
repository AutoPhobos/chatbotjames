// tools-bridge.js
// Handles browser APIs that workers can't access directly.
// Import this in your main thread and call setupToolsBridge(neuralLink)

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
        const file = e.dataTransfer.files[0];
        if (!file) return;
        await handleFileUpload(file, neuralLink);
    });

    // File input button (optional — add <input type="file" id="file-input" hidden> to HTML)
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            await handleFileUpload(file, neuralLink);
            fileInput.value = '';
        });
    }

    // ── Timer display ──────────────────────────────────────────────────────
    // worker.js sends { status: 'timer', seconds, label } for timer tool calls
    neuralLink.worker.addEventListener('message', (e) => {
        if (e.data?.status === 'timer') {
            showTimer(e.data.seconds, e.data.label, neuralLink);
        }
    });
}

// ── File upload ────────────────────────────────────────────────────────────
async function handleFileUpload(file, neuralLink) {
    const maxSize = 1024 * 1024; // 1MB limit
    if (file.size > maxSize) {
        import('./app.js').then(m => m.log(`⚠️ File too large (max 1MB): ${file.name}`, 'sys'));
        return;
    }

    const text = await file.text();
    const prompt = `I've uploaded a file called "${file.name}". Here's its content:\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n[...truncated]' : ''}`;

    import('./app.js').then(m => m.log(`📎 File uploaded: ${file.name} (${(file.size/1024).toFixed(1)}KB)`, 'sys'));

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
function showTimer(seconds, label, neuralLink) {
    const logEl = neuralLink.DOM.log;
    const div = document.createElement('div');
    div.className = 'msg msg-sys timer-widget';

    let remaining = parseInt(seconds);

    function fmt(s) {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    }

    div.innerHTML = `
        <span style="font-size:1.2em;">⏱️</span>
        <strong>${label ?? 'Timer'}</strong>
        <span class="timer-display" style="font-family:monospace; font-size:1.4em; margin: 0 12px;">${fmt(remaining)}</span>
        <button class="timer-stop-btn" style="font-size:0.8em; padding:2px 8px;">Stop</button>
    `;

    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;

    const display = div.querySelector('.timer-display');
    const stopBtn = div.querySelector('.timer-stop-btn');

    const interval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(interval);
            display.textContent = '00:00';
            div.innerHTML = `⏱️ <strong>${label ?? 'Timer'}</strong> — <span style="color:#00ff41">✅ Done!</span>`;
            if (Notification.permission === 'granted') {
                new Notification('JAMES Timer', { body: `${label ?? 'Timer'} finished!` });
            }
        } else {
            display.textContent = fmt(remaining);
        }
    }, 1000);

    stopBtn.onclick = () => {
        clearInterval(interval);
        div.innerHTML = `⏱️ <strong>${label ?? 'Timer'}</strong> — stopped at ${fmt(remaining)}`;
    };

    // Request notification permission for timer completion
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
