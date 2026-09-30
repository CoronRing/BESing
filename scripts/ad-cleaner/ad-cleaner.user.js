// ==UserScript==
// @name         Ad Cleaner Lite & Element Zapper
// @namespace    https://github.com/CoronRing/BESing
// @version      1.3.0
// @description  Hides intrusive floating overlays, cookie popups, and provides an interactive point-and-click / touch-and-zap Element Zapper.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const AdCleaner = {
    id: 'ad-cleaner',
    name: 'Ad Cleaner & Element Zapper',
    version: '1.3.0',
    description: 'Hides intrusive overlays, cookie popups, and provides an interactive point-and-click / mobile touch Element Zapper to block any element permanently.',
    category: 'Privacy',
    _styleEl: null,
    _config: null,
    _zapperActive: false,
    _zapperHud: null,
    _highlightEl: null,
    _currentHoveredTarget: null,
    _mouseMoveHandler: null,
    _touchStartHandler: null,
    _touchMoveHandler: null,
    _touchEndHandler: null,
    _clickHandler: null,
    _auxHandler: null,
    _keyDownHandler: null,
    _contextHandler: null,
    _shortcutAttached: false,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._applyStyles();
      this._setupGlobalShortcut();
    },

    onConfigChange(newConfig) {
      this._config = newConfig || {};
      this._applyStyles();
    },

    _applyStyles() {
      if (!this._styleEl) {
        const s = document.createElement('style');
        s.id = 'besing-ad-cleaner-style';
        (document.head || document.documentElement).appendChild(s);
        this._styleEl = s;
      }

      const rules = [];
      const autoClean = this._config.enableAutoClean !== false;
      if (autoClean) {
        rules.push(`
          [class*="cookie-banner"]:not(#__besing_root__ *), [id*="cookie-banner"]:not(#__besing_root__ *),
          [class*="consent-banner"]:not(#__besing_root__ *), [id*="consent-banner"]:not(#__besing_root__ *),
          [class*="popup-overlay"]:not(#__besing_root__ *),
          [class*="newsletter-popup"]:not(#__besing_root__ *), [id*="newsletter-modal"]:not(#__besing_root__ *),
          .ad-banner:not(#__besing_root__ *), .ads-placement:not(#__besing_root__ *)
        `);
      }

      const blocked = this._config.blockedSelectors || [];
      if (Array.isArray(blocked) && blocked.length > 0) {
        rules.push(blocked.join(',\n'));
      }

      if (rules.length > 0) {
        this._styleEl.textContent = `
          ${rules.join(',\n')} {
            display: none !important;
            visibility: hidden !important;
          }
        `;
      } else {
        this._styleEl.textContent = '';
      }
    },

    _setupGlobalShortcut() {
      if (this._shortcutAttached) return;
      this._shortcutAttached = true;
      window.addEventListener('keydown', (e) => {
        // Alt + Z toggles Element Zapper
        if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          if (this._zapperActive) {
            this.stopZapper();
          } else {
            this.startZapper();
          }
        }
      });
    },

    computeSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return '';
      if (el.id && !el.id.includes('__besing') && !/^\d/.test(el.id)) {
        return `#${CSS.escape(el.id)}`;
      }
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).filter(c => !c.startsWith('besing-') && !c.includes(':'));
      if (classes.length > 0) {
        const clsSelector = classes.slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
        if (document.querySelectorAll(clsSelector).length <= 4) {
          return `${tag}${clsSelector}`;
        }
      }
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        const parentSel = (parent.id && !parent.id.includes('__besing') && !/^\d/.test(parent.id)) ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
        const index = Array.from(parent.children).indexOf(el) + 1;
        return `${parentSel} > ${tag}:nth-child(${index})`;
      }
      return tag;
    },

    _updateHighlightBox(el) {
      if (!this._highlightEl || !el) return;
      const rect = el.getBoundingClientRect();
      this._highlightEl.style.display = 'block';
      this._highlightEl.style.left = `${rect.left}px`;
      this._highlightEl.style.top = `${rect.top}px`;
      this._highlightEl.style.width = `${rect.width}px`;
      this._highlightEl.style.height = `${rect.height}px`;

      const sel = this.computeSelector(el);
      const tagBadge = this._highlightEl.querySelector('#besing-zapper-tag-badge');
      if (tagBadge) {
        tagBadge.textContent = `${sel} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
      }
    },

    _zapElement(target, onZappedCallback) {
      if (!target) return;
      const sel = this.computeSelector(target);
      if (!sel) return;

      // Immediate shrink & fade animation
      target.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      target.style.opacity = '0';
      target.style.transform = 'scale(0.88)';
      setTimeout(() => {
        target.style.display = 'none';
      }, 220);

      this._config = this._config || {};
      const currentList = this._config.blockedSelectors || [];
      if (!currentList.includes(sel)) {
        currentList.push(sel);
        this._config.blockedSelectors = currentList;
        this._applyStyles();
        if (typeof onZappedCallback === 'function') {
          onZappedCallback(sel, currentList);
        }
        const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                       (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
        if (appMgr && typeof appMgr.applyScriptConfig === 'function') {
          appMgr.applyScriptConfig(this.id, { blockedSelectors: currentList });
        }
      }

      const statusEl = this._zapperHud ? this._zapperHud.querySelector('#besing-zapper-status') : null;
      if (statusEl) {
        statusEl.textContent = `✅ Zapped: ${sel}`;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
      }
    },

    startZapper(onZappedCallback) {
      if (this._zapperActive) return;
      this._zapperActive = true;
      if (typeof window !== 'undefined') window.__BESING_ZAPPER_ACTIVE__ = true;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = true; } catch (e) {}
      }

      // Close manager modal if open
      const mgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                  (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (mgr && typeof mgr.closeModal === 'function') {
        mgr.closeModal();
      }

      // 1. Create Floating Top HUD with responsive mobile layout
      const hud = document.createElement('div');
      hud.id = 'besing-zapper-hud';
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <span style="background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:0.5px;flex-shrink:0;">⚡ ZAPPER</span>
          <span style="font-size:11px;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Tap or click any ad to Zap</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span id="besing-zapper-status" style="font-size:10px;color:#4ade80;font-weight:700;font-family:monospace;"></span>
          <button type="button" id="besing-zapper-exit-btn" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;">✕ Exit</button>
        </div>
      `;
      hud.setAttribute('style', 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:calc(100vw - 24px);max-width:480px;box-sizing:border-box;background:rgba(15,23,42,0.95);border:1.5px solid rgba(239,68,68,0.7);border-radius:12px;padding:8px 14px;z-index:2147483647;box-shadow:0 10px 30px rgba(0,0,0,0.7),0 0 20px rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:space-between;gap:8px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:auto;');
      (document.body || document.documentElement).appendChild(hud);
      this._zapperHud = hud;

      const exitBtn = hud.querySelector('#besing-zapper-exit-btn');
      if (exitBtn) {
        const doExit = (e) => {
          if (e) {
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (e.preventDefault) e.preventDefault();
          }
          this.stopZapper();
        };
        exitBtn.onclick = doExit;
        exitBtn.ontouchend = doExit;
        exitBtn.onpointerup = doExit;
      }

      // 2. Create Target Highlight Box
      const box = document.createElement('div');
      box.id = 'besing-zapper-highlight';
      box.setAttribute('style', 'position:fixed;pointer-events:none;border:2.5px solid #ef4444;background:rgba(239,68,68,0.22);z-index:2147483646;display:none;transition:top 0.05s ease, left 0.05s ease, width 0.05s ease, height 0.05s ease;border-radius:4px;box-shadow:0 0 16px rgba(239,68,68,0.6);');
      
      const tagBadge = document.createElement('div');
      tagBadge.id = 'besing-zapper-tag-badge';
      tagBadge.setAttribute('style', 'position:absolute;top:-24px;left:0;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:monospace;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.4);max-width:90vw;overflow:hidden;text-overflow:ellipsis;');
      box.appendChild(tagBadge);

      (document.body || document.documentElement).appendChild(box);
      this._highlightEl = box;

      document.body.style.cursor = 'crosshair';

      const isZapperUI = (el, e) => {
        if (e && e.composedPath && typeof e.composedPath === 'function') {
          const path = e.composedPath();
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            if (!node) continue;
            if (node.id === 'besing-zapper-hud' || node.id === 'besing-zapper-highlight' || node.id === '__besing_root__') return true;
            if (node.tagName && node.tagName.toLowerCase() === 'besing-host') return true;
          }
        }
        if (!el || !el.closest) return false;
        return !!(el.closest('#besing-zapper-hud') || el.closest('#besing-zapper-highlight') || el.closest('#__besing_root__') || el.closest('besing-host'));
      };

      const getPoint = (e) => {
        if (e.touches && e.touches.length > 0) return e.touches[0];
        if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
        return e;
      };

      // 3. Desktop Mouse Move
      this._mouseMoveHandler = (e) => {
        if (!this._zapperActive) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || isZapperUI(el)) {
          box.style.display = 'none';
          this._currentHoveredTarget = null;
          return;
        }
        this._currentHoveredTarget = el;
        this._updateHighlightBox(el);
      };

      // 4. Mobile Touch Start: Quarantine event, prevent ad redirect, highlight element
      this._touchStartHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        if (el && !isZapperUI(el, e)) {
          this._currentHoveredTarget = el;
          this._updateHighlightBox(el);
        }
      };

      // 5. Mobile Touch Move: Follow finger
      this._touchMoveHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        if (el && !isZapperUI(el, e)) {
          this._currentHoveredTarget = el;
          this._updateHighlightBox(el);
        }
      };

      // 6. Mobile Touch End: Zap target immediately on release
      this._touchEndHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        let target = this._currentHoveredTarget;
        if (!target && pt) {
          const el = document.elementFromPoint(pt.clientX, pt.clientY);
          if (el && !isZapperUI(el, e)) {
            target = el;
          }
        }

        if (target) {
          this._zapElement(target, onZappedCallback);
          this._currentHoveredTarget = null;
          if (this._highlightEl) this._highlightEl.style.display = 'none';
        }
      };

      // 7. Click Handler: Desktop click zap & synthetic click isolation
      this._clickHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const target = this._currentHoveredTarget || document.elementFromPoint(e.clientX, e.clientY);
        if (target && !isZapperUI(target, e)) {
          this._zapElement(target, onZappedCallback);
          this._currentHoveredTarget = null;
          if (this._highlightEl) this._highlightEl.style.display = 'none';
        }
      };

      this._auxHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      this._keyDownHandler = (e) => {
        if (e.key === 'Escape') {
          this.stopZapper();
        }
      };

      this._contextHandler = (e) => {
        if (this._zapperActive) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.stopZapper();
        }
      };

      // Bind all input streams in capture phase to completely isolate page from ad redirects
      window.addEventListener('touchstart', this._touchStartHandler, { capture: true, passive: false });
      window.addEventListener('touchmove', this._touchMoveHandler, { capture: true, passive: false });
      window.addEventListener('touchend', this._touchEndHandler, { capture: true, passive: false });
      window.addEventListener('pointerdown', this._touchStartHandler, { capture: true });
      window.addEventListener('pointermove', this._touchMoveHandler, { capture: true });
      window.addEventListener('pointerup', this._touchEndHandler, { capture: true });
      window.addEventListener('mousemove', this._mouseMoveHandler, { capture: true, passive: true });
      window.addEventListener('click', this._clickHandler, { capture: true });
      window.addEventListener('auxclick', this._auxHandler, { capture: true });
      window.addEventListener('contextmenu', this._contextHandler, { capture: true });
      window.addEventListener('keydown', this._keyDownHandler);
    },

    stopZapper() {
      this._zapperActive = false;
      if (typeof window !== 'undefined') window.__BESING_ZAPPER_ACTIVE__ = false;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = false; } catch (e) {}
      }
      document.body.style.cursor = '';
      if (this._zapperHud) {
        this._zapperHud.remove();
        this._zapperHud = null;
      }
      if (this._highlightEl) {
        this._highlightEl.remove();
        this._highlightEl = null;
      }
      if (this._touchStartHandler) {
        window.removeEventListener('touchstart', this._touchStartHandler, { capture: true, passive: false });
        window.removeEventListener('pointerdown', this._touchStartHandler, { capture: true });
        this._touchStartHandler = null;
      }
      if (this._touchMoveHandler) {
        window.removeEventListener('touchmove', this._touchMoveHandler, { capture: true, passive: false });
        window.removeEventListener('pointermove', this._touchMoveHandler, { capture: true });
        this._touchMoveHandler = null;
      }
      if (this._touchEndHandler) {
        window.removeEventListener('touchend', this._touchEndHandler, { capture: true, passive: false });
        window.removeEventListener('pointerup', this._touchEndHandler, { capture: true });
        this._touchEndHandler = null;
      }
      if (this._mouseMoveHandler) {
        window.removeEventListener('mousemove', this._mouseMoveHandler, { capture: true, passive: true });
        this._mouseMoveHandler = null;
      }
      if (this._clickHandler) {
        window.removeEventListener('click', this._clickHandler, { capture: true });
        this._clickHandler = null;
      }
      if (this._auxHandler) {
        window.removeEventListener('auxclick', this._auxHandler, { capture: true });
        this._auxHandler = null;
      }
      if (this._keyDownHandler) {
        window.removeEventListener('keydown', this._keyDownHandler);
        this._keyDownHandler = null;
      }
      if (this._contextHandler) {
        window.removeEventListener('contextmenu', this._contextHandler, { capture: true });
        this._contextHandler = null;
      }
    },

    destroy() {
      this.stopZapper();
      if (this._styleEl) {
        this._styleEl.remove();
        this._styleEl = null;
      }
      const el = document.getElementById('besing-ad-cleaner-style');
      if (el) el.remove();
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['ad-cleaner'] = AdCleaner;
    if (!window.__BESING_EMBEDDED__) {
      AdCleaner.init();
    }
  }
})();
