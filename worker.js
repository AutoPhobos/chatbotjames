import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

// --- CONFIGURATION ---
env.allowLocalModels = false;
env.useBrowserCache = true;
const DOWNLOAD_CACHE = 'james-model-cache';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
const MAX_DOWNLOAD_CONCURRENCY = 3;

const nativeFetch = self.fetch.bind(self);
self.fetch = customFetch;
env.fetch = customFetch;

function shouldUseDownloadCache(url) {
    if (url.endsWith('.wasm')) return false;
    return (
        url.includes('huggingface.co') ||
        url.includes('cdn.jsdelivr.net') ||
        url.endsWith('.bin') ||
        url.endsWith('.safetensors') ||
        url.endsWith('.json')
    );
}

function getCacheRequest(url) {
    return new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' });
}

async function cacheMatch(url) {
    const cache = await caches.open(DOWNLOAD_CACHE);
    return cache.match(getCacheRequest(url));
}

async function cachePut(url, response) {
    const cache = await caches.open(DOWNLOAD_CACHE);
    await cache.put(getCacheRequest(url), response.clone());
    return response;
}

function reportProgress(loaded, total, url) {
    self.postMessage({ status: 'downloading', loaded, total, file: url });
}

async function fetchHead(url) {
    const response = await nativeFetch(
        new Request(url, { method: 'HEAD', mode: 'cors', credentials: 'omit' })
    );
    if (!response.ok) throw new Error(`HEAD failed for ${url}: ${response.status}`);
    return response;
}

async function downloadChunk(url, range) {
    const response = await nativeFetch(
        new Request(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            headers: { Range: `bytes=${range.start}-${range.end}` },
            cache: 'no-store',
        })
    );
    if (!(response.ok || response.status === 206)) {
        throw new Error(`Chunk download failed: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
}

async function downloadAndCache(url) {
    const cached = await cacheMatch(url);
    if (cached) return cached;

    let head;
    try {
        head = await fetchHead(url);
    } catch {
        const response = await nativeFetch(
            new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
        );
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return cachePut(url, response);
    }

    const total = Number(head.headers.get('content-length')) || 0;
    const contentType = head.headers.get('content-type') || 'application/octet-stream';
    const acceptRanges = (head.headers.get('accept-ranges') || '').toLowerCase();

    if (!total || !acceptRanges.includes('bytes')) {
        const response = await nativeFetch(
            new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
        );
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        const buf = await response.arrayBuffer();
        const ct = response.headers.get('content-type') || 'application/octet-stream';
        const sized = new Response(buf, {
            headers: { 'Content-Type': ct, 'Content-Length': String(buf.byteLength) },
        });
        return cachePut(url, sized);
    }

    const ranges = [];
    for (let start = 0; start < total; start += CHUNK_SIZE) {
        ranges.push({ start, end: Math.min(start + CHUNK_SIZE - 1, total - 1) });
    }

    const results = new Array(ranges.length);
    let loaded = 0;
    let nextIndex = 0;

    await new Promise((resolve, reject) => {
        let active = 0;
        let failed = false;

        function spawnNext() {
            if (failed) return;
            if (nextIndex >= ranges.length) {
                if (active === 0) resolve();
                return;
            }
            const index = nextIndex++;
            active++;
            downloadChunk(url, ranges[index])
                .then(chunk => {
                    results[index] = chunk;
                    loaded += chunk.byteLength;
                    reportProgress(loaded, total, url);
                    active--;
                    spawnNext();
                    if (nextIndex >= ranges.length && active === 0) resolve();
                })
                .catch(err => {
                    if (!failed) { failed = true; reject(err); }
                });
        }

        for (let i = 0; i < MAX_DOWNLOAD_CONCURRENCY; i++) spawnNext();
    });

    const blob = new Blob(results, { type: contentType });
    const finalResponse = new Response(blob, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(blob.size) },
    });
    return cachePut(url, finalResponse);
}

async function customFetch(resource, init = {}) {
    const request = new Request(resource, init);
    if (request.method !== 'GET' || request.headers.has('Range')) {
        return nativeFetch(request);
    }
    if (!shouldUseDownloadCache(request.url)) {
        return nativeFetch(request);
    }
    const cached = await cacheMatch(request.url);
    if (cached) return cached;
    try {
        return await downloadAndCache(request.url);
    } catch (err) {
        console.warn('Custom fetch failed, falling back to native fetch:', err);
        return nativeFetch(request);
    }
}

let chatbot;

const systemPrompt = `You are James, a helpful AI assistant with access to real-time tools.

## TOOL CALLING

When a user needs real-time, current, or external data you MUST call a tool — never guess or fabricate data.
Output the tool call in this exact format and then stop:

\`\`\`tool:run
{"tool":"TOOL_NAME","params":{...}}
\`\`\`

### Examples

User: What is the weather in Tokyo?
Assistant:
\`\`\`tool:run
{"tool":"weather","params":{"location":"Tokyo"}}
\`\`\`

User: Convert 400 ILS to USD.
Assistant:
\`\`\`tool:run
{"tool":"currency","params":{"from":"ILS","to":"USD","amount":400}}
\`\`\`

User: What time is it in London?
Assistant:
\`\`\`tool:run
{"tool":"time","params":{"timezone":"Europe/London"}}
\`\`\`

## AVAILABLE TOOLS

| Tool      | Example params                                        |
|-----------|-------------------------------------------------------|
| weather   | {"location":"New York"}                               |
| wikipedia | {"query":"Albert Einstein"}                           |
| currency  | {"from":"USD","to":"EUR","amount":100}                |
| time      | {"timezone":"America/New_York"}                       |
| uuid      | {"count":3}                                           |
| password  | {"length":16,"count":1,"symbols":true}                |
| palette   | {"base":"#ff0000","scheme":"complementary","count":5} |
| date      | {"action":"now"}                                      |
| timer     | {"seconds":300,"label":"Break time"}                  |
| clipboard | {}                                                    |
| location  | {}                                                    |

## RULES

1. NEVER guess or fabricate real-time data — always use the appropriate tool.
2. When calling a tool, output ONLY the \`\`\`tool:run\`\`\` block — no text before or after it.
3. After receiving tool results, give a clear, direct answer based on the data provided.
4. For general knowledge that does not need live data, answer directly without a tool.`;

function normalizeError(err) {
    if (err == null) return { message: 'Unknown error', stack: null };
    if (typeof err === 'string') return { message: err, stack: null };
    if (typeof err === 'number') return { message: `Error code: ${err}`, stack: null };
    const message = err.message ?? err.toString?.() ?? JSON.stringify(err);
    return { message, stack: err.stack ?? null };
}

function reportWorkerError(err, targetId) {
    const normalized = normalizeError(err);
    self.postMessage({
        status: 'error',
        message: normalized.message,
        stack: normalized.stack,
        targetId,
        errorType: typeof err,
    });
}

async function initializeModel(provider, dtype, model) {
    return pipeline('text-generation', model, {
        device: provider,
        dtype,
        progress_callback: (p) => {
            if (p && typeof p.loaded === 'number' && typeof p.total === 'number') {
                self.postMessage({ status: 'downloading', loaded: p.loaded, total: p.total });
            }
        },
    });
}

function isMobileDevice() {
    const ua = navigator.userAgent;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const isNarrowScreen = self.screen && self.screen.width < 1024;
    const hasTouchPoints = navigator.maxTouchPoints > 1;
    return isMobileUA || (hasTouchPoints && isNarrowScreen);
}

function isTVDevice() {
    const ua = navigator.userAgent;
    return /SmartTV|SMART-TV|Tizen|WebOS|Web0S|HbbTV|BRAVIA|NetCast|Roku|AFT[A-Z]|CrKey|AppleTV|Android TV|googletv/i.test(ua);
}

// All available model presets (shared with the UI via postMessage on init)
// autoSelect:true  → tried automatically on startup (proven, reliable)
// autoSelect:false → available in the model panel only (user opt-in)
const MODEL_PRESETS = [
    // ── GPU · WebGPU (best quality, fastest inference) ─────────────────────
    // Default auto-select GPU models (small, proven, loads quickly)
    { id: 'gpu-smollm-17b-q4',   label: 'SmolLM2 1.7B',         backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',    dtype: 'q4',   requires: 'gpu', autoSelect: true,  sizeMB: 950,  ram: '4 GB' },
    { id: 'gpu-smollm-17b-q8',   label: 'SmolLM2 1.7B',         backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',    dtype: 'q8',   requires: 'gpu', autoSelect: true,  sizeMB: 1800, ram: '6 GB' },
    // Larger GPU models (manual selection — require more VRAM / unified memory)
    { id: 'gpu-llama32-1b-q4',   label: 'Llama 3.2 1B',         backend: 'webgpu', model: 'onnx-community/Llama-3.2-1B-Instruct',   dtype: 'q4',   requires: 'gpu', autoSelect: false, sizeMB: 650,  ram: '3 GB' },
    { id: 'gpu-llama32-3b-q4',   label: 'Llama 3.2 3B',         backend: 'webgpu', model: 'onnx-community/Llama-3.2-3B-Instruct',   dtype: 'q4',   requires: 'gpu', autoSelect: false, sizeMB: 1900, ram: '6 GB' },
    { id: 'gpu-qwen25-15b-q4',   label: 'Qwen2.5 1.5B',         backend: 'webgpu', model: 'onnx-community/Qwen2.5-1.5B-Instruct',   dtype: 'q4',   requires: 'gpu', autoSelect: false, sizeMB: 900,  ram: '4 GB' },
    { id: 'gpu-phi35-mini-q4',   label: 'Phi-3.5-mini 3.8B',    backend: 'webgpu', model: 'onnx-community/Phi-3.5-mini-instruct',   dtype: 'q4',   requires: 'gpu', autoSelect: false, sizeMB: 2200, ram: '8 GB' },
    { id: 'gpu-gemma3-1b-q4',    label: 'Gemma 3 1B',           backend: 'webgpu', model: 'onnx-community/gemma-3-1b-it',           dtype: 'q4',   requires: 'gpu', autoSelect: false, sizeMB: 600,  ram: '3 GB' },
    { id: 'gpu-deepseek-15b-q4', label: 'DeepSeek-R1 1.5B',     backend: 'webgpu', model: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B', dtype: 'q4', requires: 'gpu', autoSelect: false, sizeMB: 1000, ram: '4 GB' },
    // ── CPU · WASM (runs on any device, no GPU required) ─────────────────
    { id: 'cpu-tinyllama-q4',    label: 'TinyLlama 1.1B',       backend: 'wasm',   model: 'Xenova/TinyLlama-1.1B-Chat-v1.0',       dtype: 'q4',   requires: 'cpu', autoSelect: true,  sizeMB: 600,  ram: '2 GB' },
    { id: 'cpu-tinyllama-q8',    label: 'TinyLlama 1.1B',       backend: 'wasm',   model: 'Xenova/TinyLlama-1.1B-Chat-v1.0',       dtype: 'q8',   requires: 'cpu', autoSelect: true,  sizeMB: 1100, ram: '3 GB' },
    { id: 'cpu-llama32-1b-q4',   label: 'Llama 3.2 1B',         backend: 'wasm',   model: 'onnx-community/Llama-3.2-1B-Instruct',  dtype: 'q4',   requires: 'cpu', autoSelect: false, sizeMB: 650,  ram: '2 GB' },
    { id: 'cpu-qwen25-05b-q4',   label: 'Qwen2.5 0.5B',         backend: 'wasm',   model: 'onnx-community/Qwen2.5-0.5B-Instruct',  dtype: 'q4',   requires: 'cpu', autoSelect: false, sizeMB: 400,  ram: '1 GB' },
    { id: 'cpu-smollm-17b-q4',   label: 'SmolLM2 1.7B',         backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',   dtype: 'q4',   requires: 'cpu', autoSelect: false, sizeMB: 950,  ram: '3 GB' },
    // ── Lite · constrained devices (mobile / TV / very low RAM) ───────────
    { id: 'lite-smollm-135m-q8', label: 'SmolLM2 135M',         backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',   dtype: 'q8',   requires: 'cpu', autoSelect: true,  sizeMB: 150,  ram: '512 MB' },
    { id: 'lite-smollm-135m-q4', label: 'SmolLM2 135M',         backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',   dtype: 'q4',   requires: 'cpu', autoSelect: true,  sizeMB: 90,   ram: '256 MB' },
];

async function detectGpu() {
    if (!navigator.gpu) return { hasGpu: false, vendor: '', reason: 'WebGPU API not available in this browser' };

    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) {
        return { hasGpu: false, vendor: '', reason: 'requestAdapter() threw: ' + e.message };
    }
    if (!adapter) return { hasGpu: false, vendor: '', reason: 'No WebGPU adapter found (no GPU or driver missing)' };

    // Gather vendor info via whichever API the browser exposes
    let vendor = '', architecture = '', device = '';
    try {
        if (adapter.info) {
            vendor       = adapter.info.vendor       || '';
            architecture = adapter.info.architecture || '';
            device       = adapter.info.device       || '';
        } else if (typeof adapter.requestAdapterInfo === 'function') {
            const info   = await adapter.requestAdapterInfo();
            vendor       = info.vendor       || '';
            architecture = info.architecture || '';
            device       = info.device       || '';
        }
    } catch (e) {
        console.warn('GPU vendor info hidden by browser privacy settings:', e.message);
    }

    const vendorLower   = vendor.toLowerCase();
    const isFallback    = adapter.isFallbackAdapter;
    const maxStorageMB  = (adapter.limits.maxStorageBufferBindingSize || 0) / (1024 * 1024);

    // Dedicated GPU vendor strings
    const isDedicated = vendorLower.includes('nvidia')
                     || vendorLower.includes('amd')
                     || vendorLower.includes('apple')
                     || vendorLower.includes('qualcomm')
                     || vendorLower.includes('arm');

    // Privacy-masked vendors: treat as capable if buffer limit is large
    const hasHugeBuffer = maxStorageMB >= 512;

    // Compute shaders available = real GPU (not software rasteriser)
    const hasCompute = adapter.features && (
        adapter.features.has('shader-f16') ||
        adapter.features.has('timestamp-query') ||
        adapter.features.size > 0
    );

    let hasGpu = false;
    let reason = '';

    if (isFallback) {
        reason = 'Fallback (software) adapter — not suitable for inference';
    } else if (isDedicated) {
        hasGpu = true;
        reason = `Dedicated GPU detected (vendor: ${vendor || 'hidden'})`;
    } else if (vendor === '' && hasHugeBuffer) {
        // Vendor hidden by browser privacy, but huge buffer → likely discrete GPU
        hasGpu = true;
        reason = `Vendor hidden, but large buffer (${maxStorageMB.toFixed(0)} MB) → treating as capable GPU`;
    } else if (vendor === '' && hasCompute) {
        // Vendor hidden but has compute features → optimistic allow
        hasGpu = true;
        reason = `Vendor hidden with compute features → treating as capable GPU`;
    } else {
        reason = `Integrated/unknown GPU (vendor: ${vendor || 'hidden'}, buffer: ${maxStorageMB.toFixed(0)} MB) — using CPU fallback`;
    }

    console.log(hasGpu ? `🚀 ${reason}` : `⚠️ ${reason}`);
    return { hasGpu, vendor, architecture, device, isFallback, maxStorageMB, reason };
}

async function tryInitializeModels(gpuInfo, isMobile, isTV, forcePresetId = null) {
    const { hasGpu } = gpuInfo;
    const isConstrained = isMobile || isTV;
    const deviceLabel = isTV ? '📺 TV' : isMobile ? '📱 Mobile' : '🖥️ Desktop';
    console.log(`🛠️ Model init — GPU: ${hasGpu} | Device: ${deviceLabel} | Force: ${forcePresetId || 'auto'}`);

    // Send all presets + GPU capability to the UI so the panel can render
    self.postMessage({
        status: 'model-info',
        presets: MODEL_PRESETS,
        gpuInfo,
        isMobile,
        isTV,
    });

    let lastError = null;

    // ── Forced preset (from model selection panel) ─────────────────────────────
    if (forcePresetId) {
        const preset = MODEL_PRESETS.find(p => p.id === forcePresetId);
        if (!preset) throw new Error(`Unknown preset id: ${forcePresetId}`);
        console.log(`⏳ Loading forced preset: ${preset.label}`);
        chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
        console.log(`✅ Loaded forced preset: ${preset.label}`);
        self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
        return;
    }

    // ── Constrained devices: always lightweight WASM ───────────────────────────
    if (isConstrained) {
        console.log(`${deviceLabel} detected. Using lightweight model...`);
        const constrained = MODEL_PRESETS.filter(p => p.id.startsWith('lite-'));
        for (const { model, dtype, backend } of constrained) {
            try {
                console.log(`⏳ Attempting constrained model: ${model} (${dtype})`);
                chatbot = await initializeModel(backend, dtype, model);
                console.log(`✅ Loaded: ${model}`);
                self.postMessage({ status: 'done', backend, dtype, model, isMobile, isTV });
                return;
            } catch (err) {
                console.warn(`❌ Failed: ${model} (${dtype}):`, err);
                lastError = err;
            }
        }
        console.warn('⚠️ Constrained models failed. Falling back to standard CPU models...');
    }

    // ── GPU path: only autoSelect:true entries on startup ────────────────────
    if (hasGpu && !isConstrained) {
        const gpuPresets = MODEL_PRESETS.filter(p => p.requires === 'gpu' && p.autoSelect !== false);
        for (const { model, dtype, backend } of gpuPresets) {
            try {
                console.log(`⏳ Attempting GPU model: ${model} (${dtype})`);
                chatbot = await initializeModel(backend, dtype, model);
                console.log(`✅ Loaded GPU model: ${model}`);
                self.postMessage({ status: 'done', backend, dtype, model });
                return;
            } catch (err) {
                console.warn(`❌ Failed GPU model ${model} (${dtype}):`, err);
                lastError = err;
            }
        }
        console.warn('⚠️ GPU models failed, falling back to CPU...');
    }

    // ── CPU/WASM fallback: only autoSelect:true entries on startup ────────────
    const cpuPresets = MODEL_PRESETS.filter(
        p => p.requires === 'cpu' && p.autoSelect !== false && !p.id.startsWith('lite-')
    );
    for (const { model, dtype, backend } of cpuPresets) {
        try {
            console.log(`⏳ Attempting CPU model: ${model} (${dtype})`);
            chatbot = await initializeModel(backend, dtype, model);
            console.log(`✅ Loaded CPU model: ${model}`);
            self.postMessage({ status: 'done', backend, dtype, model });
            return;
        } catch (err) {
            console.warn(`❌ Failed CPU model ${model} (${dtype}):`, err);
            lastError = err;
        }
    }

    console.error('💥 All models failed to initialize.');
    throw lastError;
}

self.onmessage = async (e) => {
    const { type, messages, targetId } = e.data;

    if (type === 'init') {
        try {
            await new Promise((resolve) => setTimeout(resolve, 125));
            const gpuInfo = await detectGpu();
            const mobile = isMobileDevice();
            const tv = isTVDevice();
            await tryInitializeModels(gpuInfo, mobile, tv, e.data.forcePresetId || null);
        } catch (err) {
            reportWorkerError(err, undefined);
        }
        return;
    }

    if (type === 'query') {
        try {
            self.postMessage({ status: 'thinking', targetId });

            const activeMessages = messages.filter(m => !m.content.includes('Tools available'));

            // Clean, standard context. TinyLlama understands this perfectly.
            const chatContext = [
                { role: 'system', content: systemPrompt },
                ...activeMessages
            ];

            const prompt = chatbot.tokenizer.apply_chat_template(chatContext, {
                tokenize: false,
                add_generation_prompt: true
            });

            // Get exact token count for flawless slicing
            const promptTokens = await chatbot.tokenizer(prompt);
            const promptTokenCount = promptTokens.input_ids.data.length;

            let accumulatedResponse = '';

            const output = await chatbot(prompt, {
                max_new_tokens: 512,
                do_sample: true,
                temperature: 0.15,
                top_k: 40,
                top_p: 0.9,
                return_full_text: false,
                callback_function: (beams) => {
                    const allTokens = Array.from(beams[0].output_token_ids.data || beams[0].output_token_ids);

                    if (allTokens.length > promptTokenCount) {
                        const newTokens = allTokens.slice(promptTokenCount);
                        const text = chatbot.tokenizer.decode(newTokens, { skip_special_tokens: true });

                        if (text.length > accumulatedResponse.length) {
                            accumulatedResponse = text;
                            self.postMessage({ status: 'streaming', message: accumulatedResponse, targetId });
                        }
                    }
                }
            });

            // With return_full_text: false the model already gives us only the new text.
            // Use the streamed accumulation as the authoritative final response if the
            // pipeline output is empty or clearly wrong.
            let finalResponse = Array.isArray(output)
                ? (output[0]?.generated_text ?? output[0]?.text ?? '').trim()
                : (output?.generated_text ?? output?.text ?? '').trim();

            // Prefer the streamed accumulation — it's always just the new tokens.
            if (!finalResponse && accumulatedResponse) {
                finalResponse = accumulatedResponse.trim();
            }

            self.postMessage({ status: 'complete', message: finalResponse.trim(), targetId });
        } catch (err) {
            reportWorkerError(err, targetId);
        }
    }
};