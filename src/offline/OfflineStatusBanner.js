/**
 * SahyogAI Non-Intrusive Offline Status HUD (Heads-Up Display)
 * -------------------------------------------------------------
 * Completely isolated, self-mounting UI component fixed to the bottom-right
 * viewport corner. Utilizes isolated CSS-in-JS styles to guarantee zero
 * pollution of global stylesheets or Tailwind classes.
 *
 * States:
 *  - Online (Queue Empty) : Hidden (or subtle checkmark on completed sync)
 *  - Offline Mode         : High-contrast amber/red warning badge with item counter
 *  - Syncing / Connected  : Active blue/emerald indicator with 'Sync Now' manual trigger
 *  - Inspection Drawer    : Interactive drawer showing queued emergency actions
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const COMPONENT_ID = 'sahyog-offline-hud-root';
  let isDrawerOpen = false;

  /**
   * Generates scoped styles for the HUD.
   */
  function injectStyles() {
    if (document.getElementById('sahyog-offline-hud-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'sahyog-offline-hud-styles';
    styleEl.textContent = `
      #${COMPONENT_ID} {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        user-select: none;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
      }
      #${COMPONENT_ID} * {
        box-sizing: border-box;
      }
      .sahyog-hud-pill {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        border-radius: 9999px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(8px);
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .sahyog-hud-pill:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px -4px rgba(0, 0, 0, 0.35);
      }
      .sahyog-hud-pill.offline {
        background: linear-gradient(135deg, #B91C1C, #991B1B);
        color: #FEF2F2;
        border-color: #EF4444;
        animation: sahyog-pulse 2.2s infinite;
      }
      .sahyog-hud-pill.syncing {
        background: linear-gradient(135deg, #1E40AF, #1E3A8A);
        color: #EFF6FF;
        border-color: #3B82F6;
      }
      .sahyog-hud-pill.reconnecting {
        background: linear-gradient(135deg, #D97706, #B45309);
        color: #FFFBEB;
        border-color: #FBBF24;
      }
      .sahyog-hud-pill.synced-briefly {
        background: linear-gradient(135deg, #065F46, #047857);
        color: #ECFDF5;
        border-color: #10B981;
      }
      .sahyog-hud-btn {
        pointer-events: auto;
        background: rgba(255, 255, 255, 0.2);
        color: inherit;
        border: none;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: background 0.15s ease;
      }
      .sahyog-hud-btn:hover {
        background: rgba(255, 255, 255, 0.35);
      }
      .sahyog-hud-drawer {
        pointer-events: auto;
        width: 320px;
        max-height: 380px;
        background: #0F172A;
        color: #E2E8F0;
        border: 1px solid #334155;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: sahyog-slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .sahyog-drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #1E293B;
        padding-bottom: 8px;
      }
      .sahyog-drawer-list {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 240px;
      }
      .sahyog-drawer-item {
        background: #1E293B;
        border-left: 3px solid #F59E0B;
        padding: 8px 10px;
        border-radius: 4px;
        font-size: 11px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sahyog-drawer-item.critical {
        border-left-color: #EF4444;
      }
      .sahyog-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 50%;
        border-top-color: #FFF;
        animation: sahyog-spin 0.7s linear infinite;
      }
      @keyframes sahyog-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes sahyog-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.02); }
      }
      @keyframes sahyog-slide-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  /**
   * Initializes the DOM elements.
   */
  function mountHUD() {
    if (document.getElementById(COMPONENT_ID)) return;
    injectStyles();

    const root = document.createElement('div');
    root.id = COMPONENT_ID;
    document.body.appendChild(root);

    updateHUD();
  }

  /**
   * Refreshes the HUD status and queues.
   */
  async function updateHUD() {
    const root = document.getElementById(COMPONENT_ID);
    if (!root) return;

    const isOnline = navigator.onLine;
    let outboxItems = [];
    if (window.offlineDB) {
      try {
        outboxItems = await window.offlineDB.getPendingOutbox();
      } catch (_e) {
        outboxItems = [];
      }
    }

    const queueCount = outboxItems.length;
    const isSyncing = window.syncEngine ? window.syncEngine.isSyncing() : false;

    // SCENARIO 1: Online and queue is completely empty -> Hide HUD
    if (isOnline && queueCount === 0 && !isSyncing) {
      if (root.dataset.wasVisible === 'true') {
        // Show brief success badge
        root.innerHTML = `
          <div class="sahyog-hud-pill synced-briefly">
            <span>✓</span>
            <span>All Emergency Updates Synced</span>
          </div>
        `;
        setTimeout(() => {
          root.innerHTML = '';
          root.dataset.wasVisible = 'false';
          isDrawerOpen = false;
        }, 3200);
      } else {
        root.innerHTML = '';
      }
      return;
    }

    root.dataset.wasVisible = 'true';

    // SCENARIO 2: Actively Syncing
    if (isSyncing) {
      root.innerHTML = `
        <div class="sahyog-hud-pill syncing" id="sahyog-hud-pill-toggle">
          <span class="sahyog-spinner"></span>
          <span>Syncing ${queueCount} queued ${queueCount === 1 ? 'request' : 'requests'}...</span>
        </div>
      `;
      return;
    }

    // SCENARIO 3: Offline Mode
    if (!isOnline) {
      root.innerHTML = `
        ${isDrawerOpen ? renderDrawer(outboxItems) : ''}
        <div class="sahyog-hud-pill offline" id="sahyog-hud-pill-toggle" title="Click to inspect offline outbox queue">
          <span style="font-size: 14px;">⚡</span>
          <span>Offline Mode — Changes Saved Locally (${queueCount} queued)</span>
        </div>
      `;
      attachListeners(root);
      return;
    }

    // SCENARIO 4: Online with pending queued items (Reconnecting / Awaiting Sync)
    root.innerHTML = `
      ${isDrawerOpen ? renderDrawer(outboxItems) : ''}
      <div class="sahyog-hud-pill reconnecting" id="sahyog-hud-pill-toggle" title="Signal restored. Click to inspect or sync.">
        <span>🔄</span>
        <span>Signal Restored — ${queueCount} queued ${queueCount === 1 ? 'item' : 'items'}</span>
        <button class="sahyog-hud-btn" id="sahyog-hud-sync-btn">Sync Now</button>
      </div>
    `;
    attachListeners(root);
  }

  function renderDrawer(items) {
    if (!items.length) {
      return `
        <div class="sahyog-hud-drawer">
          <div class="sahyog-drawer-header">
            <strong>Emergency Outbox</strong>
            <button class="sahyog-hud-btn" id="sahyog-drawer-close">✕</button>
          </div>
          <div style="text-align: center; color: #94A3B8; padding: 20px 0;">No pending mutations.</div>
        </div>
      `;
    }

    const itemsHtml = items.map((item, idx) => {
      const isCritical = item.priorityScore >= 75;
      const dateStr = new Date(item.timestamp).toLocaleTimeString();
      let summary = item.url.replace(/^.*\/api\//, '/api/');
      if (item.body && typeof item.body === 'object' && item.body.locationDescription) {
        summary += ` • ${item.body.locationDescription.slice(0, 24)}...`;
      }
      return `
        <div class="sahyog-drawer-item ${isCritical ? 'critical' : ''}">
          <div style="display: flex; justify-content: space-between; font-weight: 600;">
            <span style="color: ${isCritical ? '#F87171' : '#FBBF24'};">${item.method} ${summary}</span>
            <span style="color: #94A3B8;">${dateStr}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94A3B8;">
            <span>Priority: ${item.priorityScore}</span>
            <span style="text-transform: capitalize; color: ${item.syncStatus === 'failed' ? '#F87171' : '#CBD5E1'};">${item.syncStatus}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="sahyog-hud-drawer">
        <div class="sahyog-drawer-header">
          <strong>Offline Queue (${items.length})</strong>
          <div style="display: flex; gap: 6px;">
            ${navigator.onLine ? '<button class="sahyog-hud-btn" id="sahyog-drawer-sync">Sync All</button>' : ''}
            <button class="sahyog-hud-btn" id="sahyog-drawer-close">✕</button>
          </div>
        </div>
        <div class="sahyog-drawer-list">
          ${itemsHtml}
        </div>
      </div>
    `;
  }

  function attachListeners(root) {
    const pill = root.querySelector('#sahyog-hud-pill-toggle');
    if (pill) {
      pill.addEventListener('click', (e) => {
        if (e.target.id === 'sahyog-hud-sync-btn') return;
        isDrawerOpen = !isDrawerOpen;
        updateHUD();
      });
    }

    const syncBtn = root.querySelector('#sahyog-hud-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.syncEngine) window.syncEngine.syncNow();
      });
    }

    const drawerSync = root.querySelector('#sahyog-drawer-sync');
    if (drawerSync) {
      drawerSync.addEventListener('click', () => {
        if (window.syncEngine) window.syncEngine.syncNow();
      });
    }

    const drawerClose = root.querySelector('#sahyog-drawer-close');
    if (drawerClose) {
      drawerClose.addEventListener('click', () => {
        isDrawerOpen = false;
        updateHUD();
      });
    }
  }

  // --- Event Subscriptions ---
  window.addEventListener('online', updateHUD);
  window.addEventListener('offline', updateHUD);
  window.addEventListener('sahyog:outbox-updated', updateHUD);
  window.addEventListener('sahyog:sync-started', updateHUD);
  window.addEventListener('sahyog:sync-completed', updateHUD);
  window.addEventListener('sahyog:item-synced', updateHUD);

  // Auto-mount on script load or DOM readiness
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHUD);
  } else {
    mountHUD();
  }

  window.offlineHUD = {
    update: updateHUD,
    toggleDrawer: () => {
      isDrawerOpen = !isDrawerOpen;
      updateHUD();
    },
  };
})();
