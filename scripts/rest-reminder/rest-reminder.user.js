// ==UserScript==
// @name         Rest Reminder
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.1
// @description  Repeating rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const RestReminder = {
    id: 'rest-reminder',
    name: 'Rest Reminder',
    version: '1.0.1',
    description: 'Repeating eye & body rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.',
    category: 'Productivity',
    _config: null,
    _timer: null,
    _checkInterval: null,
    _chatBoxEl: null,
    _targetAlarmTime: 0,
    _boundReposition: null,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._scheduleNextReminder();
      this._startPeriodicChecker();
    },

    onConfigChange(newConfig) {
      const prevInterval = this._getIntervalMinutes();
      this._config = newConfig || {};
      const newInterval = this._getIntervalMinutes();
      if (prevInterval !== newInterval) {
        this._scheduleNextReminder(true);
      }
    },

    destroy() {
      this._clearTimers();
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

    _scheduleNextReminder(forceNewCycle = false) {
      this._clearTimers();
      const intervalMinutes = this._getIntervalMinutes();
      const intervalMs = intervalMinutes * 60 * 1000;
      const now = Date.now();

      let targetTime = 0;
      if (!forceNewCycle) {
        try {
          const stored = window.localStorage.getItem('besing_rest_reminder_alarm');
          if (stored) targetTime = Number(stored);
        } catch (e) {}
      }

      // If targetTime is empty, invalid, or expired beyond 2 hours, compute fresh target
      if (!targetTime || isNaN(targetTime) || targetTime < now - (2 * 60 * 60 * 1000)) {
        targetTime = now + intervalMs;
        try {
          window.localStorage.setItem('besing_rest_reminder_alarm', String(targetTime));
        } catch (e) {}
      }

      this._targetAlarmTime = targetTime;

      if (now >= targetTime) {
        // Alarm already due! Show chat box right away
        this.showReminderChatBox();
      } else {
        const delay = Math.max(500, targetTime - now);
        this._timer = setTimeout(() => {
          this.showReminderChatBox();
        }, delay);
      }
    },

    _startPeriodicChecker() {
      if (this._checkInterval) clearInterval(this._checkInterval);
      // Periodically verify in case tab was backgrounded or clock shifted
      this._checkInterval = setInterval(() => {
        if (!this._chatBoxEl && this._targetAlarmTime && Date.now() >= this._targetAlarmTime) {
          this.showReminderChatBox();
        }
      }, 15000);
    },

    _clearTimers() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (this._checkInterval) {
        clearInterval(this._checkInterval);
        this._checkInterval = null;
      }
    },

    showReminderChatBox() {
      if (this._chatBoxEl) return; // Already visible

      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);

      if (appMgr && typeof appMgr.ensureMounted === 'function') {
        appMgr.ensureMounted();
        if (appMgr.widgetEl) {
          // Un-dock if folded so user sees the full pet icon and speech bubble
          appMgr.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        }
      }

      const interval = this._getIntervalMinutes();

      // 1. Create chat box element
      const box = document.createElement('div');
      box.className = 'besing-rest-chat-box';
      box.id = 'besing-rest-chat-box';

      box.innerHTML = `
        <div class="besing-rest-arrow" id="besing-rest-arrow"></div>
        <div class="besing-rest-header">
          <span class="besing-rest-avatar">🐾</span>
          <span class="besing-rest-title">Time to Rest!</span>
          <span class="besing-rest-badge">${interval}m</span>
        </div>
        <div class="besing-rest-msg">
          You've been active for <strong>${interval} minutes</strong>! Look away from the screen, blink, and stretch.
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

      // 2. Insert into shadow DOM if available, otherwise document.body
      const targetContainer = (appMgr && appMgr.shadow) ? appMgr.shadow : (document.body || document.documentElement);
      targetContainer.appendChild(box);
      this._chatBoxEl = box;

      this._repositionChatBox();

      // 3. Highlight pet icon with alert pulse while chat box is open
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.add('besing-pulse-alert');
      }

      // 4. Bind Repeat button (Primary action)
      const btnRepeat = box.querySelector('#besing-rest-btn-repeat');
      if (btnRepeat) {
        btnRepeat.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._scheduleNextReminder(true); // force new cycle
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
      if (this._boundReposition) {
        window.removeEventListener('resize', this._boundReposition);
        window.removeEventListener('scroll', this._boundReposition);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', this._boundReposition);
          window.visualViewport.removeEventListener('scroll', this._boundReposition);
        }
        this._boundReposition = null;
      }
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.remove('besing-pulse-alert');
      }
    },

    _repositionChatBox() {
      if (!this._chatBoxEl) return;
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
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

    _disableReminder() {
      this.destroy();
      try {
        window.localStorage.removeItem('besing_rest_reminder_alarm');
      } catch (e) {}
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (appMgr && appMgr.storage && typeof appMgr.storage.setScriptMode === 'function') {
        const host = appMgr.storage.getCurrentHost();
        appMgr.storage.setScriptMode(this.id, 'off', host);
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
