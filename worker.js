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

    const pool = async () => {
        let i = 0;
        const workers = Array.from({ length: MAX_DOWNLOAD_CONCURRENCY }, async () => {
            while (true) {
                const index = i++;
                if (index >= ranges.length) break;
                const chunk = await downloadChunk(url, ranges[index]);
                results[index] = chunk;
                loaded += chunk.byteLength;
                reportProgress(loaded, total, url);
            }
        });
        await Promise.all(workers);
    };

    await pool();

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

async function tryInitializeModels(hasGpu, isMobile, isTV) {
    const isConstrained = isMobile || isTV;
    const deviceLabel = isTV ? '📺 TV' : isMobile ? '📱 Mobile' : '🖥️ Desktop';
    console.log(`🛠️ Model init — GPU: ${hasGpu} | Device: ${deviceLabel}`);

    // Tiny model for constrained devices (mobile/TV) — avoids OOM.
    // Note: tool calling may be unreliable at this size.
    const CONSTRAINED_MODELS = [
        { model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q8' },
        { model: 'HuggingFaceTB/SmolLM2-135M-Instruct', dtype: 'q4' },
    ];

    const GPU_MODELS = [
        { model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4' },
        { model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q8' },
    ];

    const CPU_MODELS = [
        // 1B+ Model: Smart enough for tools, but heavy on the CPU
        { model: 'Xenova/TinyLlama-1.1B-Chat-v1.0', dtype: 'q4' },
        { model: 'Xenova/TinyLlama-1.1B-Chat-v1.0', dtype: 'q8' },
    ];

    let lastError = null;

    // Constrained devices: skip GPU, use the smallest model to avoid OOM
    if (isConstrained) {
        console.log(`${deviceLabel} detected. Using lightweight model...`);
        for (const { model, dtype } of CONSTRAINED_MODELS) {
            try {
                console.log(`⏳ Attempting to load constrained model: ${model} (${dtype})`);
                chatbot = await initializeModel('wasm', dtype, model);
                console.log(`✅ Loaded: ${model}`);
                self.postMessage({ status: 'done', backend: 'wasm', dtype, model, isMobile, isTV });
                return;
            } catch (err) {
                console.warn(`❌ Failed: ${model} (${dtype}):`, err);
                lastError = err;
            }
        }
        console.warn('⚠️ Constrained models failed. Falling back to standard CPU models...');
    }

    if (hasGpu && !isConstrained) {
        for (const { model, dtype } of GPU_MODELS) {
            try {
                console.log(`⏳ Attempting to load GPU model: ${model} (${dtype})`);
                chatbot = await initializeModel('webgpu', dtype, model);
                console.log(`✅ Successfully loaded GPU model: ${model}`);
                self.postMessage({ status: 'done', backend: 'webgpu', dtype, model });
                return;
            } catch (err) {
                console.warn(`❌ Failed to load ${model} (${dtype}):`, err);
                lastError = err;
            }
        }
    }

    console.log("⚠️ GPU models failed or unavailable. Falling back to CPU/WASM...");

    for (const { model, dtype } of CPU_MODELS) {
        try {
            console.log(`⏳ Attempting to load CPU model: ${model} (${dtype})`);
            chatbot = await initializeModel('wasm', dtype, model);
            console.log(`✅ Successfully loaded CPU model: ${model}`);
            self.postMessage({ status: 'done', backend: 'wasm', dtype, model });
            return;
        } catch (err) {
            console.warn(`❌ Failed to load CPU model ${model} (${dtype}):`, err);
            lastError = err;
        }
    }

    console.error("💥 All models failed to initialize.");
    throw lastError;
}

self.onmessage = async (e) => {
    const { type, messages, targetId } = e.data;

if (type === 'init') {
        try {
            await new Promise((resolve) => setTimeout(resolve, 125));
            let hasGpu = false;
            
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    let vendor = "";
                    
                    // 1. Safely try to get the GPU vendor, handling new specs, old specs, and privacy blocks
                    try {
                        if (adapter.info) {
                            vendor = adapter.info.vendor?.toLowerCase() || "";
                        } else if (typeof adapter.requestAdapterInfo === 'function') {
                            const info = await adapter.requestAdapterInfo();
                            vendor = info.vendor?.toLowerCase() || "";
                        }
                    } catch (e) {
                        console.warn("GPU vendor info hidden by browser privacy settings.");
                    }
                    
                    const isDedicated = vendor.includes('nvidia') || vendor.includes('amd') || vendor.includes('apple');
                    const isFallback = adapter.isFallbackAdapter;
                    
                    // 2. Hardware limit test: Integrated chips usually have small buffer limits (<256MB)
                    const maxBuffer = adapter.limits.maxStorageBufferBindingSize || 0;
                    const hasHugeBuffer = maxBuffer >= (512 * 1024 * 1024);
                    
                    // 3. Final decision logic
                    if (!isFallback && (isDedicated || (vendor === "" && hasHugeBuffer))) {
                        console.log(`🚀 Capable GPU detected (Vendor: ${vendor || 'Hidden'}). Enabling WebGPU.`);
                        hasGpu = true;
                    } else {
                        console.log(`⚠️ Integrated/weak GPU detected (Vendor: ${vendor || 'Intel/Unknown'}). Forcing CPU fallback.`);
                    }
                }
            }
            
            const mobile = isMobileDevice();
            const tv = isTVDevice();
            await tryInitializeModels(hasGpu, mobile, tv);
        } catch (err) {
            reportWorkerError(err);
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

            let finalResponse = Array.isArray(output)
                ? output[0]?.generated_text ?? output[0]?.text ?? ''
                : output?.generated_text ?? output?.text ?? '';

            // Clean up the final response
            const finalTokens = await chatbot.tokenizer(finalResponse);
            const finalTokenArray = Array.from(finalTokens.input_ids.data || finalTokens.input_ids);
            
            if (finalTokenArray.length > promptTokenCount) {
                 const slicedFinal = finalTokenArray.slice(promptTokenCount);
                 finalResponse = chatbot.tokenizer.decode(slicedFinal, { skip_special_tokens: true });
            } else {
                 // Fallback string subtraction if token slicing acts weird on the final output
                 const plainPrompt = chatbot.tokenizer.decode(promptTokens.input_ids, { skip_special_tokens: true });
                 if (finalResponse.startsWith(plainPrompt)) {
                     finalResponse = finalResponse.substring(plainPrompt.length);
                 }
            }

            self.postMessage({ status: 'complete', message: finalResponse.trim(), targetId });
        } catch (err) {
            reportWorkerError(err, targetId);
        }
    }
};