/**
 * crypto-utils.js — AES-256-GCM encryption via the Web Crypto API.
 *
 * The master key is generated once per browser/origin and stored in
 * localStorage as an exported JWK (Base64-encoded JSON).
 *
 * Threat model: protects IDB data files on disk from raw file-system
 * inspection (e.g. shared computer, forensic imaging). Does NOT protect
 * against same-origin JavaScript running on the same page.
 */

const KEY_STORAGE_KEY = 'james-enc-key-v1';
let _cryptoKey = null; // In-memory cache — only loaded once per page lifetime
let _cryptoKeyPromise = null; // Prevent concurrent callers from generating different keys

/**
 * Load or generate the AES-256-GCM master key.
 * Idempotent — safe to call many times; concurrent callers share one operation.
 * @returns {Promise<CryptoKey>}
 */
export async function initEncryption() {
    if (_cryptoKey) return _cryptoKey;
    if (_cryptoKeyPromise) return _cryptoKeyPromise;

    _cryptoKeyPromise = (async () => {
        let stored;
        try {
            stored = localStorage.getItem(KEY_STORAGE_KEY);
        } catch (e) {
            console.warn('⚠️ Could not read the encryption key from localStorage:', e);
        }

        if (stored) {
            const jwk = JSON.parse(atob(stored));
            _cryptoKey = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            return _cryptoKey;
        }

        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        _cryptoKey = key;

        try {
            const jwk = await crypto.subtle.exportKey('jwk', key);
            localStorage.setItem(KEY_STORAGE_KEY, btoa(JSON.stringify(jwk)));
            console.log('🔐 New AES-256-GCM encryption key generated.');
        } catch (e) {
            // Private/incognito mode may block localStorage — non-fatal
            console.warn('⚠️ Could not persist encryption key to localStorage:', e);
        }

        return key;
    })();

    try {
        return await _cryptoKeyPromise;
    } catch (e) {
        _cryptoKey = null;
        throw new Error('Unable to initialize the encryption key. Existing encrypted data was not replaced.', { cause: e });
    } finally {
        _cryptoKeyPromise = null;
    }
}

/**
 * Encrypt a UTF-8 plaintext string.
 * Uses a random 96-bit IV for every call (standard for AES-GCM).
 * @param {string} plaintext
 * @returns {Promise<{iv: string, ct: string}>} Both values are Base64.
 */
export async function encrypt(plaintext) {
    if (typeof plaintext !== 'string') {
        throw new TypeError('encrypt() requires a string plaintext');
    }
    const key = await initEncryption();
    const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const encoded  = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    return {
        iv: _u8ToB64(iv),
        ct: _u8ToB64(new Uint8Array(ciphertext))
    };
}

/**
 * Decrypt an envelope produced by {@link encrypt}.
 * @param {{iv: string, ct: string}} envelope
 * @returns {Promise<string>} plaintext
 */
export async function decrypt(envelope) {
    if (!envelope || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
        throw new TypeError('decrypt() requires an envelope with Base64 iv and ct strings');
    }
    const key = await initEncryption();
    const iv  = _b64ToU8(envelope.iv);
    const ct  = _b64ToU8(envelope.ct);
    if (iv.length !== 12) throw new TypeError('Invalid AES-GCM IV');
    if (ct.length < 16) throw new TypeError('Invalid AES-GCM ciphertext');

    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ct
    );
    return new TextDecoder().decode(plaintext);
}

/** Encrypt any JSON-serialisable value. */
export async function encryptObject(obj) {
    const text = JSON.stringify(obj);
    if (text === undefined) throw new TypeError('encryptObject() requires a JSON-serialisable value');
    return encrypt(text);
}

/** Decrypt an envelope back to a parsed JS value. */
export async function decryptObject(envelope) {
    const text = await decrypt(envelope);
    return JSON.parse(text);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function _u8ToB64(u8) {
    // Chunked on purpose: spreading a large Uint8Array into String.fromCharCode
    // exceeds the engine's argument limit (~64-125k) and throws RangeError,
    // which silently broke persistence for any chat over ~64 KB.
    const CHUNK = 0x8000;
    let str = '';
    for (let i = 0; i < u8.length; i += CHUNK) {
        str += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(str);
}

function _b64ToU8(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
