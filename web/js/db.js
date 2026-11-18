/**
 * Recall Web - Local-first IndexedDB Database Manager
 * 100% Client-Side & Private. No server upload.
 */

const DB_NAME = 'RecallDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';

class RecallDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('modifiedAt', 'modifiedAt', { unique: false });
          store.createIndex('isFavorite', 'isFavorite', { unique: false });
          store.createIndex('contentType', 'contentType', { unique: false });
          store.createIndex('kind', 'kind', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async getAllItems() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // Return sorted descending by modifiedAt
        const items = request.result || [];
        items.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        resolve(items);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getItemById(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveItem(item) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);

      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteItem(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async toggleFavorite(id) {
    const item = await this.getItemById(id);
    if (!item) return null;
    item.isFavorite = !item.isFavorite;
    await this.saveItem(item);
    return item;
  }

  async exportAll() {
    const items = await this.getAllItems();
    return JSON.stringify(items, null, 2);
  }

  async importAll(jsonString) {
    const items = JSON.parse(jsonString);
    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const item of items) {
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(items.length);
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

window.recallDB = new RecallDB();
