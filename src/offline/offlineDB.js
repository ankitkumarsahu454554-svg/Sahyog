/**
 * SahyogAI Vanilla IndexedDB Outbox & Local Storage Engine
 * ---------------------------------------------------------
 * Zero-dependency client-side database management for disaster offline operation.
 * Manages two primary stores:
 *   1. 'cached_state'     : Read-only snapshots of critical portal resources.
 *   2. 'emergency_outbox' : Priority queue for mutations buffered during network outages.
 */

(function (global) {
  'use strict';

  const DB_NAME = 'sahyog_offline_db';
  const DB_VERSION = 1;

  const STORES = {
    CACHED_STATE: 'cached_state',
    EMERGENCY_OUTBOX: 'emergency_outbox',
  };

  let dbInstance = null;
  let dbPromise = null;

  /**
   * Cryptographically secure UUID generator with robust math-random fallback.
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
      );
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Opens or returns the active IndexedDB connection.
   */
  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not supported in this runtime environment.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. cached_state store for read-only snapshots
        if (!db.objectStoreNames.contains(STORES.CACHED_STATE)) {
          const stateStore = db.createObjectStore(STORES.CACHED_STATE, { keyPath: 'key' });
          stateStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }

        // 2. emergency_outbox store for queuing offline mutations
        if (!db.objectStoreNames.contains(STORES.EMERGENCY_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORES.EMERGENCY_OUTBOX, { keyPath: 'id' });
          outboxStore.createIndex('by_priority', 'priorityScore', { unique: false });
          outboxStore.createIndex('by_status', 'syncStatus', { unique: false });
          outboxStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
          dbPromise = null;
        };
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        dbPromise = null;
        reject(new Error(`IndexedDB open failed: ${event.target.error?.message || 'Unknown error'}`));
      };
    });

    return dbPromise;
  }

  /**
   * Helper to execute a transaction on an object store.
   */
  async function withStore(storeName, mode, callback) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      let result;
      try {
        result = callback(store);
      } catch (err) {
        return reject(err);
      }

      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    });
  }

  // ==========================================================================
  // CACHED_STATE API
  // ==========================================================================

  /**
   * Saves or overwrites a snapshot in the cached_state store.
   * @param {string} key - Unique descriptor, e.g. 'incidents', 'resources'
   * @param {any} data - Data payload to persist
   */
  async function setCachedState(key, data) {
    if (!key) throw new Error('A valid key is required for setCachedState.');
    const entry = {
      key,
      data,
      timestamp: Date.now(),
    };
    return withStore(STORES.CACHED_STATE, 'readwrite', (store) => {
      store.put(entry);
      return entry;
    });
  }

  /**
   * Retrieves a cached snapshot by key.
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async function getCachedState(key) {
    return withStore(STORES.CACHED_STATE, 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      });
    });
  }

  /**
   * Clears a specific cached state entry or all state entries.
   * @param {string} [key]
   */
  async function clearCachedState(key) {
    return withStore(STORES.CACHED_STATE, 'readwrite', (store) => {
      if (key) {
        store.delete(key);
      } else {
        store.clear();
      }
    });
  }

  // ==========================================================================
  // EMERGENCY_OUTBOX API
  // ==========================================================================

  /**
   * Enqueues an offline mutation into the emergency_outbox.
   * @param {Object} item
   * @param {string} item.url
   * @param {string} [item.method='POST']
   * @param {Object} [item.headers={}]
   * @param {any} [item.body=null]
   * @param {number} [item.priorityScore=50]
   * @returns {Promise<Object>} The persisted outbox record
   */
  async function enqueueOutbox(item) {
    if (!item || !item.url) {
      throw new Error('Outbox item requires at least a destination url.');
    }

    const record = {
      id: item.id || generateUUID(),
      url: item.url,
      method: (item.method || 'POST').toUpperCase(),
      headers: item.headers || {},
      body: item.body !== undefined ? item.body : null,
      timestamp: item.timestamp || Date.now(),
      priorityScore: typeof item.priorityScore === 'number' ? item.priorityScore : 50,
      syncStatus: item.syncStatus || 'pending', // 'pending' | 'syncing' | 'failed'
      retryCount: item.retryCount || 0,
      lastError: item.lastError || null,
    };

    await withStore(STORES.EMERGENCY_OUTBOX, 'readwrite', (store) => {
      store.put(record);
    });

    // Notify application runtime
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sahyog:outbox-updated', {
        detail: { action: 'enqueue', item: record }
      }));
    }

    return record;
  }

  /**
   * Retrieves all outbox items ready for dispatch, sorted by priority descending and timestamp ascending.
   * @returns {Promise<Array<Object>>}
   */
  async function getPendingOutbox() {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          // Filter to items that are either pending or failed retryable
          const pending = list.filter((i) => i.syncStatus === 'pending' || i.syncStatus === 'failed');
          // Sort by priorityScore (highest first), then FIFO by timestamp
          pending.sort((a, b) => {
            if (b.priorityScore !== a.priorityScore) {
              return b.priorityScore - a.priorityScore;
            }
            return a.timestamp - b.timestamp;
          });
          resolve(pending);
        };
        req.onerror = () => resolve([]);
      });
    });
  }

  /**
   * Updates an outbox item's syncStatus and failure telemetry.
   * @param {string} id
   * @param {'pending'|'syncing'|'failed'} syncStatus
   * @param {string|null} [lastError=null]
   */
  async function updateOutboxStatus(id, syncStatus, lastError = null) {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const item = getReq.result;
          if (!item) return resolve(null);

          item.syncStatus = syncStatus;
          if (syncStatus === 'failed') {
            item.retryCount = (item.retryCount || 0) + 1;
            item.lastError = lastError ? String(lastError) : 'Sync attempt failed';
          }
          const putReq = store.put(item);
          putReq.onsuccess = () => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('sahyog:outbox-updated', {
                detail: { action: 'update', item }
              }));
            }
            resolve(item);
          };
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    });
  }

  /**
   * Removes an item from the outbox upon successful synchronization.
   * @param {string} id
   */
  async function removeOutbox(id) {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readwrite', (store) => {
      store.delete(id);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sahyog:outbox-updated', {
          detail: { action: 'remove', id }
        }));
      }
    });
  }

  /**
   * Returns total count of items pending or in progress in the outbox.
   * @returns {Promise<number>}
   */
  async function getOutboxCount() {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          const active = items.filter((i) => i.syncStatus !== 'synced');
          resolve(active.length);
        };
        req.onerror = () => resolve(0);
      });
    });
  }

  /**
   * Retrieves all items currently stored in the outbox regardless of status.
   * @returns {Promise<Array<Object>>}
   */
  async function getAllOutbox() {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readonly', (store) => {
      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  }

  /**
   * Clears all records from the outbox.
   */
  async function clearOutbox() {
    return withStore(STORES.EMERGENCY_OUTBOX, 'readwrite', (store) => {
      store.clear();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sahyog:outbox-updated', {
          detail: { action: 'clear' }
        }));
      }
    });
  }

  // --- API Public Interface ---
  const offlineDB = {
    generateUUID,
    openDB,
    // Cached State
    setCachedState,
    getCachedState,
    clearCachedState,
    // Emergency Outbox
    enqueueOutbox,
    getPendingOutbox,
    updateOutboxStatus,
    removeOutbox,
    getOutboxCount,
    getAllOutbox,
    clearOutbox,
  };

  // Attach to global window object
  if (typeof window !== 'undefined') {
    window.offlineDB = offlineDB;
  }

  // CommonJS / ES module compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = offlineDB;
  }
})(typeof window !== 'undefined' ? window : globalThis);
