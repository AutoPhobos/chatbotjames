import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

// --- CONFIGURATION ---
env.allowLocalModels = false;
env.useBrowserCache = false;
const DOWNLOAD_CACHE = 'JAMES-model-cache-v2';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
const MAX_DOWNLOAD_CONCURRENCY = 6;
const MAX_CHUNK_RETRIES = 3;

const nativeFetch = self.fetch.bind(self);
self.fetch = customFetch;
env.fetch = customFetch;

// Active generation control for cancellation
let activeAbortController = null;

function shouldUseDownloadCache(url) {
    if (url.endsWith('.wasm')) return false;
    return (
        url.includes('huggingface.co') ||
        url.includes('hf.co') ||
        url.includes('cdn.jsdelivr.net') ||
        url.endsWith('.bin') ||
        url.endsWith('.onnx') ||
        url.endsWith('.onnx_data') ||
        url.endsWith('.safetensors') ||
        url.endsWith('.json')
    );
}

function getCacheRequest(url) {
    return new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' });
}

async function cacheMatch(url) {
    try {
        const cache = await caches.open(DOWNLOAD_CACHE);
        return await cache.match(getCacheRequest(url), { ignoreSearch: true, ignoreVary: true, ignoreMethod: true });
    } catch (e) {
        console.warn(`Cache match failed for ${url}:`, e);
        return null;
    }
}

async function cachePut(url, response) {
    try {
        const cache = await caches.open(DOWNLOAD_CACHE);
        await cache.put(getCacheRequest(url), response.clone());
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded. Clearing old caches...');
            try {
                await caches.delete(DOWNLOAD_CACHE);
                const cache = await caches.open(DOWNLOAD_CACHE);
                await cache.put(getCacheRequest(url), response.clone());
            } catch (innerErr) {
                console.warn('Cache recovery failed after quota exceeded:', innerErr);
            }
        } else {
            console.warn(`Cache put failed for ${url}:`, e);
        }
    }
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

async function downloadChunkWithRetry(url, range, retries = MAX_CHUNK_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
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
                throw new Error(`Chunk HTTP error: ${response.status} ${response.statusText}`);
            }
            return await response.arrayBuffer();
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
            console.warn(`Chunk download attempt ${attempt} failed for ${url} [bytes ${range.start}-${range.end}]. Retrying in ${delay.toFixed(0)}ms...`, err);
            await new Promise(res => setTimeout(res, delay));
        }
    }
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
            downloadChunkWithRetry(url, ranges[index])
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

        for (let i = 0; i < Math.min(MAX_DOWNLOAD_CONCURRENCY, ranges.length); i++) spawnNext();
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
    if (cached) {
        const size = Number(cached.headers.get('content-length')) || 0;
        if (size > 1024 * 1024) {
            reportProgress(size, size, request.url);
        }
        return cached;
    }
    try {
        return await downloadAndCache(request.url);
    } catch (err) {
        console.warn('Custom fetch failed, falling back to native fetch:', err);
        return nativeFetch(request);
    }
}

let chatbot;

const systemPrompt = `You are JAMES (just a machine engineered for speech), an AI assistant and a friend.

You have access to the following tools:
- weather (params: location)
- wikipedia (params: query)
- currency (params: from, to, amount)
- time (params: timezone)
- calculator (params: expr)
- convert (params: value, from, to)

CRITICAL RULES:
1. ONLY call a tool if you absolutely need real-time or external data.
2. If the user is just chatting (like "hi" or "who are you"), DO NOT use a tool. Just reply directly in plain text.
3. If you MUST use a tool, output exactly this code block and nothing else:
\`\`\`tool:run
[tool_name]
[param]: [value]
\`\`\`

Example:
\`\`\`tool:run
weather
location: London
\`\`\``;

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
    if (chatbot && typeof chatbot.dispose === 'function') {
        try { await chatbot.dispose(); } catch (e) { console.warn('Model disposal warning:', e); }
    }
    chatbot = null;

    const resolvedDtype = provider === 'webgpu'
        ? dtype
        : { model: dtype, decoder_model_merged: dtype, default: 'fp32' };

    try {
        return await pipeline('text-generation', model, {
            device: provider,
            dtype: resolvedDtype,
            progress_callback: (p) => {
                if (p && typeof p.loaded === 'number' && typeof p.total === 'number') {
                    self.postMessage({ status: 'downloading', loaded: p.loaded, total: p.total });
                }
            },
        });
    } catch (err) {
        // Edge Case: WebGPU device loss or OOM -> Fallback to WASM if provider was webgpu
        if (provider === 'webgpu') {
            console.warn('⚠️ WebGPU initialization failed. Attempting automatic fallback to WASM (CPU)...', err);
            return await pipeline('text-generation', model, {
                device: 'wasm',
                dtype: { model: 'q4', decoder_model_merged: 'q4', default: 'fp32' },
                progress_callback: (p) => {
                    if (p && typeof p.loaded === 'number' && typeof p.total === 'number') {
                        self.postMessage({ status: 'downloading', loaded: p.loaded, total: p.total });
                    }
                },
            });
        }
        throw err;
    }
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

const MODEL_PRESETS = [
    { id: 'gpu-qwen3-06b-q4f16',   label: 'Qwen3 0.6B (WebGPU)',     backend: 'webgpu', model: 'onnx-community/Qwen3-0.6B-ONNX',            dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 350,  ram: '2 GB' },
    { id: 'gpu-qwen25-05b-q4f16',   label: 'Qwen2.5 0.5B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 400,  ram: '2 GB' },
    { id: 'gpu-smollm-17b-q4f16',   label: 'SmolLM2 1.7B (WebGPU)',   backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',           dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 950,  ram: '3 GB' },
    { id: 'gpu-llama32-1b-q4f16',   label: 'Llama 3.2 1B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Llama-3.2-1B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 750,  ram: '3 GB' },
    { id: 'gpu-qwen25-15b-q4f16',   label: 'Qwen2.5 1.5B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Qwen2.5-1.5B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 950,  ram: '4 GB' },
    { id: 'gpu-llama32-3b-q4f16',   label: 'Llama 3.2 3B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Llama-3.2-3B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 2100, ram: '6 GB' },
    { id: 'gpu-gemma3-1b-q4f16',    label: 'Gemma 3 1B (WebGPU)',     backend: 'webgpu', model: 'onnx-community/gemma-3-1b-it',                  dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 600,  ram: '3 GB' },
    { id: 'gpu-deepseek-15b-q4f16', label: 'DeepSeek-R1 1.5B (WebGPU)',backend: 'webgpu', model: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 1000, ram: '4 GB' },
    { id: 'gpu-phi35-mini-q4f16',   label: 'Phi-3.5-mini 3.8B (WebGPU)',backend: 'webgpu', model: 'onnx-community/Phi-3.5-mini-instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 2200, ram: '8 GB' },
    { id: 'cpu-llama32-1b-q4',   label: 'Llama 3.2 1B (WASM)',        backend: 'wasm',   model: 'onnx-community/Llama-3.2-1B-Instruct',          dtype: 'q4', requires: 'cpu', autoSelect: true,  sizeMB: 650,  ram: '2 GB' },
    { id: 'cpu-tinyllama-q4',    label: 'TinyLlama 1.1B (WASM)',      backend: 'wasm',   model: 'Xenova/TinyLlama-1.1B-Chat-v1.0',               dtype: 'q4', requires: 'cpu', autoSelect: true,  sizeMB: 600,  ram: '2 GB' },
    { id: 'cpu-tinyllama-q8',    label: 'TinyLlama 1.1B q8 (WASM)',   backend: 'wasm',   model: 'Xenova/TinyLlama-1.1B-Chat-v1.0',               dtype: 'q8', requires: 'cpu', autoSelect: true,  sizeMB: 1100, ram: '3 GB' },
    { id: 'cpu-qwen25-05b-q4',   label: 'Qwen2.5 0.5B (WASM)',        backend: 'wasm',   model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4', requires: 'cpu', autoSelect: true,  sizeMB: 400,  ram: '1 GB' },
    { id: 'cpu-smollm-17b-q4',   label: 'SmolLM2 1.7B (WASM)',        backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',           dtype: 'q4', requires: 'cpu', autoSelect: false, sizeMB: 950,  ram: '3 GB' },
    { id: 'lite-smollm-135m-q8', label: 'SmolLM2 135M q8 (Lite)',     backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q8', requires: 'cpu', autoSelect: true,  sizeMB: 150,  ram: '512 MB' },
    { id: 'lite-smollm-135m-q4', label: 'SmolLM2 135M q4 (Lite)',     backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q4', requires: 'cpu', autoSelect: true,  sizeMB: 90,   ram: '256 MB' },
];

async function detectWasmCapabilities() {
    const caps = { memory64: false, simd: false, threads: false, bulkMemory: false, multiValue: false, exceptions: false, gc: false };
    async function probe(bytes) {
        try { await WebAssembly.compile(new Uint8Array(bytes)); return true; } catch { return false; }
    }
    caps.memory64 = await probe([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x05,0x04,0x01,0x04,0x00,0x01]);
    caps.simd = await probe([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x05,0x01,0x60,0x00,0x01,0x7b,0x03,0x02,0x01,0x00,0x0a,0x16,0x01,0x14,0x00,0xfd,0x0c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x0b]);
    caps.threads = await probe([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x05,0x04,0x01,0x03,0x01,0x01]);
    caps.bulkMemory = await probe([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x04,0x01,0x60,0x00,0x00,0x03,0x02,0x01,0x00,0x05,0x03,0x01,0x00,0x01,0x0a,0x0e,0x01,0x0c,0x00,0x41,0x00,0x41,0x00,0x41,0x00,0xfc,0x0b,0x00,0x0b]);
    caps.multiValue = await probe([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x06,0x01,0x60,0x00,0x02,0x7f,0x7f,0x03,0x02,0x01,0x00,0x0a,0x08,0x01,0x06,0x00,0x41,0x00,0x41,0x00,0x0b]);
    if (typeof WebAssembly.Tag === 'function') caps.exceptions = true;
    try { await WebAssembly.compile(new Uint8Array([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x04,0x01,0x5f,0x00,0x00])); caps.gc = true; } catch {}
    return caps;
}

function detectBrowserEngine() {
    const ua = navigator.userAgent;
    let browser = 'Unknown', engine = 'Unknown', version = '';
    if (ua.includes('Firefox/'))                          { browser = 'Firefox'; engine = 'Gecko';  version = ua.match(/Firefox\/(\d+)/)?.[1] || ''; }
    else if (ua.includes('Edg/'))                         { browser = 'Edge';    engine = 'Blink';  version = ua.match(/Edg\/(\d+)/)?.[1]     || ''; }
    else if (ua.includes('Chrome/'))                      { browser = 'Chrome';  engine = 'Blink';  version = ua.match(/Chrome\/(\d+)/)?.[1]  || ''; }
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) { browser = 'Safari'; engine = 'WebKit'; version = ua.match(/Version\/(\d+)/)?.[1] || ''; }
    return { browser, engine, version };
}

async function detectGpu() {
    const browserInfo = detectBrowserEngine();
    const noGpu = (reason) => ({
        hasGpu: false, vendor: '', architecture: '', device: '', description: '',
        isFallback: false, maxStorageMB: 0, maxBufferMB: 0, features: [], browserInfo, reason
    });

    if (!navigator.gpu) return noGpu('WebGPU API not available');
    let adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { return noGpu('requestAdapter() error: ' + e.message); }
    if (!adapter) return noGpu('No WebGPU adapter found');

    let vendor = '', architecture = '', device = '', description = '';
    try {
        if (adapter.info) {
            vendor = adapter.info.vendor || ''; architecture = adapter.info.architecture || '';
            device = adapter.info.device || ''; description = adapter.info.description || '';
        } else if (typeof adapter.requestAdapterInfo === 'function') {
            const info = await adapter.requestAdapterInfo();
            vendor = info.vendor || ''; architecture = info.architecture || '';
            device = info.device || ''; description = info.description || '';
        }
    } catch {}

    let normalizedVendor = vendor;
    const vendorLower = vendor.toLowerCase();
    if (vendorLower === 'google' || vendorLower.includes('angle') || vendorLower === '') {
        const combined = (description + ' ' + device + ' ' + architecture).toLowerCase();
        if      (combined.includes('nvidia'))                           normalizedVendor = 'nvidia';
        else if (combined.includes('amd') || combined.includes('radeon')) normalizedVendor = 'amd';
        else if (combined.includes('intel'))                            normalizedVendor = 'intel';
        else if (combined.includes('qualcomm') || combined.includes('adreno')) normalizedVendor = 'qualcomm';
        else if (combined.includes('apple'))                            normalizedVendor = 'apple';
    }

    const isFallback   = !!adapter.isFallbackAdapter;
    const maxStorageMB = (adapter.limits?.maxStorageBufferBindingSize || 0) / (1024 * 1024);
    const maxBufferMB  = (adapter.limits?.maxBufferSize || 0) / (1024 * 1024);
    const featureList  = adapter.features ? [...adapter.features] : [];

    if (isFallback) {
        return { hasGpu: false, vendor: normalizedVendor, architecture, device, description, isFallback, maxStorageMB, maxBufferMB, features: featureList, browserInfo, reason: 'Software fallback adapter' };
    }

    return { hasGpu: true, vendor: normalizedVendor, architecture, device, description, isFallback, maxStorageMB, maxBufferMB, features: featureList, browserInfo, reason: 'GPU detected' };
}

function getDeviceRamGB() { return navigator.deviceMemory || 4; }

function rankAutoPresets(gpuInfo, ramGB, isConstrained, wasmCaps = null) {
    const { hasGpu, maxStorageMB } = gpuInfo;
    if (isConstrained) {
        return MODEL_PRESETS.filter(p => p.id.startsWith('lite-')).sort((a, b) => (a.sizeMB || 0) - (b.sizeMB || 0));
    }
    const gpuBudgetMB = hasGpu ? Math.min(maxStorageMB || 4096, ramGB * 1024 * 0.60) : 0;
    const cpuBudgetFactor = (wasmCaps && wasmCaps.memory64) ? 0.50 : 0.40;
    const cpuBudgetMB = ramGB * 1024 * cpuBudgetFactor;

    const candidates = MODEL_PRESETS.filter(p => {
        if (p.id.startsWith('lite-')) return false;
        if (p.requires === 'gpu' && !hasGpu) return false;
        if (p.autoSelect === false) return false;
        const budget = p.requires === 'gpu' ? gpuBudgetMB : cpuBudgetMB;
        return !(p.sizeMB && p.sizeMB > budget);
    });

    candidates.sort((a, b) => {
        const gpuA = a.requires === 'gpu' ? 1 : 0;
        const gpuB = b.requires === 'gpu' ? 1 : 0;
        if (gpuA !== gpuB) return gpuB - gpuA;
        return (b.sizeMB || 0) - (a.sizeMB || 0);
    });
    return candidates;
}

async function tryInitializeModels(gpuInfo, isMobile, isTV, forcePresetId = null, lastPresetId = null, wasmCaps = null) {
    const { hasGpu } = gpuInfo;
    const isConstrained = isMobile || isTV;
    const ramGB = getDeviceRamGB();

    self.postMessage({ status: 'model-info', presets: MODEL_PRESETS, gpuInfo, ramGB, isMobile, isTV, wasmCaps });
    let lastError = null;

    if (forcePresetId) {
        const preset = MODEL_PRESETS.find(p => p.id === forcePresetId);
        if (!preset) throw new Error(`Unknown preset id: ${forcePresetId}`);
        try {
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            throw err;
        }
    }

    if (lastPresetId) {
        const last = MODEL_PRESETS.find(p => p.id === lastPresetId);
        if (last) {
            try {
                chatbot = await initializeModel(last.backend, last.dtype, last.model);
                self.postMessage({ status: 'done', backend: last.backend, dtype: last.dtype, model: last.model, isMobile, isTV });
                return;
            } catch (err) {
                self.postMessage({ status: 'clear-last-preset' });
            }
        }
    }

    const ranked = rankAutoPresets(gpuInfo, ramGB, isConstrained, wasmCaps);
    for (const preset of ranked) {
        try {
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            lastError = err;
        }
    }

    const litePresets = MODEL_PRESETS.filter(p => p.id.startsWith('lite-')).sort((a, b) => (a.sizeMB || 0) - (b.sizeMB || 0));
    for (const preset of litePresets) {
        try {
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError;
}

self.onmessage = async (e) => {
    const { type, messages, targetId, chatId } = e.data;

    if (type === 'cancel') {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        return;
    }

    if (type === 'init') {
        try {
            await new Promise((resolve) => setTimeout(resolve, 125));
            const [gpuInfo, wasmCaps] = await Promise.all([detectGpu(), detectWasmCapabilities()]);
            await tryInitializeModels(
                gpuInfo, isMobileDevice(), isTVDevice(),
                e.data.forcePresetId || null,
                e.data.lastPresetId  || null,
                wasmCaps
            );
        } catch (err) {
            reportWorkerError(err, undefined);
        }
        return;
    }

    if (type === 'query') {
        if (!chatbot) {
            reportWorkerError(new Error('Model is not initialized yet.'), targetId);
            return;
        }

        activeAbortController = new AbortController();

        try {
            self.postMessage({ status: 'thinking', targetId, chatId });

            const activeMessages = messages.filter(m => !m.content.includes('Tools available'));
            const chatContext = [
                { role: 'system', content: systemPrompt },
                ...activeMessages
            ];

            const prompt = chatbot.tokenizer.apply_chat_template(chatContext, {
                tokenize: false,
                add_generation_prompt: true
            });

            const promptTokens = await chatbot.tokenizer(prompt);
            const promptTokenCount = promptTokens.input_ids.data.length;

            let accumulatedResponse = '';

            const output = await chatbot(prompt, {
                max_new_tokens: 512,
                do_sample: true,
                temperature: 1.0,
                top_k: 40,
                top_p: 0.9,
                return_full_text: false,
                callback_function: (beams) => {
                    if (activeAbortController && activeAbortController.signal.aborted) {
                        throw new Error('Generation cancelled by user.');
                    }
                    const allTokens = Array.from(beams[0].output_token_ids.data || beams[0].output_token_ids);
                    if (allTokens.length > promptTokenCount) {
                        const newTokens = allTokens.slice(promptTokenCount);
                        const text = chatbot.tokenizer.decode(newTokens, { skip_special_tokens: true });
                        if (text.length > accumulatedResponse.length) {
                            accumulatedResponse = text;
                            self.postMessage({ status: 'streaming', message: accumulatedResponse, targetId, chatId });
                        }
                    }
                }
            });

            let finalResponse = Array.isArray(output)
                ? (output[0]?.generated_text ?? output[0]?.text ?? '').trim()
                : (output?.generated_text ?? output?.text ?? '').trim();

            if (!finalResponse && accumulatedResponse) {
                finalResponse = accumulatedResponse.trim();
            }

            self.postMessage({ status: 'complete', message: finalResponse.trim(), targetId, chatId });
        } catch (err) {
            if (err.message === 'Generation cancelled by user.') {
                self.postMessage({ status: 'complete', message: '[Generation stopped]', targetId, chatId });
            } else {
                reportWorkerError(err, targetId);
            }
        } finally {
            activeAbortController = null;
        }
    }
};
