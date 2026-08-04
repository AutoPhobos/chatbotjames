// ─── Screen Wake Lock ───────────────────────────────────────────────────
// Keeps the screen on during model downloads, which can take several minutes.

let _wakeLock = null;

export async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || _wakeLock) return;
    try {
        _wakeLock = await navigator.wakeLock.request('screen');
        // Browser may release it on tab-switch; re-acquire on return
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
        document.addEventListener('visibilitychange', _onWakeLockVisibilityChange);
        console.log('🔆 Screen Wake Lock acquired');
    } catch (e) {
        console.warn('Wake Lock unavailable:', e.message);
    }
}

function _onWakeLockVisibilityChange() {
    if (document.visibilityState === 'visible') acquireWakeLock();
}

export function releaseWakeLock() {
    if (_wakeLock) {
        _wakeLock.release().catch(() => { });
        _wakeLock = null;
        document.removeEventListener('visibilitychange', _onWakeLockVisibilityChange);
        console.log('🔅 Screen Wake Lock released');
    }
}

// ─── Sound Engine (Web Audio API, no external files) ─────────────────────────
const _audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function _playTone({ freq = 440, type = 'sine', gainPeak = 0.18, duration = 0.12, rampUp = 0.01, rampDown = 0.10 } = {}) {
    try {
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, _audioCtx.currentTime);
        gain.gain.setValueAtTime(0, _audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(gainPeak, _audioCtx.currentTime + rampUp);
        gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + duration);
        osc.start(_audioCtx.currentTime);
        osc.stop(_audioCtx.currentTime + duration + 0.02);
    } catch (e) { /* silently ignore if AudioContext not ready */ }
}

export function playSendSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 880, type: 'sine', gainPeak: 0.10, duration: 0.10, rampUp: 0.005, rampDown: 0.09 });
}

export function playDoneSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 523.25, type: 'sine', gainPeak: 0.10, duration: 0.18, rampUp: 0.01 }); // C5
    setTimeout(() => _playTone({ freq: 783.99, type: 'sine', gainPeak: 0.08, duration: 0.22, rampUp: 0.01 }), 120); // G5
}

export function playGameMoveSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 380, type: 'triangle', gainPeak: 0.15, duration: 0.08, rampUp: 0.01, rampDown: 0.07 });
}

export function playGameWinSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 523.25, type: 'square', gainPeak: 0.08, duration: 0.15 }); // C5
    setTimeout(() => _playTone({ freq: 659.25, type: 'square', gainPeak: 0.08, duration: 0.15 }), 150); // E5
    setTimeout(() => _playTone({ freq: 783.99, type: 'square', gainPeak: 0.12, duration: 0.4 }), 300); // G5
}

export function playGameLoseSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 349.23, type: 'sawtooth', gainPeak: 0.08, duration: 0.3 }); // F4
    setTimeout(() => _playTone({ freq: 311.13, type: 'sawtooth', gainPeak: 0.08, duration: 0.3 }), 250); // Eb4
    setTimeout(() => _playTone({ freq: 293.66, type: 'sawtooth', gainPeak: 0.12, duration: 0.5 }), 500); // D4
}

export function playGameBuffSound() {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    _playTone({ freq: 600, type: 'sine', gainPeak: 0.1, duration: 0.15 });
    setTimeout(() => _playTone({ freq: 880, type: 'sine', gainPeak: 0.15, duration: 0.2 }), 100);
}
