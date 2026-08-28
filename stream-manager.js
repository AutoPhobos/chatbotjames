import { CONFIG } from './config.js';
import { updateLiveBubble } from './message-renderer.js';

// ─── Character-by-character Streaming Animation ──────────────────────────────
export const streamQueues = new Map();

// Monotonically increasing bubble IDs — collision-free alternative to Date.now()
let _nextTargetId = 0;
export const getNextTargetId = () => ++_nextTargetId;

// targetIds whose stream has already been flushed. A 'streaming' message that
// lands after 'complete' would otherwise rebuild the queue from scratch and
// resurrect a stale bubble on top of the finished message.
const _finished = new Set();

export function queueStreamText(targetId, fullText) {
    if (_finished.has(targetId)) return;
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
    state.timeoutId = setTimeout(() => drainStreamQueue(targetId), CONFIG.ui.streamRenderIntervalMs);
}

export function flushStreamQueue(targetId) {
    _finished.add(targetId);
    if (_finished.size > 64) _finished.delete(_finished.values().next().value);
    const state = streamQueues.get(targetId);
    if (state) {
        if (state.timeoutId) clearTimeout(state.timeoutId);
        updateLiveBubble(state.pending, targetId, true);
    }
    streamQueues.delete(targetId);
}
