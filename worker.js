import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

env.allowLocalModels = false;
env.useBrowserCache = true; // Use transformers.js robust native caching to prevent download hangs

let chatbot;
let activeAbortController = null;

const systemPrompt = `You are JAMES (just a machine engineered for speech), an advanced AI assistant and a friend.

You have access to the following tools:
- weather (params: location)
- wikipedia (params: query)
- currency (params: from, to, amount)
- time (params: timezone)
- calculator (params: expr)
- convert (params: value, from, to)

CRITICAL RULES:
1. ONLY call a tool if you absolutely need real-time or external data (weather, calculations, currency, time, facts, conversions).
2. If the user is just chatting or being friendly (like "hi" or "who are you"), DO NOT use a tool. Just reply directly in plain text.
3. If you MUST use a tool, output exactly this code block and nothing else:
\`\`\`tool:run
[tool_name]
[param]: [value]
\`\`\`

EXAMPLES OF TOOL CALLS:
- User: "What's the weather in Tokyo?"
\`\`\`tool:run
weather
location: Tokyo
\`\`\`

- User: "Convert 150 USD to EUR"
\`\`\`tool:run
currency
from: USD
to: EUR
amount: 150
\`\`\`

- User: "What time is it in New York?"
\`\`\`tool:run
time
timezone: America/New_York
\`\`\`

- User: "Calculate 512 * 8 + 32"
\`\`\`tool:run
calculator
expr: 512 * 8 + 32
\`\`\`

- User: "Tell me about quantum computing on Wikipedia"
\`\`\`tool:run
wikipedia
query: quantum computing
\`\`\`

- User: "Convert 5 miles to kilometers"
\`\`\`tool:run
convert
value: 5
from: miles
to: kilometers
\`\`\``;

const MODEL_PRESETS = [
    { id: 'lite-smollm-135m-q4',   label: 'SmolLM2 135M q4 (Safe Mobile)', backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q4',    requires: 'cpu', autoSelect: true,  sizeMB: 90,   ram: '256 MB' },
    { id: 'lite-smollm-135m-q8',   label: 'SmolLM2 135M q8 (Lite)',         backend: 'wasm',   model: 'HuggingFaceTB/SmolLM2-135M-Instruct',           dtype: 'q8',    requires: 'cpu', autoSelect: true,  sizeMB: 150,  ram: '512 MB' },
    { id: 'cpu-qwen25-05b-q4',     label: 'Qwen2.5 0.5B (WASM)',            backend: 'wasm',   model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4',    requires: 'cpu', autoSelect: true,  sizeMB: 400,  ram: '1 GB' },
    { id: 'gpu-qwen25-05b-q4f16',   label: 'Qwen2.5 0.5B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Qwen2.5-0.5B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 400,  ram: '2 GB' },
    { id: 'gpu-llama32-1b-q4f16',   label: 'Llama 3.2 1B (WebGPU)',        backend: 'webgpu', model: 'onnx-community/Llama-3.2-1B-Instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: true,  sizeMB: 750,  ram: '3 GB' },
    { id: 'gpu-smollm2-1.7b-q4f16', label: 'SmolLM2 1.7B (WebGPU)',        backend: 'webgpu', model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',           dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 950,  ram: '3 GB' },
    { id: 'gpu-gemma3-1b-q4f16',    label: 'Gemma 3 1B (WebGPU)',          backend: 'webgpu', model: 'onnx-community/gemma-3-1b-it',                  dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 600,  ram: '3 GB' },
    { id: 'gpu-deepseek-15b-q4f16', label: 'DeepSeek-R1 1.5B (WebGPU)',    backend: 'webgpu', model: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B', dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 1000, ram: '4 GB' },
    { id: 'gpu-phi35-mini-q4f16',   label: 'Phi-3.5-mini 3.8B (WebGPU)',   backend: 'webgpu', model: 'onnx-community/Phi-3.5-mini-instruct',          dtype: 'q4f16', requires: 'gpu', autoSelect: false, sizeMB: 2200, ram: '8 GB' },
];

function isMobileDevice() {
    const ua = navigator.userAgent;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const isNarrowScreen = self.screen && self.screen.width < 1024;
    const hasTouchPoints = navigator.maxTouchPoints > 1;
    return isMobileUA || (hasTouchPoints && isNarrowScreen);
}

async function detectGpu() {
    if (isMobileDevice()) return { hasGpu: false, reason: 'Mobile device forced to WASM for stability' };
    if (!navigator.gpu) return { hasGpu: false, reason: 'No WebGPU API' };
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter || adapter.isFallbackAdapter) return { hasGpu: false, reason: 'Fallback adapter' };
        return { hasGpu: true, vendor: adapter.info?.vendor || 'WebGPU' };
    } catch (e) {
        return { hasGpu: false, reason: e.message };
    }
}

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
                    self.postMessage({ status: 'downloading', loaded: p.loaded, total: p.total, file: p.file || '' });
                }
            },
        });
    } catch (err) {
        if (provider === 'webgpu') {
            console.warn('WebGPU init failed, falling back to WASM:', err);
            return await pipeline('text-generation', model, {
                device: 'wasm',
                dtype: { model: 'q4', decoder_model_merged: 'q4', default: 'fp32' },
                progress_callback: (p) => {
                    if (p && typeof p.loaded === 'number' && typeof p.total === 'number') {
                        self.postMessage({ status: 'downloading', loaded: p.loaded, total: p.total, file: p.file || '' });
                    }
                },
            });
        }
        throw err;
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

            self.postMessage({ status: 'hardware-info', gpuInfo, ram, mobile, presets: MODEL_PRESETS });

            let targetPreset = MODEL_PRESETS[0]; // SmolLM2 135M safe mobile default

            if (forcePresetId) {
                const found = MODEL_PRESETS.find(p => p.id === forcePresetId);
                if (found) targetPreset = found;
            } else if (!mobile && gpuInfo.hasGpu) {
                targetPreset = MODEL_PRESETS.find(p => p.id === 'gpu-qwen25-05b-q4f16') || MODEL_PRESETS[3];
            } else if (!mobile) {
                targetPreset = MODEL_PRESETS.find(p => p.backend === 'wasm' && !p.id.startsWith('lite-')) || MODEL_PRESETS[2];
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
