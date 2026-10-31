/**
 * SahyogAI Transparent Network Interceptor & Sync Manager
 * --------------------------------------------------------
 * Intercepts network calls globally (monkey-patching window.fetch) without
 * altering any application business logic or UI controllers.
 *
 * Responsibilities:
 *  1. Pass-through live traffic when online and server responds.
 *  2. Snapshot successful GET /api/ reads into IndexedDB cached_state.
 *  3. Catch offline mutation failures (POST/PUT/PATCH/DELETE), buffer them
 *     in the emergency_outbox with priority scoring, and return a synthetic
 *     HTTP 202 Accepted response to keep the UI responsive and stable.
 *  4. Automatically drain and synchronize the outbox once network returns.
 */

(function (global) {
  'use strict';

  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch.bind(window);
  let isSyncInProgress = false;

  /**
   * Evaluates priority score for emergency requests.
   * Higher score = dispatched first during sync flush.
   */
  function calculatePriority(url, method, body) {
    const urlStr = String(url).toLowerCase();
    const bodyStr = typeof body === 'string' ? body.toLowerCase() : JSON.stringify(body || {}).toLowerCase();

    // Critical Emergency SOS / Triage / Trapped life threats
    if (
      urlStr.includes('/incidents') ||
      urlStr.includes('/triage') ||
      bodyStr.includes('critical') ||
      bodyStr.includes('trapped') ||
      bodyStr.includes('drowning') ||
      bodyStr.includes('sos')
    ) {
      return 100;
    }

    // Critical Relief Inventory & Medical Supply movements
    if (urlStr.includes('/resources') || urlStr.includes('/movement') || bodyStr.includes('medicine') || bodyStr.includes('water')) {
      return 75;
    }

    // Volunteer dispatch & assignment changes
    if (urlStr.includes('/volunteers') || urlStr.includes('/assign') || urlStr.includes('/status')) {
      return 65;
    }

    // General updates
    return 50;
  }

  /**
   * Synthesizes an optimistic 202 Accepted Response for the caller.
   */
  function createOptimisticResponse(outboxRecord) {
    const rawBody = outboxRecord.body;
    let parsedBody = {};
    if (typeof rawBody === 'string') {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (_e) {
        parsedBody = { raw: rawBody };
      }
    } else if (rawBody && typeof rawBody === 'object') {
      parsedBody = rawBody;
    }

    const pseudoId = `offline_${outboxRecord.id.replace(/-/g, '').slice(0, 24)}`;
    const pseudoRef = `OFFLINE-${Date.now().toString(36).toUpperCase()}`;

    // Synthetic payload modeled after SahyogAI REST conventions
    const optimisticData = {
      success: true,
      offlineQueued: true,
      status: 'saved_locally',
      message: 'Network offline. Request safely secured in local emergency outbox. Will sync automatically upon reconnection.',
      id: pseudoId,
      _id: pseudoId,
      ref: pseudoRef,
      data: {
        _id: pseudoId,
        id: pseudoId,
        ref: pseudoRef,
        ...parsedBody,
        effectiveUrgency: parsedBody.effectiveUrgency || parsedBody.reportedCategory === 'Medical Emergency' ? 'Critical' : 'High',
        status: parsedBody.status || 'submitted',
        createdAt: new Date().toISOString(),
        isOfflineQueued: true,
      },
      triage: {
        source: 'offline-local',
        recommendedUrgency: parsedBody.reportedCategory === 'Medical Emergency' ? 'Critical' : 'High',
        confidence: 'local-presumed',
        processingMs: 0,
      },
    };

    return new Response(JSON.stringify(optimisticData), {
      status: 202,
      statusText: 'Accepted (Offline Queued)',
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-Sahyog-Offline-Queued': 'true',
        'X-Sahyog-Outbox-Id': outboxRecord.id,
      }),
    });
  }

  /**
   * Global fetch monkey-patch interceptor.
   */
  window.fetch = async function (resource, options = {}) {
    const url = typeof resource === 'string' ? resource : resource instanceof Request ? resource.url : String(resource);
    const method = (options.method || (resource instanceof Request ? resource.method : 'GET')).toUpperCase();

    // 1. NON-MUTATING GET REQUESTS:
    if (method === 'GET') {
      try {
        const response = await originalFetch(resource, options);
        // On successful live GET, asynchronously snapshot critical data into IndexedDB
        if (response && response.ok && url.includes('/api/')) {
          const clone = response.clone();
          clone.json().then((json) => {
            if (window.offlineDB && json) {
              const cacheKey = new URL(url, window.location.origin).pathname;
              window.offlineDB.setCachedState(cacheKey, json).catch(() => {});
            }
          }).catch(() => {});
        }
        return response;
      } catch (err) {
        // Fallback: If network is dead, attempt to retrieve from IndexedDB cached_state
        if (window.offlineDB && url.includes('/api/')) {
          const cacheKey = new URL(url, window.location.origin).pathname;
          const cached = await window.offlineDB.getCachedState(cacheKey).catch(() => null);
          if (cached) {
            return new Response(JSON.stringify(cached), {
              status: 200,
              headers: new Headers({
                'Content-Type': 'application/json',
                'X-Sahyog-Offline-State': 'true',
              }),
            });
          }
        }
        throw err;
      }
    }

    // 2. MUTATIONS (POST, PUT, PATCH, DELETE)
    // If device is explicitly offline, immediately queue to outbox
    if (!navigator.onLine) {
      return handleOfflineMutation(url, method, options);
    }

    // Device appears online: attempt live execution
    try {
      const liveResponse = await originalFetch(resource, options);
      return liveResponse;
    } catch (networkError) {
      // Server down, network timeout, connection dropped or DNS failure
      console.warn(`[SyncEngine] Live network request failed (${method} ${url}). Buffering in offline outbox.`, networkError.message);
      return handleOfflineMutation(url, method, options);
    }
  };

  /**
   * Buffers a failed mutation into the emergency_outbox and returns synthetic 202.
   */
  async function handleOfflineMutation(url, method, options) {
    if (!window.offlineDB) {
      throw new Error('Offline database engine is not initialized.');
    }

    // Extract headers safely
    let headersObj = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((val, key) => { headersObj[key] = val; });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([k, v]) => { headersObj[k] = v; });
      } else {
        headersObj = { ...options.headers };
      }
    }

    // Extract body safely
    let body = options.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_e) {
        // keep string
      }
    }

    const priorityScore = calculatePriority(url, method, body);

    const outboxRecord = await window.offlineDB.enqueueOutbox({
      url,
      method,
      headers: headersObj,
      body,
      priorityScore,
      timestamp: Date.now(),
      syncStatus: 'pending',
    });

    return createOptimisticResponse(outboxRecord);
  }

  // ==========================================================================
  // SYNC DRAIN & FLUSH ENGINE
  // ==========================================================================

  /**
   * Drains all pending records in the outbox and replays them to the server.
   */
  async function syncNow() {
    if (isSyncInProgress) return;
    if (!navigator.onLine) {
      console.log('[SyncEngine] Cannot sync: device is currently offline.');
      return;
    }
    if (!window.offlineDB) return;

    isSyncInProgress = true;
    window.dispatchEvent(new CustomEvent('sahyog:sync-started'));

    try {
      const pendingItems = await window.offlineDB.getPendingOutbox();
      if (!pendingItems.length) {
        window.dispatchEvent(new CustomEvent('sahyog:sync-completed', { detail: { count: 0, remaining: 0 } }));
        return;
      }

      console.log(`[SyncEngine] Signal restored. Processing ${pendingItems.length} queued emergency mutations...`);

      for (const item of pendingItems) {
        if (!navigator.onLine) {
          console.warn('[SyncEngine] Signal lost during flush. Pausing sync.');
          break;
        }

        await window.offlineDB.updateOutboxStatus(item.id, 'syncing');

        const headers = { ...item.headers, 'X-Sahyog-Replay-Sync': 'true' };
        // Ensure auth token is up to date if stored in localStorage
        const activeToken = localStorage.getItem('sahyog_token');
        if (activeToken && !headers['Authorization']) {
          headers['Authorization'] = `Bearer ${activeToken}`;
        }

        const fetchOptions = {
          method: item.method,
          headers,
          body: typeof item.body === 'object' && item.body !== null ? JSON.stringify(item.body) : item.body,
        };

        try {
          const replayRes = await originalFetch(item.url, fetchOptions);

          if (replayRes.ok || replayRes.status === 201 || replayRes.status === 202) {
            // Successfully synchronized with backend
            await window.offlineDB.removeOutbox(item.id);
            window.dispatchEvent(new CustomEvent('sahyog:item-synced', {
              detail: { id: item.id, url: item.url, method: item.method }
            }));
            console.log(`[SyncEngine] Successfully synced mutation [${item.id}] -> ${item.url}`);
          } else if (replayRes.status >= 400 && replayRes.status < 500) {
            // Client error: log and mark failed to prevent blocking the remaining queue
            const errText = await replayRes.text().catch(() => '');
            console.error(`[SyncEngine] Sync rejected with HTTP ${replayRes.status} for [${item.id}]:`, errText);
            await window.offlineDB.updateOutboxStatus(item.id, 'failed', `HTTP ${replayRes.status}: ${errText.slice(0, 100)}`);
          } else {
            // 5xx Server error: preserve in pending to retry later
            console.warn(`[SyncEngine] Server responded with ${replayRes.status} for [${item.id}]. Will retry.`);
            await window.offlineDB.updateOutboxStatus(item.id, 'pending', `HTTP ${replayRes.status}`);
          }
        } catch (replayErr) {
          console.warn(`[SyncEngine] Network transport failure during sync [${item.id}]:`, replayErr.message);
          await window.offlineDB.updateOutboxStatus(item.id, 'pending', replayErr.message);
          // If connection dropped, break loop
          break;
        }
      }

      const remaining = await window.offlineDB.getOutboxCount();
      window.dispatchEvent(new CustomEvent('sahyog:sync-completed', {
        detail: { count: pendingItems.length, remaining }
      }));
    } catch (fatalErr) {
      console.error('[SyncEngine] Fatal error during sync cycle:', fatalErr);
    } finally {
      isSyncInProgress = false;
    }
  }

  // --- Network State Event Listeners ---
  window.addEventListener('online', () => {
    console.log('[SyncEngine] Network connection restored. Triggering auto-sync...');
    setTimeout(syncNow, 1200); // Small debounce for connection stabilization
  });

  window.addEventListener('offline', () => {
    console.warn('[SyncEngine] Device switched to offline mode. All mutations will be buffered locally.');
  });

  // Listen for Background Sync triggers from the Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'TRIGGER_BACKGROUND_SYNC') {
        syncNow();
      }
    });
  }

  // Periodic poll check every 30s when online in case events were missed
  setInterval(() => {
    if (navigator.onLine && window.offlineDB) {
      window.offlineDB.getOutboxCount().then((count) => {
        if (count > 0 && !isSyncInProgress) {
          syncNow();
        }
      }).catch(() => {});
    }
  }, 30000);

  // Expose API
  const syncEngine = {
    syncNow,
    isOnline: () => navigator.onLine,
    isSyncing: () => isSyncInProgress,
    getOutboxCount: () => (window.offlineDB ? window.offlineDB.getOutboxCount() : Promise.resolve(0)),
  };

  window.syncEngine = syncEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

