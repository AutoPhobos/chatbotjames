// ─── IndexedDB Chat + Notes Storage ──────────────────────────────────────────
// All data is encrypted at rest using AES-256-GCM via crypto-utils.js.
// Callers see plain JS objects; encryption/decryption is fully transparent.

import { initEncryption, encryptObject, decryptObject } from './crypto-utils.js';

export const safeLocalStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch (e) { } },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch (e) { } }
};

const IDB_NAME        = 'james-chats-db';
const IDB_STORE       = 'chats';
const IDB_NOTES_STORE = 'user-notes';
let _idb = null;
let _idbPromise = null; // Prevents concurrent open() races — callers share one promise

export async function openChatDB() {
    if (_idb) return _idb;
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 2); // v2 adds user-notes store
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(IDB_NOTES_STORE)) {
                db.createObjectStore(IDB_NOTES_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
        req.onerror   = (e) => { _idbPromise = null; reject(e.target.error); };
    });
    return _idbPromise;
}

// ─── Chat Storage ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: encrypt and persist a single chat to IndexedDB.
 * Stored format: { id, data: { iv, ct } }  (only `id` is plaintext for the keyPath)
 */
export function dbSaveChat(chat) {
    if (!chat) return;
    const { id } = chat;
    const payload = {
        name: chat.name,
        messages: chat.messages,
        gameState: chat.gameState ?? null
    };
    Promise.all([encryptObject(payload), openChatDB()])
        .then(([data, db]) => {
            try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put({ id, data });
            } catch (e) {
                console.warn('IDB save transaction failed:', e);
            }
        })
        .catch(e => console.warn('IDB save failed:', e));
}

/** Fire-and-forget: delete a chat from IndexedDB by id. */
export function dbDeleteChat(id) {
    openChatDB()
        .then(db => {
            try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).delete(id);
            } catch (e) {
                console.warn('IDB delete transaction failed:', e);
            }
        })
        .catch(e => console.warn('IDB delete failed:', e));
}

/** Load all chats, sorted newest-first. Decrypts each row transparently. */
export async function dbLoadAllChats() {
    await initEncryption(); // Ensure key is ready before any decrypt
    try {
        const db = await openChatDB();
        const rows = await new Promise((resolve, reject) => {
            const tx  = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror   = (e) => reject(e.target.error);
        });

        const chats = await Promise.all(rows.map(async row => {
            try {
                if (row.data) {
                    // Encrypted format (v2+)
                    const payload = await decryptObject(row.data);
                    return { id: row.id, ...payload };
                }
                // Legacy unencrypted format — return as-is (migration path)
                return row;
            } catch (e) {
                console.warn(`⚠️ Could not decrypt chat ${row.id} — skipping:`, e);
                return null;
            }
        }));

        return chats
            .filter(Boolean)
            .sort((a, b) => b.id - a.id);
    } catch (e) {
        console.warn('IDB load failed, falling back to empty state:', e);
        return [];
    }
}

/**
 * One-time migration: move existing safeLocalStorage chats into IndexedDB,
 * then clear the old key so this only runs once.
 */
export async function migrateFromLocalStorage() {
    const raw = safeLocalStorage.getItem('chatbot-chats');
    if (!raw) return;
    try {
        const chats = JSON.parse(raw);
        if (Array.isArray(chats) && chats.length > 0) {
            console.log(`📦 Migrating ${chats.length} chat(s) from localStorage → encrypted IndexedDB…`);
            await openChatDB();
            for (const chat of chats) dbSaveChat(chat); // encrypted on save
            safeLocalStorage.removeItem('chatbot-chats');
            console.log('✅ Migration complete (chats now encrypted)');
        }
    } catch (e) {
        console.warn('localStorage migration failed:', e);
    }
}

// ─── User Notes Storage ───────────────────────────────────────────────────────
// Each note: { id: string (UUID), text: string, timestamp: number }
// Stored format: { id, data: { iv, ct } }

/** Encrypt and persist a single note. Fire-and-forget. */
export function dbSaveNote(note) {
    if (!note) return;
    const { id } = note;
    const payload = { text: note.text, timestamp: note.timestamp };
    Promise.all([encryptObject(payload), openChatDB()])
        .then(([data, db]) => {
            try {
                const tx = db.transaction(IDB_NOTES_STORE, 'readwrite');
                tx.objectStore(IDB_NOTES_STORE).put({ id, data });
            } catch (e) {
                console.warn('IDB note save failed:', e);
            }
        })
        .catch(e => console.warn('IDB note save failed:', e));
}

/** Load all notes, sorted oldest-first. Decrypts each row transparently. */
export async function dbLoadNotes() {
    await initEncryption();
    try {
        const db   = await openChatDB();
        const rows = await new Promise((resolve, reject) => {
            const tx  = db.transaction(IDB_NOTES_STORE, 'readonly');
            const req = tx.objectStore(IDB_NOTES_STORE).getAll();
            req.onsuccess = (e) => resolve(e.target.result || []);
            req.onerror   = (e) => reject(e.target.error);
        });

        const notes = await Promise.all(rows.map(async row => {
            try {
                const payload = await decryptObject(row.data);
                return { id: row.id, ...payload };
            } catch (e) {
                console.warn(`⚠️ Could not decrypt note ${row.id}:`, e);
                return null;
            }
        }));

        return notes
            .filter(Boolean)
            .sort((a, b) => a.timestamp - b.timestamp);
    } catch (e) {
        console.warn('IDB notes load failed:', e);
        return [];
    }
}

/** Delete a single note by id. Fire-and-forget. */
export function dbDeleteNote(id) {
    openChatDB()
        .then(db => {
            try {
                const tx = db.transaction(IDB_NOTES_STORE, 'readwrite');
                tx.objectStore(IDB_NOTES_STORE).delete(id);
            } catch (e) {
                console.warn('IDB note delete failed:', e);
            }
        })
        .catch(e => console.warn('IDB note delete failed:', e));
}

/** Wipe all notes. Returns a promise. */
export async function dbClearNotes() {
    try {
        const db = await openChatDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_NOTES_STORE, 'readwrite');
            tx.objectStore(IDB_NOTES_STORE).clear();
            tx.oncomplete = resolve;
            tx.onerror    = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.warn('IDB notes clear failed:', e);
    }
}
