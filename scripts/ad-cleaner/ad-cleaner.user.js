// ==UserScript==
// @name         Ad Cleaner Lite & Element Zapper
// @namespace    https://github.com/CoronRing/BESing
// @version      1.2.0
// @description  Hides intrusive floating overlays, cookie popups, and provides an interactive point-and-click Element Zapper.
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
    version: '1.2.0',
    description: 'Hides intrusive overlays, cookie popups, and provides an interactive point-and-click Element Zapper to block any element permanently.',
    category: 'Privacy',
    _styleEl: null,
    _config: null,
    _zapperActive: false,
    _zapperHud: null,
    _highlightEl: null,
    _currentHoveredTarget: null,
    _mouseMoveHandler: null,
    _clickHandler: null,
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

    startZapper(onZappedCallback) {
      if (this._zapperActive) return;
      this._zapperActive = true;

      // Close manager modal if open
      const mgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                  (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (mgr && typeof mgr.closeModal === 'function') {
        mgr.closeModal();
      }

      // 1. Create Floating Top HUD
      const hud = document.createElement('div');
      hud.id = 'besing-zapper-hud';
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:0.5px;">⚡ ELEMENT ZAPPER</span>
          <span style="font-size:11px;color:#f1f5f9;">Hover to target • <strong style="color:#38bdf8;">Left-Click</strong> to Zap • <strong style="color:#fca5a5;">Esc / Right-Click</strong> to Exit</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="besing-zapper-status" style="font-size:10px;color:#a5b4fc;font-family:monospace;"></span>
          <button type="button" id="besing-zapper-exit-btn" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;cursor:pointer;">✕ Exit</button>
        </div>
      `;
      hud.setAttribute('style', 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.95);border:1.5px solid rgba(239,68,68,0.6);border-radius:12px;padding:8px 16px;z-index:2147483647;box-shadow:0 10px 30px rgba(0,0,0,0.7),0 0 20px rgba(239,68,68,0.3);display:flex;align-items:center;gap:20px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:-apple-system,sans-serif;pointer-events:auto;');
      (document.body || document.documentElement).appendChild(hud);
      this._zapperHud = hud;

      hud.querySelector('#besing-zapper-exit-btn').onclick = () => this.stopZapper();

      // 2. Create Target Highlight Box
      const box = document.createElement('div');
      box.id = 'besing-zapper-highlight';
      box.setAttribute('style', 'position:fixed;pointer-events:none;border:2px solid #ef4444;background:rgba(239,68,68,0.22);z-index:2147483646;display:none;transition:top 0.05s ease, left 0.05s ease, width 0.05s ease, height 0.05s ease;border-radius:4px;box-shadow:0 0 16px rgba(239,68,68,0.6);');
      
      const tagBadge = document.createElement('div');
      tagBadge.id = 'besing-zapper-tag-badge';
      tagBadge.setAttribute('style', 'position:absolute;top:-24px;left:0;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:monospace;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.4);');
      box.appendChild(tagBadge);

      (document.body || document.documentElement).appendChild(box);
      this._highlightEl = box;

      document.body.style.cursor = 'crosshair';

      this._mouseMoveHandler = (e) => {
        if (!this._zapperActive) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el.closest('#besing-zapper-hud') || el.closest('#besing-zapper-highlight') || el.closest('#__besing_root__')) {
          box.style.display = 'none';
          this._currentHoveredTarget = null;
          return;
        }

        this._currentHoveredTarget = el;
        const rect = el.getBoundingClientRect();
        box.style.display = 'block';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;

        const sel = this.computeSelector(el);
        tagBadge.textContent = `${sel} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
      };

      this._clickHandler = (e) => {
        if (!this._zapperActive) return;
        if (e.target.closest('#besing-zapper-hud')) return;
        e.preventDefault();
        e.stopPropagation();

        const target = this._currentHoveredTarget;
        if (!target) return;

        const sel = this.computeSelector(target);
        if (!sel) return;

        // Shrink & fade out zapping animation
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

        const statusEl = hud.querySelector('#besing-zapper-status');
        if (statusEl) {
          statusEl.textContent = `✅ Zapped: ${sel}`;
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
        }
      };

      this._keyDownHandler = (e) => {
        if (e.key === 'Escape') {
          this.stopZapper();
        }
      };

      this._contextHandler = (e) => {
        if (this._zapperActive) {
          e.preventDefault();
          this.stopZapper();
        }
      };

      window.addEventListener('mousemove', this._mouseMoveHandler, { passive: true });
      window.addEventListener('click', this._clickHandler, { capture: true });
      window.addEventListener('keydown', this._keyDownHandler);
      window.addEventListener('contextmenu', this._contextHandler, { capture: true });
    },

    stopZapper() {
      this._zapperActive = false;
      document.body.style.cursor = '';
      if (this._zapperHud) {
        this._zapperHud.remove();
        this._zapperHud = null;
      }
      if (this._highlightEl) {
        this._highlightEl.remove();
        this._highlightEl = null;
      }
      if (this._mouseMoveHandler) {
        window.removeEventListener('mousemove', this._mouseMoveHandler);
        this._mouseMoveHandler = null;
      }
      if (this._clickHandler) {
        window.removeEventListener('click', this._clickHandler, { capture: true });
        this._clickHandler = null;
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
