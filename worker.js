import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';
import { CONFIG } from './config.js';

// --- CONFIGURATION ---
env.allowLocalModels = false;
env.useBrowserCache = false;
const DOWNLOAD_CACHE = 'JAMES-model-cache-v2';
const CHUNK_SIZE = CONFIG.worker.chunkSizeMb * 1024 * 1024;
const MAX_DOWNLOAD_CONCURRENCY = CONFIG.worker.maxDownloadConcurrency;

const nativeFetch = self.fetch.bind(self);
self.fetch = customFetch;
env.fetch = customFetch;

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
    const cache = await caches.open(DOWNLOAD_CACHE);
    return cache.match(getCacheRequest(url), { ignoreSearch: true, ignoreVary: true, ignoreMethod: true });
}

async function cachePut(url, response) {
    try {
        const cache = await caches.open(DOWNLOAD_CACHE);
        await cache.put(getCacheRequest(url), response.clone());
    } catch (e) {
        console.warn(`Cache put failed for ${url}:`, e);
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

async function fetchWithProgress(url, total = 0) {
    const response = await nativeFetch(
        new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' })
    );
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    
    total = total || Number(response.headers.get('content-length')) || 0;
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    if (!response.body) {
        const buf = await response.arrayBuffer();
        reportProgress(buf.byteLength, total || buf.byteLength, url);
        return cachePut(url, new Response(buf, { headers: { 'Content-Type': contentType, 'Content-Length': String(buf.byteLength) } }));
    }

    const reader = response.body.getReader();
    let loaded = 0;
    const chunks = [];
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        reportProgress(loaded, total || loaded, url); // Ensure it reports *something*
    }
    
    const blob = new Blob(chunks, { type: contentType });
    return cachePut(url, new Response(blob, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(blob.size) },
    }));
}

async function downloadAndCache(url) {
    const cached = await cacheMatch(url);
    if (cached) return cached;

    let head;
    try {
        head = await fetchHead(url);
    } catch {
        return fetchWithProgress(url);
    }

    const total = Number(head.headers.get('content-length')) || 0;
    const contentType = head.headers.get('content-type') || 'application/octet-stream';
    const acceptRanges = (head.headers.get('accept-ranges') || '').toLowerCase();

    if (!total || !acceptRanges.includes('bytes')) {
        return fetchWithProgress(url, total);
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
    let request;
    if (resource instanceof Request) {
        request = resource.clone();
    } else {
        request = new Request(resource, init);
    }
    if (request.method !== 'GET' || request.headers.has('Range')) {
        return nativeFetch(request);
    }
    if (!shouldUseDownloadCache(request.url)) {
        return nativeFetch(request);
    }
    const cached = await cacheMatch(request.url);
    if (cached) {
        console.log(`[Cache Hit] ${request.url}`);
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
        return nativeFetch(resource instanceof Request ? resource.clone() : new Request(resource, init));
    }
}

let chatbot;
let activePreset = null;

const systemPrompt = `You are JAMES, a helpful, friendly AI assistant running locally in the browser. Keep responses concise and under 512 tokens.

AVAILABLE TOOLS (use only when essential):
- web_search (params: query) → live web search across Google, DuckDuckGo, and Bing
- weather (params: location) → current weather conditions
- wikipedia (params: query) → search encyclopedia entries
- currency (params: from, to, amount) → live currency conversion rates
- time (params: timezone) → current time in a specified timezone
- calculator (params: expr) → evaluate math expressions
- convert (params: value, from, to) → standard unit conversion
- start_game (params: game) → Starts a game of "chess" or "checkers" with the user in the UI
- make_move (params: move) → Make a move in the active game. (Chess: SAN like "e5", Checkers: "r,c to r,c")

BEHAVIOR RULES:
1. DEFAULT: Always reply conversationally without tools. Only use tools for real-time, external, or non-static knowledge.
2. RECOGNIZE: General chitchat ("hi", "how are you", "what can you do") needs no tools—answer directly.
3. ACTIVATE: Use a tool only if:
   (a) the user explicitly asks for live data,
   (b) you need up-to-date web facts, news, or specific site search, or
   (c) it requires a specialized calculation (currency, time zones, weather, unit conversion).
4. FORMAT: When calling a tool, output ONLY this exact block structure:

\`\`\`tool:run
[tool_name]
[param1]: [value1]
[param2]: [value2]
\`\`\`

5. AFTER TOOL: Interpret the returned results naturally in your final response. Do NOT repeat the tool call. If search results are empty, unavailable, or contain fallback/mock artifacts, state clearly that the information could not be retrieved rather than outputting placeholder text or unrelated topics.

TONE:
Conversational, helpful, and concise. Use plain language.

EXAMPLES:

User: "Hi, who are you?"
→ No tool needed.
Reply:
"I'm JAMES, your local AI assistant. I can chat, perform web searches, look up information, convert units, check the weather, and solve math problems. What can I help with today?"

User: "What are the latest updates on the James Webb Space Telescope?"
→ Use web_search tool.

\`\`\`tool:run
web_search
query: latest updates James Webb Space Telescope
\`\`\`

Then:
"According to recent updates, [result]."

User: "What's the weather in Tokyo?"
→ Use weather tool.

\`\`\`tool:run
weather
location: Tokyo
\`\`\`

Then:
"It's [result]. Have a great day!"

User: "Convert 100 USD to EUR"
→ Use currency tool.

\`\`\`tool:run
currency
from: USD
to: EUR
amount: 100
\`\`\`

Then:
"100 USD is approximately [result] EUR at current rates."

User: "Let's play a game of chess"
→ Use start_game tool.

\`\`\`tool:run
start_game
game: chess
\`\`\`

Then:
"I have started a game of chess. Your move!"

User: "[Game State] Current FEN: ... You are playing Black. What is your next move?"
→ Use make_move tool.

\`\`\`tool:run
make_move
move: e5
\`\`\`

Then:
"I play e5. Your turn!"

User: "What's 25 * 4?"
→ No tool needed.
Reply:
"25 × 4 = 100"

User: "What's the capital of France?"
→ No tool needed.
Reply:
"Paris is the capital of France."

User: "Tell me about machine learning"
→ No tool needed.
Reply with a concise, friendly explanation based on your knowledge.

User: "What time is it in New York?"
→ Use time tool.

\`\`\`tool:run
time
timezone: America/New_York
\`\`\`

Then:
"It's currently [result] in New York."
`;

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
    // WebGPU: always pass dtype as a plain string.
    // Correct dtype for WebGPU is 'q4f16' (4-bit weights, fp16 compute) or 'q4'.
    // 'fp16' alone means full fp16 precision — too large and often unsupported.
    // WASM/CPU: a per-module mapping pins sub-components to avoid OOM.
    const resolvedDtype = provider === 'webgpu'
        ? dtype
        : { model: dtype, decoder_model_merged: dtype, default: 'fp32' };

    return pipeline('text-generation', model, {
        device: provider,
        dtype: resolvedDtype,
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

const MODEL_PRESETS = [
    // ── GPU · WebGPU (Capable Computers, 3B+ Params) ───────────────────────
    { id: 'gpu-llama31-8b-q4f16', label: 'Llama 3.1 8B', backend: 'webgpu', model: 'onnx-community/Meta-Llama-3.1-8B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 4800, ram: '16 GB', params: 8.0 },
    { id: 'gpu-qwen25-7b-q4f16', label: 'Qwen2.5 7B', backend: 'webgpu', model: 'onnx-community/Qwen2.5-7B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 4200, ram: '12 GB', params: 7.0 },
    { id: 'gpu-phi35-mini-q4f16', label: 'Phi-3.5-mini 3.8B', backend: 'webgpu', model: 'onnx-community/Phi-3.5-mini-instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 2200, ram: '8 GB', params: 3.8 },
    { id: 'gpu-llama32-3b-q4f16', label: 'Llama 3.2 3B', backend: 'webgpu', model: 'onnx-community/Llama-3.2-3B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 2100, ram: '6 GB', params: 3.2 },
    { id: 'gpu-qwen25-3b-q4f16', label: 'Qwen2.5 3B', backend: 'webgpu', model: 'onnx-community/Qwen2.5-3B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 1800, ram: '6 GB', params: 3.0 },
    
    // ── GPU · WebGPU (Mid-Range Laptops, 1B - 2B Params) ───────────────────
    { id: 'gpu-gemma2-2b-q4f16', label: 'Gemma 2 2B', backend: 'webgpu', model: 'onnx-community/gemma-2-2b-it', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 1400, ram: '4 GB', params: 2.0 },
    { id: 'gpu-smollm-17b-q4f16', label: 'SmolLM2 1.7B', backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 950, ram: '3 GB', params: 1.7 },
    { id: 'gpu-deepseek-15b-q4f16', label: 'DeepSeek-R1 1.5B', backend: 'webgpu', model: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 1000, ram: '4 GB', params: 1.5 },
    { id: 'gpu-llama32-1b-q4f16', label: 'Llama 3.2 1B', backend: 'webgpu', model: 'onnx-community/Llama-3.2-1B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 750, ram: '3 GB', params: 1.2 },

    // ── GPU · WebGPU (Low-Power / Mobile, < 1B Params) ─────────────────────
    { id: 'gpu-qwen25-05b-q4f16', label: 'Qwen2.5 0.5B', backend: 'webgpu', model: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4f16', requires: 'gpu', autoSelect: true, sizeMB: 400, ram: '2 GB', params: 0.5 },
    
    // ── CPU · WASM (General Fallbacks) ─────────────────────────────────────
    { id: 'cpu-llama32-1b-q4', label: 'Llama 3.2 1B', backend: 'wasm', model: 'onnx-community/Llama-3.2-1B-Instruct', dtype: 'q4', requires: 'cpu', autoSelect: true, sizeMB: 650, ram: '2 GB', params: 1.2 },
    { id: 'cpu-tinyllama-q4', label: 'TinyLlama 1.1B', backend: 'wasm', model: 'Xenova/TinyLlama-1.1B-Chat-v1.0', dtype: 'q4', requires: 'cpu', autoSelect: true, sizeMB: 600, ram: '2 GB', params: 1.1 },
    { id: 'cpu-tinyllama-q8', label: 'TinyLlama 1.1B q8', backend: 'wasm', model: 'Xenova/TinyLlama-1.1B-Chat-v1.0', dtype: 'q8', requires: 'cpu', autoSelect: true, sizeMB: 1100, ram: '3 GB', params: 1.1 },
    { id: 'cpu-qwen25-05b-q4', label: 'Qwen2.5 0.5B', backend: 'wasm', model: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4', requires: 'cpu', autoSelect: true, sizeMB: 400, ram: '1 GB', params: 0.5 },
    { id: 'cpu-smollm-17b-q4', label: 'SmolLM2 1.7B', backend: 'wasm', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4', requires: 'cpu', autoSelect: false, sizeMB: 950, ram: '3 GB', params: 1.7 },
    
    // ── Lite (Absolute Fallbacks for constrained devices) ──────────────────
    { id: 'lite-smollm-135m-q8', label: 'SmolLM2 135M q8', backend: 'wasm', model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q8', requires: 'cpu', autoSelect: true, sizeMB: 150, ram: '512 MB', params: 0.135 },
    { id: 'lite-smollm-135m-q4', label: 'SmolLM2 135M q4', backend: 'wasm', model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q4', requires: 'cpu', autoSelect: true, sizeMB: 90, ram: '256 MB', params: 0.135 },
];

// ── WASM Capability Detection ─────────────────────────────────────────────────

async function detectWasmCapabilities() {
    const caps = { memory64: false, simd: false, threads: false, bulkMemory: false, multiValue: false, exceptions: false, gc: false };

    async function probe(bytes) {
        try { await WebAssembly.compile(new Uint8Array(bytes)); return true; }
        catch { return false; }
    }

    caps.memory64 = await probe([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x04, 0x01, 0x04, 0x00, 0x01]);
    caps.simd = await probe([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b]);
    caps.threads = await probe([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x04, 0x01, 0x03, 0x01, 0x01]);
    caps.bulkMemory = await probe([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x0a, 0x0e, 0x01, 0x0c, 0x00, 0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0b, 0x00, 0x0b]);
    caps.multiValue = await probe([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x00, 0x02, 0x7f, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0x41, 0x00, 0x0b]);
    if (typeof WebAssembly.Tag === 'function') caps.exceptions = true;
    try { await WebAssembly.compile(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x5f, 0x00, 0x00])); caps.gc = true; } catch { }

    console.log('🔬 WASM Capabilities:', caps);
    return caps;
}

// ── GPU Detection ─────────────────────────────────────────────────────────────
// Strategy: be OPTIMISTIC. If WebGPU adapter exists and isn't a software
// fallback, treat it as capable. Let the pipeline fail naturally with a real
// error rather than blocking the user with a false negative.

function detectBrowserEngine() {
    const ua = navigator.userAgent;
    let browser = 'Unknown', engine = 'Unknown', version = '';
    if (ua.includes('Firefox/')) { browser = 'Firefox'; engine = 'Gecko'; version = ua.match(/Firefox\/(\d+)/)?.[1] || ''; }
    else if (ua.includes('Edg/')) { browser = 'Edge'; engine = 'Blink'; version = ua.match(/Edg\/(\d+)/)?.[1] || ''; }
    else if (ua.includes('Chrome/')) { browser = 'Chrome'; engine = 'Blink'; version = ua.match(/Chrome\/(\d+)/)?.[1] || ''; }
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) { browser = 'Safari'; engine = 'WebKit'; version = ua.match(/Version\/(\d+)/)?.[1] || ''; }
    return { browser, engine, version };
}

async function detectGpu() {
    const browserInfo = detectBrowserEngine();
    const noGpu = (reason) => ({
        hasGpu: false, vendor: '', architecture: '', device: '', description: '',
        isFallback: false, maxStorageMB: 0, maxBufferMB: 0,
        features: [], browserInfo, reason
    });

    if (!navigator.gpu) return noGpu('WebGPU API not available in this browser');

    let adapter = null;
    try { 
        adapter = await Promise.race([
            navigator.gpu.requestAdapter(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
    }
    catch (e) { return noGpu('requestAdapter() threw: ' + e.message); }
    if (!adapter) return noGpu('No WebGPU adapter found (no GPU or driver missing)');

    // ── Gather vendor info ────────────────────────────────────────────────
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
    } catch (e) { console.warn('GPU info hidden by browser privacy settings:', e.message); }

    // ── Normalize ANGLE vendor (Chrome/Edge on Windows wraps real GPU via ANGLE/D3D) ──
    let normalizedVendor = vendor;
    const vendorLower = vendor.toLowerCase();
    if (vendorLower === 'google' || vendorLower.includes('angle') || vendorLower === '') {
        const combined = (description + ' ' + device + ' ' + architecture).toLowerCase();
        if (combined.includes('nvidia')) normalizedVendor = 'nvidia';
        else if (combined.includes('amd') || combined.includes('radeon')) normalizedVendor = 'amd';
        else if (combined.includes('intel')) normalizedVendor = 'intel';
        else if (combined.includes('qualcomm') || combined.includes('adreno')) normalizedVendor = 'qualcomm';
        else if (combined.includes('apple')) normalizedVendor = 'apple';
        if (normalizedVendor !== vendor)
            console.log(`🔄 Vendor normalized: "${vendor}" → "${normalizedVendor}"`);
    }

    const isFallback = !!adapter.isFallbackAdapter;
    const maxStorageMB = (adapter.limits?.maxStorageBufferBindingSize || 0) / (1024 * 1024);
    const maxBufferMB = (adapter.limits?.maxBufferSize || 0) / (1024 * 1024);
    const featureList = adapter.features ? [...adapter.features] : [];

    // ── OPTIMISTIC GPU detection ──────────────────────────────────────────
    // If the adapter is NOT a software fallback, we treat it as a capable GPU.
    // This covers Nvidia via ANGLE, privacy-masked Firefox, and any future vendor.
    // The pipeline itself will throw a real, actionable error if WebGPU truly
    // can't run the model — far better than a false "no GPU" block.
    if (isFallback) {
        const reason = 'Software fallback adapter — not suitable for GPU inference';
        console.warn('⚠️', reason);
        return { hasGpu: false, vendor: normalizedVendor, architecture, device, description, isFallback, maxStorageMB, maxBufferMB, features: featureList, browserInfo, reason };
    }

    // Non-fallback adapter = real GPU (Nvidia, AMD, Intel, Apple Silicon, Qualcomm…)
    const reason = `GPU detected — vendor: ${normalizedVendor || 'hidden'}, buffer: ${maxStorageMB.toFixed(0)} MB`;
    console.log('🚀', reason);
    console.log(`🖥️ Browser: ${browserInfo.browser} ${browserInfo.version} (${browserInfo.engine})`);
    console.log(`🎮 GPU Features (${featureList.length}):`, featureList.join(', '));

    return {
        hasGpu: true, vendor: normalizedVendor, architecture, device, description,
        isFallback, maxStorageMB, maxBufferMB,
        features: featureList, browserInfo, reason
    };
}

// ── Smart auto-selection ──────────────────────────────────────────────────────

function getDeviceRamGB() { return navigator.deviceMemory || 4; }

function rankAutoPresets(gpuInfo, ramGB, isConstrained, wasmCaps = null) {
    const { hasGpu } = gpuInfo;

    // We removed the hardcoded `isConstrained` filter that previously forced smartphones
    // to only use `lite-` models. Now, high-end smartphones can dynamically select
    // larger models (like 0.5B or 1B) depending on their actual RAM capacity!

    // A conservative estimate for VRAM capacity based on system RAM.
    // We NO LONGER clamp this to `maxStorageMB` because WebGPU splits large models
    // into multiple buffers! `maxStorageMB` is just a single-buffer limit.
    const gpuBudgetMB = hasGpu ? (ramGB * 1024 * 0.70) : 0;
    const cpuBudgetFactor = (wasmCaps && wasmCaps.memory64) ? 0.60 : 0.40;
    const cpuBudgetMB = ramGB * 1024 * cpuBudgetFactor;

    const candidates = MODEL_PRESETS.filter(p => {
        if (p.id.startsWith('lite-')) return false;
        if (p.requires === 'gpu' && !hasGpu) return false;
        if (p.autoSelect === false) return false;
        const budget = p.requires === 'gpu' ? gpuBudgetMB : cpuBudgetMB;
        return !(p.sizeMB && p.sizeMB > budget);
    });

    candidates.sort((a, b) => {
        // Prioritize GPU models over CPU
        const gpuA = a.requires === 'gpu' ? 1 : 0;
        const gpuB = b.requires === 'gpu' ? 1 : 0;
        if (gpuA !== gpuB) return gpuB - gpuA;

        // Sort by parameter count (best models first)
        return (b.params || 0) - (a.params || 0);
    });

    return candidates;
}

async function tryInitializeModels(gpuInfo, isMobile, isTV, forcePresetId = null, lastPresetId = null, wasmCaps = null) {
    const { hasGpu } = gpuInfo;
    const isConstrained = isMobile || isTV;
    const ramGB = getDeviceRamGB();
    const deviceLabel = isTV ? '📺 TV' : isMobile ? '📱 Mobile' : '🖥️ Desktop';
    console.log(`🛠️ Model init — GPU: ${hasGpu} | RAM: ${ramGB} GB | Device: ${deviceLabel} | Force: ${forcePresetId || lastPresetId || 'auto'}`);

    self.postMessage({ status: 'model-info', presets: MODEL_PRESETS, gpuInfo, ramGB, isMobile, isTV, wasmCaps });

    let lastError = null;

    // ── 0. Forced preset — load directly, no capability filtering ────────────
    // This is the key fix: when the user explicitly picks a model (including any
    // GPU model), we skip all heuristics and just try to load it. WebGPU will
    // throw a real, descriptive error if the hardware truly can't run it.
    if (forcePresetId) {
        const preset = MODEL_PRESETS.find(p => p.id === forcePresetId);
        if (!preset) throw new Error(`Unknown preset id: ${forcePresetId}`);
        console.log(`🚀 Loading user-selected preset: ${preset.label} (${preset.backend}/${preset.dtype})`);
        self.postMessage({ status: 'warm-start', preset: preset });
        try {
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            activePreset = preset;
            console.log(`✅ Loaded: ${preset.label}`);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            console.error(`❌ Failed to load forced preset ${preset.label}:`, err);
            throw err; // Surface the real WebGPU/ONNX error to the UI
        }
    }

    // ── 1. Warm start: try last-successful preset ────────────────────────────
    if (lastPresetId) {
        const last = MODEL_PRESETS.find(p => p.id === lastPresetId);
        if (last) {
            console.log(`🔄 Warm start: ${last.label}`);
            // Notify the UI so it can show "Resuming: [Model Name]..."
            self.postMessage({ status: 'warm-start', preset: last });
            try {
                chatbot = await initializeModel(last.backend, last.dtype, last.model);
                activePreset = last;
                console.log(`✅ Warm start succeeded: ${last.label}`);
                self.postMessage({ status: 'done', backend: last.backend, dtype: last.dtype, model: last.model, isMobile, isTV });
                return;
            } catch (err) {
                console.warn(`❌ Warm start failed, clearing cache:`, err);
                self.postMessage({ status: 'clear-last-preset' });
            }
        }
    }

    // ── 2. Smart auto-selection ───────────────────────────────────────────────
    const ranked = rankAutoPresets(gpuInfo, ramGB, isConstrained, wasmCaps);
    console.log(`🎯 Auto candidates:`, ranked.map(p => `${p.id}(${p.sizeMB}MB)`).join(', '));

    for (const preset of ranked) {
        try {
            console.log(`🚀 Trying: ${preset.label}`);
            self.postMessage({ status: 'warm-start', preset: preset });
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            activePreset = preset;
            console.log(`✅ Loaded: ${preset.label}`);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            console.warn(`❌ Failed: ${preset.label}:`, err);
            lastError = err;
        }
    }

    // ── 3. Last resort: lite models ───────────────────────────────────────────
    const litePresets = MODEL_PRESETS
        .filter(p => p.id.startsWith('lite-'))
        .sort((a, b) => (a.sizeMB || 0) - (b.sizeMB || 0));
    for (const preset of litePresets) {
        try {
            console.log(`⚠️ Last-resort lite: ${preset.label}`);
            self.postMessage({ status: 'warm-start', preset: preset });
            chatbot = await initializeModel(preset.backend, preset.dtype, preset.model);
            activePreset = preset;
            console.log(`✅ Loaded lite: ${preset.label}`);
            self.postMessage({ status: 'done', backend: preset.backend, dtype: preset.dtype, model: preset.model, isMobile, isTV });
            return;
        } catch (err) {
            console.warn(`❌ Failed lite: ${preset.label}:`, err);
            lastError = err;
        }
    }

    console.error('💥 All models failed.');
    throw lastError;
}

let isGenerating = false;
let isAborted = false;

self.onmessage = async (e) => {
    const { type, messages, targetId, chatId } = e.data;

    if (type === 'abort') {
        isAborted = true;
        return;
    }

    if (type === 'init') {
        // If we receive a new init while generating, force-reset the flag.
        // The old generation loop will error out naturally (chatbot is now a new instance)
        // and the finally block will set isGenerating = false again, which is harmless.
        isAborted = true;
        isGenerating = false;
        try {
            await new Promise((resolve) => setTimeout(resolve, 125));
            const [gpuInfo, wasmCaps] = await Promise.all([detectGpu(), detectWasmCapabilities()]);
            const mobile = isMobileDevice();
            const tv = isTVDevice();
            await tryInitializeModels(
                gpuInfo, mobile, tv,
                e.data.forcePresetId || null,
                e.data.lastPresetId || null,
                wasmCaps
            );
        } catch (err) {
            reportWorkerError(err, undefined);
        }
        return;
    }

    if (type === 'query') {
        if (isGenerating) {
            console.warn('Worker received query while already generating. Ignoring to prevent WebGPU corruption.');
            reportWorkerError(new Error("JAMES is busy processing another request."), targetId);
            return;
        }
        isGenerating = true;
        isAborted = false;

        let accumulatedResponse = '';

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

            let maxTokens = CONFIG.worker.maxTokens;
            let temp = CONFIG.worker.temperature;

            if (activePreset) {
                if (activePreset.params < 1.0) {
                    maxTokens = 512;
                    temp = 0.8;
                } else if (activePreset.params >= 3.0) {
                    maxTokens = 2048;
                    temp = 0.7;
                }
            }

            const output = await chatbot(prompt, {
                max_new_tokens: maxTokens,
                do_sample: true,
                temperature: temp,
                top_k: CONFIG.worker.topK,
                top_p: CONFIG.worker.topP,
                return_full_text: false,
                callback_function: (beams) => {
                    if (isAborted) return true; // Attempt to cleanly stop generation
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

            if (isAborted) {
                self.postMessage({ status: 'aborted', message: accumulatedResponse.trim(), targetId, chatId });
                return;
            }

            let finalResponse = Array.isArray(output)
                ? (output[0]?.generated_text ?? output[0]?.text ?? '').trim()
                : (output?.generated_text ?? output?.text ?? '').trim();

            if (!finalResponse && accumulatedResponse) {
                finalResponse = accumulatedResponse.trim();
            }

            self.postMessage({ status: 'complete', message: finalResponse.trim(), targetId, chatId });
        } catch (err) {
            reportWorkerError(err, targetId);
        } finally {
            isGenerating = false;
        }
    }
};


