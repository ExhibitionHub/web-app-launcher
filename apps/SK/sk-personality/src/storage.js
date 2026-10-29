/**
 * Global Vote Storage Script for BrightSign/Limited Environments
 * Prioritizes IndexedDB > LocalStorage > Memory
 * Optimized for performance and reliability
 */

(function(window) {
    const STORAGE_KEY = 'sk_quiz_votes_v1';
    const DB_NAME = 'VoteStorageDB';
    const STORE_NAME = 'votes_store';
    const VOTE_API_URL = resolveVoteApiUrl();
    
    // In-memory fallback
    let memoryStore = { total: 0, options: {} };

    // --- IndexedDB Helpers ---
    
    const dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            reject('IndexedDB not supported');
            return;
        }
        
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });

    async function idbGet(key) {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.warn('IDB Get Error:', e);
            return null;
        }
    }

    async function idbSet(key, val) {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(val, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.warn('IDB Set Error:', e);
        }
    }

    // --- Main Logic ---

    async function loadVotes() {
        if (VOTE_API_URL) {
            try {
                const response = await fetch(VOTE_API_URL, {
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    memoryStore = normalizeVotes(data);
                    await syncBrowserCache(memoryStore);
                    return memoryStore;
                }
            } catch (e) {
                console.warn('Vote API unavailable, falling back to browser storage.', e);
            }
        }

        // 1. Try IndexedDB
        try {
            const data = await idbGet(STORAGE_KEY);
            if (data) {
                memoryStore = normalizeVotes(data); // Sync memory
                return memoryStore;
            }
        } catch (e) {}

        // 2. Try LocalStorage
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = normalizeVotes(JSON.parse(raw));
                memoryStore = data; // Sync memory
                return data;
            }
        } catch (e) {}

        // 3. Return Default (and sync memory)
        return normalizeVotes(memoryStore);
    }

    async function saveVotes(votes) {
        // Update memory immediately
        memoryStore = normalizeVotes(votes);
        const json = JSON.stringify(memoryStore);

        // 1. Try IndexedDB
        try {
            await idbSet(STORAGE_KEY, memoryStore);
        } catch (e) {}

        // 2. Try LocalStorage (always try to keep in sync if possible)
        try {
            localStorage.setItem(STORAGE_KEY, json);
        } catch (e) {
            console.warn('LocalStorage Error (Quota?):', e);
        }
    }

    async function addVote(optionId) {
        if (VOTE_API_URL) {
            try {
                const response = await fetch(VOTE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ optionId })
                });

                if (response.ok) {
                    const data = normalizeVotes(await response.json());
                    memoryStore = data;
                    await syncBrowserCache(data);
                    return data;
                }
            } catch (e) {
                console.warn('Vote API add failed, falling back to browser storage.', e);
            }
        }

        const votes = await loadVotes();
        
        // Ensure structure exists
        if (!votes.options) votes.options = {};
        if (typeof votes.total !== 'number') votes.total = 0;

        votes.total++;
        votes.options[optionId] = (votes.options[optionId] || 0) + 1;
        
        await saveVotes(votes);
        return votes;
    }

    async function getVoteStats() {
        return await loadVotes();
    }

    // Expose globally
    window.VoteManager = {
        loadVotes,
        saveVotes,
        addVote,
        getVoteStats
    };

    console.log('VoteManager initialized');

    function normalizeVotes(votes) {
        return {
            total: typeof votes?.total === 'number' ? votes.total : 0,
            options: typeof votes?.options === 'object' && votes?.options !== null ? votes.options : {}
        };
    }

    async function syncBrowserCache(votes) {
        await saveVotesToBrowser(votes);
    }

    async function saveVotesToBrowser(votes) {
        memoryStore = normalizeVotes(votes);

        try {
            await idbSet(STORAGE_KEY, memoryStore);
        } catch (e) {}

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
        } catch (e) {
            console.warn('LocalStorage Error (Quota?):', e);
        }
    }

    function resolveVoteApiUrl() {
        const configuredUrl = document.querySelector('meta[name="vote-api"]')?.content?.trim();
        if (!configuredUrl) {
            return null;
        }

        try {
            return new URL(configuredUrl, window.location.href).toString();
        } catch {
            return null;
        }
    }

})(window);
