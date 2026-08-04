import { CONFIG } from './config.js';
import { updateLiveBubble } from './message-renderer.js';

// ─── Character-by-character Streaming Animation ──────────────────────────────
export const streamQueues = new Map();

// Monotonically increasing bubble IDs — collision-free alternative to Date.now()
let _nextTargetId = 0;
export const getNextTargetId = () => ++_nextTargetId;

export function queueStreamText(targetId, fullText) {
    if (!streamQueues.has(targetId)) {
        streamQueues.set(targetId, { pending: fullText, displayed: '', running: false });
    } else {
        streamQueues.get(targetId).pending = fullText;
    }
    const state = streamQueues.get(targetId);
    if (!state.running) drainStreamQueue(targetId);
}

export function drainStreamQueue(targetId) {
    const state = streamQueues.get(targetId);
    if (!state || state.displayed.length >= state.pending.length) {
        if (state) state.running = false;
        return;
    }
    state.running = true;

    // Advance exactly one character
    state.displayed = state.pending.slice(0, state.displayed.length + 1);
    updateLiveBubble(state.displayed, targetId);

    // Speed is controlled by CONFIG.ui.streamRenderIntervalMs (default 15 ms)
    setTimeout(() => drainStreamQueue(targetId), CONFIG.ui.streamRenderIntervalMs);
}

export function flushStreamQueue(targetId) {
    const state = streamQueues.get(targetId);
    if (state) updateLiveBubble(state.pending, targetId, true);
    streamQueues.delete(targetId);
}
