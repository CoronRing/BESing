// ==UserScript==
// @name         Rest Reminder
// @namespace    https://github.com/CoronRing/BESing
// @version      1.1.0
// @description  Repeating rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**
   * Shared reminder state. Inside BESing it lives in the manager's cross-site storage, so every tab
   * and site follows one timer; standalone it falls back to localStorage, which is per site.
   * @typedef {{ due: number, intervalMinutes: number, off: boolean }} RestReminderState
   */

  const RestReminder = {
    id: 'rest-reminder',
    name: 'Rest Reminder',
    version: '1.1.0',
    description: 'Repeating eye & body rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.',
    category: 'Productivity',
    SHARED_KEY: 'rest_reminder',
    LOCAL_KEY: 'besing_rest_reminder_state',
    SYNC_INTERVAL_MS: 5000,
    MAX_TIMEOUT_MS: 2147483647,
    _config: null,
    _active: false,
    _state: null,
    _timer: null,
    _syncInterval: null,
    _syncing: false,
    _chatBoxEl: null,
    _preview: false,
    _boundReposition: null,
    _boundWake: null,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._active = true;

      // Background tabs throttle timers, and other tabs may press Repeat or Off, so the state is
      // re-read on a slow poll while visible and immediately whenever the page comes back.
      this._boundWake = () => {
        if (document.visibilityState !== 'hidden') this._sync();
      };
      document.addEventListener('visibilitychange', this._boundWake);
      window.addEventListener('pageshow', this._boundWake);
      window.addEventListener('focus', this._boundWake);
      this._syncInterval = setInterval(() => {
        if (document.visibilityState !== 'hidden') this._sync();
      }, this.SYNC_INTERVAL_MS);

      this._sync(true);
    },

    onConfigChange(newConfig) {
      const prevInterval = this._getIntervalMinutes();
      this._config = newConfig || {};
      if (this._active && prevInterval !== this._getIntervalMinutes()) {
        this._startCycle();
      }
    },

    destroy() {
      this._active = false;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (this._syncInterval) {
        clearInterval(this._syncInterval);
        this._syncInterval = null;
      }
      if (this._boundWake) {
        document.removeEventListener('visibilitychange', this._boundWake);
        window.removeEventListener('pageshow', this._boundWake);
        window.removeEventListener('focus', this._boundWake);
        this._boundWake = null;
      }
      this.dismissChatBox();
    },

    _getIntervalMinutes() {
      const cfg = this._config || {};
      const val = Number(cfg.intervalMinutes);
      if (!isNaN(val) && val >= 1 && val <= 240) {
        return val;
      }
      return 20; // Default 20 minutes
    },

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    /** @returns {Promise<RestReminderState | null>} */
    async _readState() {
      const appMgr = this._manager();
      if (appMgr && typeof appMgr.readSharedState === 'function') {
        try {
          return await appMgr.readSharedState(this.SHARED_KEY, null);
        } catch (e) {}
      }
      try {
        const raw = window.localStorage.getItem(this.LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /** @param {RestReminderState} state */
    async _writeState(state) {
      const appMgr = this._manager();
      if (appMgr && typeof appMgr.writeSharedState === 'function') {
        try {
          await appMgr.writeSharedState(this.SHARED_KEY, state);
          return;
        } catch (e) {}
      }
      try {
        window.localStorage.setItem(this.LOCAL_KEY, JSON.stringify(state));
      } catch (e) {}
    },

    _isValidState(state) {
      return !!state && typeof state === 'object' && Number.isFinite(Number(state.due)) && Number(state.due) > 0;
    },

    // Reads the shared state and brings this page in line with it.
    // On init, a missing or "off" state starts a fresh cycle: the script only runs when enabled,
    // so being initialized after Off means the user switched it back on.
    async _sync(isInit = false) {
      if (this._syncing) return;
      this._syncing = true;
      try {
        const state = await this._readState();
        if (!this._active) return;
        if (state && state.off && !isInit) {
          this._goDormant();
          return;
        }
        if (!this._isValidState(state) || state.off) {
          await this._startCycle();
          return;
        }
        this._apply(state);
      } finally {
        this._syncing = false;
      }
    },

    /** @returns {Promise<RestReminderState>} */
    async _startCycle() {
      const minutes = this._getIntervalMinutes();
      const state = { due: Date.now() + minutes * 60 * 1000, intervalMinutes: minutes, off: false };
      await this._writeState(state);
      if (this._active) this._apply(state);
      return state;
    },

    /** @param {RestReminderState} state */
    _apply(state) {
      this._state = state;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      const remaining = Number(state.due) - Date.now();
      if (remaining <= 0) {
        this._ensureChatBox();
        return;
      }
      if (this._chatBoxEl && !this._preview) {
        // Another tab pressed Repeat.
        this.dismissChatBox();
      }
      this._timer = setTimeout(() => this._sync(), Math.min(this.MAX_TIMEOUT_MS, Math.max(250, remaining)));
    },

    // Another tab pressed Off: stop here too, without touching storage.
    _goDormant() {
      this._state = null;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (!this._preview) this.dismissChatBox();
    },

    // Keeps the bubble on screen while the reminder is due, rebuilding it if the page or the
    // BESing layer removed it.
    _ensureChatBox() {
      const appMgr = this._manager();
      const box = this._chatBoxEl;
      const layer = appMgr && appMgr.shadow;
      if (box && box.isConnected && (!layer || box.getRootNode() === layer)) {
        this._preview = false;
        if (appMgr && appMgr.widgetEl) appMgr.widgetEl.classList.add('besing-pulse-alert');
        this._repositionChatBox();
        return;
      }
      if (box) this.dismissChatBox();
      this.showReminderChatBox();
    },

    /** @param {{ preview?: boolean }} [options] preview shows the bubble without a due reminder. */
    showReminderChatBox(options = {}) {
      if (this._chatBoxEl && this._chatBoxEl.isConnected) return; // Already visible
      if (this._chatBoxEl) this.dismissChatBox();
      this._preview = !!options.preview;

      const appMgr = this._manager();

      if (appMgr && typeof appMgr.ensureMounted === 'function') {
        appMgr.ensureMounted();
        if (appMgr.widgetEl) {
          // Un-dock if folded so user sees the full pet icon and speech bubble
          appMgr.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        }
      }

      const interval = this._getIntervalMinutes();
      const activeMinutes = (this._state && Number(this._state.intervalMinutes)) || interval;

      // 1. Create chat box element
      const box = document.createElement('div');
      box.className = 'besing-rest-chat-box';
      box.id = 'besing-rest-chat-box';

      const html = `
        <div class="besing-rest-arrow" id="besing-rest-arrow"></div>
        <div class="besing-rest-header">
          <span class="besing-rest-avatar">🐾</span>
          <span class="besing-rest-title">Time to Rest!</span>
          <span class="besing-rest-badge">${activeMinutes}m</span>
        </div>
        <div class="besing-rest-msg">
          You've been active for <strong>${activeMinutes} minute${activeMinutes === 1 ? '' : 's'}</strong>! Look away from the screen, blink, and stretch.
        </div>
        <div class="besing-rest-actions">
          <button type="button" class="besing-rest-btn-repeat" id="besing-rest-btn-repeat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            <span>Repeat (${interval}m)</span>
          </button>
          <button type="button" class="besing-rest-btn-off" id="besing-rest-btn-off">
            Off
          </button>
        </div>
      `;
      // The manager's parser works on Trusted Types sites, where innerHTML throws.
      if (appMgr && typeof appMgr.setSafeHTML === 'function') {
        appMgr.setSafeHTML(box, html);
      } else {
        box.innerHTML = html;
      }

      // 2. Insert into shadow DOM if available, otherwise document.body
      const targetContainer = (appMgr && appMgr.shadow) ? appMgr.shadow : (document.body || document.documentElement);
      targetContainer.appendChild(box);
      this._chatBoxEl = box;

      this._repositionChatBox();

      // 3. Highlight pet icon with alert pulse while chat box is open
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.add('besing-pulse-alert');
      }

      // 4. Bind Repeat button (Primary action): starts the next cycle for every tab and site
      const btnRepeat = box.querySelector('#besing-rest-btn-repeat');
      if (btnRepeat) {
        btnRepeat.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._startCycle();
        };
      }

      // 5. Bind Off button
      const btnOff = box.querySelector('#besing-rest-btn-off');
      if (btnOff) {
        btnOff.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._disableReminder();
        };
      }

      // 6. Track resize & reposition
      this._boundReposition = () => this._repositionChatBox();
      window.addEventListener('resize', this._boundReposition);
      window.addEventListener('scroll', this._boundReposition, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this._boundReposition);
        window.visualViewport.addEventListener('scroll', this._boundReposition);
      }
    },

    dismissChatBox() {
      if (this._chatBoxEl) {
        if (this._chatBoxEl.parentNode) {
          this._chatBoxEl.parentNode.removeChild(this._chatBoxEl);
        }
        this._chatBoxEl = null;
      }
      this._preview = false;
      if (this._boundReposition) {
        window.removeEventListener('resize', this._boundReposition);
        window.removeEventListener('scroll', this._boundReposition);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', this._boundReposition);
          window.visualViewport.removeEventListener('scroll', this._boundReposition);
        }
        this._boundReposition = null;
      }
      const appMgr = this._manager();
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.remove('besing-pulse-alert');
      }
    },

    _repositionChatBox() {
      if (!this._chatBoxEl) return;
      const appMgr = this._manager();
      const widget = appMgr && appMgr.widgetEl;
      const box = this._chatBoxEl;
      const arrow = box.querySelector('#besing-rest-arrow');

      // Inside the BESing layer, positions use the manager's zoom-independent coordinates.
      const inManagerLayer = !!(appMgr && appMgr.shadow && box.getRootNode() === appMgr.shadow && typeof appMgr.getViewportMetrics === 'function');
      const metrics = inManagerLayer ? appMgr.getViewportMetrics() : null;
      const vpW = metrics ? metrics.width : (window.visualViewport?.width || window.innerWidth || 800);
      const vpH = metrics ? metrics.height : (window.visualViewport?.height || window.innerHeight || 600);
      const boxW = Math.min(270, vpW - 24);

      let targetX = vpW - boxW - 20;
      let targetY = vpH - 180;
      let isAbove = true;

      if (widget) {
        const rect = inManagerLayer ? appMgr.getLocalRect(widget) : widget.getBoundingClientRect();
        const widgetCenterX = rect.left + rect.width / 2;

        targetX = Math.max(12, Math.min(vpW - boxW - 12, widgetCenterX - boxW / 2));

        if (rect.top > 160) {
          targetY = rect.top - 145;
          isAbove = true;
        } else {
          targetY = rect.bottom + 12;
          isAbove = false;
        }

        if (arrow) {
          arrow.className = isAbove ? 'besing-rest-arrow arrow-bottom' : 'besing-rest-arrow arrow-top';
          const arrowLeft = Math.max(16, Math.min(boxW - 28, widgetCenterX - targetX - 6));
          arrow.style.left = `${arrowLeft}px`;
        }
      }

      box.style.left = `${Math.round(targetX)}px`;
      box.style.top = `${Math.round(targetY)}px`;
      box.style.width = `${Math.round(boxW)}px`;
    },

    // Off applies everywhere: the shared state tells open tabs to stop, and the script is switched
    // off globally, including any per-site "on" rules, so new pages do not start it again.
    async _disableReminder() {
      this.destroy();
      await this._writeState({ due: 0, intervalMinutes: this._getIntervalMinutes(), off: true });
      const appMgr = this._manager();
      if (appMgr && appMgr.storage && typeof appMgr.storage.setScriptMode === 'function') {
        const storage = appMgr.storage;
        await storage.setScriptMode(this.id, 'off', storage.getCurrentHost());
        if (typeof storage.getScriptSiteOverrides === 'function' && typeof storage.removeSiteOverride === 'function') {
          for (const rule of storage.getScriptSiteOverrides(this.id)) {
            if (rule.enabled) await storage.removeSiteOverride(this.id, rule.host);
          }
        }
        if (typeof appMgr.refreshCurrentSiteModules === 'function') {
          appMgr.refreshCurrentSiteModules();
        }
        if (typeof appMgr.renderBody === 'function') {
          appMgr.renderBody();
        }
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.RestReminder = RestReminder;
  }
})();
