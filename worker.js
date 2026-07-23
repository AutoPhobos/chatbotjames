import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

// --- CONFIGURATION ---
env.allowLocalModels = false;
env.useBrowserCache = false;
const DOWNLOAD_CACHE = 'JAMES-model-cache-v4';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
const MAX_DOWNLOAD_CONCURRENCY = 6;
const MAX_CHUNK_RETRIES = 3;

const nativeFetch = self.fetch.bind(self);
self.fetch = customFetch;
env.fetch = customFetch;

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
        return null;
    }
}

async function cachePut(url, response) {
    try {
        const cache = await caches.open(DOWNLOAD_CACHE);
        await cache.put(getCacheRequest(url), response.clone());
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            try {
                await caches.delete(DOWNLOAD_CACHE);
                const cache = await caches.open(DOWNLOAD_CACHE);
                await cache.put(getCacheRequest(url), response.clone());
            } catch (innerErr) {}
        }
    }
    return response;
}

function reportProgress(loaded, total, url) {
    self.postMessage({ status: 'downloading', loaded, total, file: url });
}

async function fetchHead(url) {
    const response = await nativeFetch(new Request(url, { method: 'HEAD', mode: 'cors', credentials: 'omit' }));
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
                throw new Error(`Chunk HTTP error: ${response.status}`);
            }
            return await response.arrayBuffer();
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 500));
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
        const response = await nativeFetch(new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' }));
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        return cachePut(url, response);
    }

    const total = Number(head.headers.get('content-length')) || 0;
    const contentType = head.headers.get('content-type') || 'application/octet-stream';
    const acceptRanges = (head.headers.get('accept-ranges') || '').toLowerCase();

    if (!total || !acceptRanges.includes('bytes')) {
        const response = await nativeFetch(new Request(url, { method: 'GET', mode: 'cors', credentials: 'omit' }));
        const buf = await response.arrayBuffer();
        const sized = new Response(buf, { headers: { 'Content-Type': contentType, 'Content-Length': String(buf.byteLength) } });
        return cachePut(url, sized);
    }

    const ranges = [];
    for (let start = 0; start < total; start += CHUNK_SIZE) {
        ranges.push({ start, end: Math.min(start + CHUNK_SIZE - 1, total - 1) });
    }

    const results = new Array(ranges.length);
    let loaded = 0, nextIndex = 0;

    await new Promise((resolve, reject) => {
        let active = 0, failed = false;
        function spawnNext() {
            if (failed) return;
            if (nextIndex >= ranges.length) {
                if (active === 0) resolve();
                return;
            }
            const index = nextIndex++;
            active++;
            downloadChunkWithRetry(url, ranges[index]).then(chunk => {
                results[index] = chunk;
                loaded += chunk.byteLength;
                reportProgress(loaded, total, url);
                active--;
                spawnNext();
                if (nextIndex >= ranges.length && active === 0) resolve();
            }).catch(err => {
                if (!failed) { failed = true; reject(err); }
            });
        }
        for (let i = 0; i < Math.min(MAX_DOWNLOAD_CONCURRENCY, ranges.length); i++) spawnNext();
    });

    const blob = new Blob(results, { type: contentType });
    const finalResponse = new Response(blob, { headers: { 'Content-Type': contentType, 'Content-Length': String(blob.size) } });
    return cachePut(url, finalResponse);
}

async function customFetch(resource, init = {}) {
    const request = new Request(resource, init);
    if (request.method !== 'GET' || request.headers.has('Range') || !shouldUseDownloadCache(request.url)) {
        return nativeFetch(request);
    }
    const cached = await cacheMatch(request.url);
    if (cached) {
        const size = Number(cached.headers.get('content-length')) || 0;
        if (size > 1024 * 1024) reportProgress(size, size, request.url);
        return cached;
    }
    try {
        return await downloadAndCache(request.url);
    } catch (err) {
        return nativeFetch(request);
    }
}

let chatbot;

const systemPrompt = `You are JAMES (just a machine engineered for speech), an advanced AI assistant and a friend.

You have access to the following tools:
- weather (params: location)
- wikipedia (params: query)
- currency (params: from, to, amount)
- time (params: timezone)
- calculator (params: expr)
- convert (params: value, from, to)

CRITICAL RULES:
1. ONLY call a tool if you absolutely need real-time or external data (weather, calculations, currency, time, facts).
2. If the user is just chatting or being friendly, reply directly in plain text.
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

async function initializeModel(provider, dtype, model) {
    if (chatbot && typeof chatbot.dispose === 'function') {
        try { await chatbot.dispose(); } catch (e) {}
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
        if (provider === 'webgpu') {
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

const MODEL_PRESETS = [
    { id: 'lite-smollm-135m-q4',   label: 'SmolLM2 135M q4 (Safe Mobile)', backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q4',    requires: 'cpu', sizeMB: 90 },
    { id: 'lite-smollm-135m-q8',   label: 'SmolLM2 135M q8 (Lite)',         backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q8',    requires: 'cpu', sizeMB: 150 },
    { id: 'gpu-qwen3-06b-q4f16',   label: 'Qwen3 0.6B (WebGPU)',          backend: 'webgpu', model: 'onnx-community/Qwen3-0.6B-ONNX',            dtype: 'q4f16', requires: 'gpu', sizeMB: 350 },
    { id: 'gpu-qwen25-05b-q4f16',   label: 'Qwen2.5 0.5B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4f16', requires: 'gpu', sizeMB: 400 },
    { id: 'gpu-smollm2-1.7b-q4f16', label: 'SmolLM2 1.7B (WebGPU)',        backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',           dtype: 'q4f16', requires: 'gpu', sizeMB: 950 },
    { id: 'gpu-gemma3-1b-q4f16',    label: 'Gemma 3 1B (WebGPU)',          backend: 'webgpu', model: 'onnx-community/gemma-3-1b-it',                  dtype: 'q4f16', requires: 'gpu', sizeMB: 600 },
    { id: 'gpu-llama32-1b-q4f16',   label: 'Llama 3.2 1B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Llama-3.2-1B-Instruct',          dtype: 'q4f16', requires: 'gpu', sizeMB: 750 },
    { id: 'gpu-qwen25-15b-q4f16',   label: 'Qwen2.5 1.5B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Qwen2.5-1.5B-Instruct',          dtype: 'q4f16', requires: 'gpu', sizeMB: 950 },
    { id: 'gpu-deepseek-15b-q4f16', label: 'DeepSeek-R1 1.5B (WebGPU)',    backend: 'webgpu', model: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B', dtype: 'q4f16', requires: 'gpu', sizeMB: 1000 },
    { id: 'gpu-llama32-3b-q4f16',   label: 'Llama 3.2 3B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Llama-3.2-3B-Instruct',          dtype: 'q4f16', requires: 'gpu', sizeMB: 2100 },
    { id: 'gpu-phi35-mini-q4f16',   label: 'Phi-3.5-mini 3.8B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Phi-3.5-mini-instruct',          dtype: 'q4f16', requires: 'gpu', sizeMB: 2200 },
    { id: 'cpu-llama32-1b-q4',     label: 'Llama 3.2 1B (WASM)',            backend: 'wasm',   model: 'onnx-community/Llama-3.2-1B-Instruct',          dtype: 'q4',    requires: 'cpu', sizeMB: 650 },
    { id: 'cpu-tinyllama-q4',      label: 'TinyLlama 1.1B (WASM)',          backend: 'wasm',   model: 'Xenova/TinyLlama-1.1B-Chat-v1.0',               dtype: 'q4',    requires: 'cpu', sizeMB: 600 },
    { id: 'cpu-qwen25-05b-q4',     label: 'Qwen2.5 0.5B (WASM)',            backend: 'wasm',   model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4',    requires: 'cpu', sizeMB: 400 }
];

function isMobileDevice() {
    const ua = navigator.userAgent;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const isNarrowScreen = self.screen && self.screen.width < 1024;
    const hasTouchPoints = navigator.maxTouchPoints > 1;
    return isMobileUA || (hasTouchPoints && isNarrowScreen);
}

async function detectGpu() {
    if (isMobileDevice()) return { hasGpu: false, reason: 'Mobile device forced to WASM lite mode for stability' };
    if (!navigator.gpu) return { hasGpu: false };
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter || adapter.isFallbackAdapter) return { hasGpu: false };
        return { hasGpu: true, vendor: adapter.info?.vendor || 'WebGPU' };
    } catch (e) {
        return { hasGpu: false };
    }
}

self.onmessage = async (e) => {
    const { type, messages, targetId, chatId, forcePresetId } = e.data;

    if (type === 'cancel') {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        return;
    }

    if (type === 'init') {
        try {
            const gpuInfo = await detectGpu();
            const ram = navigator.deviceMemory || 4;
            const mobile = isMobileDevice();

            // Immediately notify UI of hardware capabilities & preset list
            self.postMessage({ status: 'hardware-info', gpuInfo, ram, mobile, presets: MODEL_PRESETS });

            let targetPreset = MODEL_PRESETS[0]; // Default to safe mobile lite model
            
            if (forcePresetId) {
                const found = MODEL_PRESETS.find(p => p.id === forcePresetId);
                if (found) targetPreset = found;
            } else if (!mobile && gpuInfo.hasGpu) {
                targetPreset = MODEL_PRESETS.find(p => p.id === 'gpu-qwen3-06b-q4f16') || MODEL_PRESETS[2];
            } else if (!mobile) {
                targetPreset = MODEL_PRESETS.find(p => p.backend === 'wasm' && !p.id.startsWith('lite-')) || MODEL_PRESETS[0];
            }

            chatbot = await initializeModel(targetPreset.backend, targetPreset.dtype, targetPreset.model);
            self.postMessage({ status: 'done', backend: targetPreset.backend, dtype: targetPreset.dtype, model: targetPreset.model });
        } catch (err) {
            self.postMessage({ status: 'error', message: err.message });
        }
        return;
    }

    if (type === 'query') {
        if (!chatbot) {
            self.postMessage({ status: 'error', message: 'Model is not initialized yet.', targetId });
            return;
        }

        activeAbortController = new AbortController();
        try {
            self.postMessage({ status: 'thinking', targetId, chatId });

            const chatContext = [
                { role: 'system', content: systemPrompt },
                ...messages
            ];

            const prompt = chatbot.tokenizer.apply_chat_template(chatContext, {
                tokenize: false,
                add_generation_prompt: true
            });

            const promptTokens = await chatbot.tokenizer(prompt);
            const promptTokenCount = promptTokens.input_ids.data.length;

            let accumulatedResponse = '';
            const startTime = performance.now();
            let generatedTokensCount = 0;

            const output = await chatbot(prompt, {
                max_new_tokens: 512,
                do_sample: true,
                temperature: 0.7,
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
                        generatedTokensCount = newTokens.length;
                        const text = chatbot.tokenizer.decode(newTokens, { skip_special_tokens: true });
                        if (text.length > accumulatedResponse.length) {
                            accumulatedResponse = text;
                            const elapsedSec = (performance.now() - startTime) / 1000;
                            const tps = elapsedSec > 0 ? (generatedTokensCount / elapsedSec).toFixed(1) : 0;
                            self.postMessage({ status: 'streaming', message: accumulatedResponse, targetId, chatId, tps, tokens: generatedTokensCount });
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

            const elapsedSec = (performance.now() - startTime) / 1000;
            const finalTps = elapsedSec > 0 ? (generatedTokensCount / elapsedSec).toFixed(1) : 0;

            self.postMessage({ status: 'complete', message: finalResponse.trim(), targetId, chatId, tps: finalTps, tokens: generatedTokensCount });
        } catch (err) {
            if (err.message === 'Generation cancelled by user.') {
                self.postMessage({ status: 'complete', message: '[Generation stopped]', targetId, chatId });
            } else {
                self.postMessage({ status: 'error', message: err.message, targetId });
            }
        } finally {
            activeAbortController = null;
        }
    }
};
