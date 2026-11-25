/**
 * Recall Web - Local-First IndexedDB Persistent Storage
 * 100% Client-Side & Private. Zero server uploads.
 * 
 * Solves:
 * 1. Storage Quota Exceeded (IndexedDB allows hundreds of MBs/GBs, unlike localStorage 5MB limit)
 * 2. Automatic eviction & data loss (calls navigator.storage.persist())
 * 3. Ghost/stale images resurrecting (clean deletion sync between memories & deleted_ids)
 */

'use strict';

const RECALL_DB_NAME = 'RecallDB';
const RECALL_DB_VERSION = 2;
const STORE_MEMORIES = 'memories';
const STORE_DELETED = 'deleted_ids';
const STORE_META = 'metadata';

class RecallStorageEngine {
  constructor() {
    this.db = null;
    this.readyPromise = this.init();
    this.memoryCache = new Map();
  }

  async init() {
    // 1. Request persistent storage from browser
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Recall Storage] Persistent storage granted: ${isPersisted}`);
      } catch (e) {}
    }

    // 2. Open IndexedDB
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        console.warn('[Recall Storage] IndexedDB not available, using memory fallback');
        resolve(null);
        return;
      }

      const request = indexedDB.open(RECALL_DB_NAME, RECALL_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Memories store (User notes, pasted visuals, articles)
        if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
          const memStore = db.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
          memStore.createIndex('modifiedAt', 'modifiedAt', { unique: false });
          memStore.createIndex('type', 'type', { unique: false });
          memStore.createIndex('isNote', 'isNote', { unique: false });
        }

        // Deleted IDs store
        if (!db.objectStoreNames.contains(STORE_DELETED)) {
          db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
        }

        // App Metadata store
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        // Migrate any legacy localStorage memories to IndexedDB once
        await this.migrateFromLocalStorage();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('[Recall Storage] IndexedDB open error, fallback active:', event.target.error);
        resolve(null);
      };
    });
  }

  /**
   * Migrate legacy memories from localStorage to IndexedDB
   * and clean up localStorage to prevent 5MB quota errors
   */
  async migrateFromLocalStorage() {
    try {
      const raw = localStorage.getItem('recall_user_memories');
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          console.log(`[Recall Storage] Migrating ${list.length} memories from localStorage to IndexedDB...`);
          for (const mem of list) {
            await this.saveMemory(mem);
          }
        }
        // Remove the bulky base64 data from localStorage
        localStorage.removeItem('recall_user_memories');
      }
    } catch (e) {
      console.warn('[Recall Storage] Migration notice:', e);
    }
  }

  /**
   * Save a memory (note, pasted image, article) into persistent IndexedDB & local server sync
   */
  async saveMemory(mem) {
    if (!mem || !mem.id) return;
    const DEMO_IDS = new Set([
      'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
      'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
      'believe', 'redbull', 'memo', 'gtavi_hero'
    ]);
    if (DEMO_IDS.has(mem.id) || mem.isDemo) return;
    this.memoryCache.set(mem.id, mem);

    if (!this.db) return mem;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        store.put(mem);
        tx.oncomplete = () => resolve(mem);
        tx.onerror = () => resolve(mem);
      } catch (err) {
        console.warn('[Recall Storage] saveMemory error:', err);
        resolve(mem);
      }
    });
  }

  /**
   * Get all active user memories (Two-way cross-browser sync with local server)
   */
  async getAllMemories() {
    await this.readyPromise;
    const isLoggedIn = localStorage.getItem('recall_logged_in') === 'true';
    const userCleared = !isLoggedIn && localStorage.getItem('recall_user_cleared_all') === 'true';
    if (userCleared) {
      return [];
    }
    const deletedIds = await this.getDeletedIds();
    let localList = [];

    if (this.db) {
      localList = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction([STORE_MEMORIES], 'readonly');
          const store = tx.objectStore(STORE_MEMORIES);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve(Array.from(this.memoryCache.values()));
        } catch (err) {
          resolve(Array.from(this.memoryCache.values()));
        }
      });
    } else {
      localList = Array.from(this.memoryCache.values());
    }

    const DEMO_IDS = new Set([
      'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
      'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
      'believe', 'redbull', 'memo', 'gtavi_hero'
    ]);

    // Filter out any deleted memories and demo memories
    localList = localList.filter(m => m && m.id && !deletedIds.has(m.id) && !DEMO_IDS.has(m.id) && !m.isDemo);

    // Purge any legacy demo memories from local IndexedDB
    if (this.db) {
      try {
        const tx = this.db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        DEMO_IDS.forEach(dId => store.delete(dId));
      } catch (e) {}
    }
    localStorage.setItem('recall_initialized', 'true');

    // Rehydrate Float32Array fields that become plain objects in IndexedDB / JSON
    localList.forEach(m => {
      if (m.visualEmbedding && !(m.visualEmbedding instanceof Float32Array)) {
        try {
          m.visualEmbedding = Array.isArray(m.visualEmbedding)
            ? new Float32Array(m.visualEmbedding)
            : new Float32Array(Object.values(m.visualEmbedding));
        } catch(e) { m.visualEmbedding = null; }
      }
      if (m.embedding && !(m.embedding instanceof Float32Array)) {
        try {
          m.embedding = Array.isArray(m.embedding)
            ? new Float32Array(m.embedding)
            : new Float32Array(Object.values(m.embedding));
        } catch(e) { m.embedding = null; }
      }
      this.memoryCache.set(m.id, m);
    });

    return localList;
  }

  /**
   * Delete a memory:
   * - If user-created (note_*, pasted_*): permanently removes from memories store
   * - Records ID in deleted_ids store
   */
  async deleteMemory(id) {
    if (!id) return;
    this.memoryCache.delete(id);

    // Add to deleted IDs
    await this.addDeletedId(id);

    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  /**
   * Restore a memory on Undo
   */
  async restoreMemory(id, snapshot = null) {
    await this.removeDeletedId(id);
    if (snapshot) {
      await this.saveMemory(snapshot);
    }
  }

  /**
   * Deleted IDs Management
   */
  async getDeletedIds() {
    await this.readyPromise;
    // Always combine with localStorage for synchronous initial paint
    const localSet = new Set(JSON.parse(localStorage.getItem('recall_deleted_ids') || '[]'));

    if (!this.db) return localSet;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_DELETED], 'readonly');
        const store = tx.objectStore(STORE_DELETED);
        const req = store.getAll();
        req.onsuccess = () => {
          (req.result || []).forEach(item => localSet.add(item.id));
          localStorage.setItem('recall_deleted_ids', JSON.stringify([...localSet]));
          resolve(localSet);
        };
        req.onerror = () => resolve(localSet);
      } catch (e) {
        resolve(localSet);
      }
    });
  }

  async addDeletedId(id) {
    const local = JSON.parse(localStorage.getItem('recall_deleted_ids') || '[]');
    if (!local.includes(id)) {
      local.push(id);
      localStorage.setItem('recall_deleted_ids', JSON.stringify(local));
    }

    if (!this.db) return;
    try {
      const tx = this.db.transaction([STORE_DELETED], 'readwrite');
      tx.objectStore(STORE_DELETED).put({ id, deletedAt: Date.now() });
    } catch (e) {}
  }

  async removeDeletedId(id) {
    const local = JSON.parse(localStorage.getItem('recall_deleted_ids') || '[]').filter(x => x !== id);
    localStorage.setItem('recall_deleted_ids', JSON.stringify(local));

    if (!this.db) return;
    try {
      const tx = this.db.transaction([STORE_DELETED], 'readwrite');
      tx.objectStore(STORE_DELETED).delete(id);
    } catch (e) {}
  }

  async clearAllDeleted() {
    localStorage.removeItem('recall_deleted_ids');
    if (!this.db) return;
    try {
      const tx = this.db.transaction([STORE_DELETED], 'readwrite');
      tx.objectStore(STORE_DELETED).clear();
    } catch (e) {}
  }

  async clearAll() {
    this.memoryCache.clear();
    localStorage.removeItem('recall_deleted_ids');
    localStorage.removeItem('recall_user_memories');
    localStorage.setItem('recall_user_cleared_all', 'true');
    await this.readyPromise;
    if (!this.db) return true;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_MEMORIES, STORE_DELETED, STORE_META], 'readwrite');
        tx.objectStore(STORE_MEMORIES).clear();
        tx.objectStore(STORE_DELETED).clear();
        if (this.db.objectStoreNames.contains(STORE_META)) {
          tx.objectStore(STORE_META).clear();
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Clears local client device cache when signing out or switching accounts.
   */
  async clearLocalUserCache() {
    this.memoryCache.clear();
    localStorage.removeItem('recall_deleted_ids');
    localStorage.removeItem('recall_user_memories');
    localStorage.removeItem('recall_user_cleared_all');
    await this.readyPromise;
    if (!this.db) return true;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_MEMORIES, STORE_DELETED], 'readwrite');
        tx.objectStore(STORE_MEMORIES).clear();
        tx.objectStore(STORE_DELETED).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

// Global persistent storage instance
window.recallStorage = new RecallStorageEngine();
