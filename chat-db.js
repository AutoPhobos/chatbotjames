// ─── IndexedDB Chat Storage ──────────────────────────────────────────────────
// Replaces safeLocalStorage for chat history — no 5 MB limit, async, fast.

export const safeLocalStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch (e) { } },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch (e) { } }
};

const IDB_NAME = 'james-chats-db';
const IDB_STORE = 'chats';
let _idb = null;
let _idbPromise = null; // Prevents concurrent open() races — callers share one promise

export async function openChatDB() {
    if (_idb) return _idb;
    if (_idbPromise) return _idbPromise; // Return the in-progress open to any concurrent caller
    _idbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
        req.onerror = (e) => { _idbPromise = null; reject(e.target.error); };
    });
    return _idbPromise;
}

/** Fire-and-forget: persist a single chat to IndexedDB. */
export function dbSaveChat(chat) {
    if (!chat) return;
    openChatDB()
        .then(db => {
            try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(chat);
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

/** Load all chats, sorted newest-first (id is a timestamp). */
export async function dbLoadAllChats() {
    try {
        const db = await openChatDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).getAll();
            req.onsuccess = (e) => {
                const chats = (e.target.result || []).sort((a, b) => b.id - a.id);
                resolve(chats);
            };
            req.onerror = (e) => reject(e.target.error);
        });
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
            console.log(`📦 Migrating ${chats.length} chat(s) from safeLocalStorage → IndexedDB…`);
            await openChatDB();
            for (const chat of chats) dbSaveChat(chat);
            safeLocalStorage.removeItem('chatbot-chats');
            console.log('✅ Migration complete');
        }
    } catch (e) {
        console.warn('safeLocalStorage migration failed:', e);
    }
}
