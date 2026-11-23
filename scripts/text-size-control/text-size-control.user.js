// ==UserScript==
// @name         Page Text Zoom
// @namespace    https://github.com/CoronRing/BESing
// @version      1.2.0
// @description  Scales text and page zoom beyond 200% for comfortable reading.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TextSizeControl = {
    id: 'text-size-control',
    name: 'Page Text Zoom',
    version: '1.2.0',
    description: 'Scales text and page zoom beyond 200% for comfortable reading.',
    category: 'Accessibility',
    _styleNode: null,
    _adoptedSheet: null,
    _origMap: null,
    _touchedEls: null,
    _observer: null,
    _scanTimer: null,
    _config: {
      fontSizePercent: 125,
      mode: 'hybrid' // 'hybrid' | 'text-only' | 'zoom'
    },

    SKIP_TAGS: new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TITLE', 'HEAD',
      'SVG', 'PATH', 'CANVAS', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT',
      'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BESING-HOST', 'BESING-LOG-VIEWER'
    ]),

    _isIOSWebKit() {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const maxTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
      return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouch > 1);
    },

    _setCss(cssText) {
      // Prefer constructed stylesheets (immune to strict style-src CSP), falling back to <style>.
      try {
        if (typeof CSSStyleSheet !== 'undefined' && document.adoptedStyleSheets) {
          if (!this._adoptedSheet) {
            this._adoptedSheet = new CSSStyleSheet();
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._adoptedSheet];
          }
          this._adoptedSheet.replaceSync(cssText || '');
          if (this._styleNode) {
            this._styleNode.remove();
            this._styleNode = null;
          }
          return;
        }
      } catch (e) {}

      if (!this._styleNode) {
        const style = document.createElement('style');
        style.id = 'besing-text-size-style';
        (document.head || document.documentElement).appendChild(style);
        this._styleNode = style;
      }
      this._styleNode.textContent = cssText || '';
    },

    _clearCss() {
      if (this._adoptedSheet) {
        try {
          this._adoptedSheet.replaceSync('');
          if (document.adoptedStyleSheets) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this._adoptedSheet);
          }
        } catch (e) {}
        this._adoptedSheet = null;
      }
      if (this._styleNode) {
        this._styleNode.remove();
        this._styleNode = null;
      }
      const s = document.getElementById('besing-text-size-style');
      if (s) s.remove();
    },

    _isBesingNode(el) {
      if (!el || el.nodeType !== 1) return true;
      const id = el.id || '';
      if (id === '__besing_root__' || id === 'besing-zapper-hud' || id === 'pagestream-status-toast' || id.startsWith('besing-')) return true;
      if (el.closest && el.closest('besing-host, besing-log-viewer, #__besing_root__, #besing-zapper-hud')) return true;
      return false;
    },

    _hasDirectText(el) {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim().length > 0) return true;
      }
      return false;
    },

    _scaleProportionalRoot(root, scale) {
      if (!root) return;
      if (!this._origMap) this._origMap = new WeakMap();
      if (!this._touchedEls) this._touchedEls = new Set();

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      const targets = [];
      let count = 0;
      const MAX_SCAN = 4000;

      let node = walker.currentNode;
      while (node && count < MAX_SCAN) {
        if (node.nodeType === 1) {
          const tag = node.tagName;
          if (!this.SKIP_TAGS.has(tag) && !this._isBesingNode(node)) {
            if (this._hasDirectText(node)) {
              targets.push(node);
            }
          }
          count++;
        }
        node = walker.nextNode();
      }

      // Measure first (avoids layout thrashing from interleaved read/write), then apply.
      const toWrite = [];
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        let rec = this._origMap.get(el);
        if (!rec) {
          const cs = window.getComputedStyle(el);
          const px = parseFloat(cs && cs.fontSize);
          if (!Number.isFinite(px) || px < 6 || px > 120) continue;
          const lhPx = parseFloat(cs && cs.lineHeight);
          rec = {
            origPx: px,
            origLhPx: Number.isFinite(lhPx) ? lhPx : null,
            inlineFs: el.style.getPropertyValue('font-size'),
            inlineFsPrio: el.style.getPropertyPriority('font-size'),
            inlineLh: el.style.getPropertyValue('line-height'),
            inlineLhPrio: el.style.getPropertyPriority('line-height')
          };
          this._origMap.set(el, rec);
        }
        toWrite.push([el, rec]);
      }

      for (let i = 0; i < toWrite.length; i++) {
        const el = toWrite[i][0];
        const rec = toWrite[i][1];
        const nextPx = Math.min(96, Math.max(8, rec.origPx * scale));
        el.style.setProperty('font-size', `${nextPx.toFixed(2)}px`, 'important');
        if (scale > 1.05 && rec.origLhPx !== null && rec.origLhPx < nextPx * 1.35) {
          el.style.setProperty('line-height', `${(nextPx * 1.55).toFixed(2)}px`, 'important');
        }
        this._touchedEls.add(el);
      }
    },

    _restoreProportional() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._scanTimer) {
        clearTimeout(this._scanTimer);
        this._scanTimer = null;
      }
      if (this._touchedEls && this._origMap) {
        this._touchedEls.forEach(el => {
          const rec = this._origMap.get(el);
          if (!rec) return;
          if (rec.inlineFs) el.style.setProperty('font-size', rec.inlineFs, rec.inlineFsPrio || '');
          else el.style.removeProperty('font-size');
          if (rec.inlineLh) el.style.setProperty('line-height', rec.inlineLh, rec.inlineLhPrio || '');
          else el.style.removeProperty('line-height');
        });
        this._touchedEls.clear();
      }
    },

    _watchDynamicContent(scale) {
      this._currentScale = scale;
      if (this._observer || !document.body) return;
      const self = this;
      this._observer = new MutationObserver((mutations) => {
        let added = false;
        for (let i = 0; i < mutations.length; i++) {
          const list = mutations[i].addedNodes;
          for (let j = 0; j < list.length; j++) {
            const n = list[j];
            if (n.nodeType === 1 && !self._isBesingNode(n)) {
              added = true;
              break;
            }
          }
          if (added) break;
        }
        if (!added) return;
        if (self._scanTimer) clearTimeout(self._scanTimer);
        self._scanTimer = setTimeout(() => {
          self._scanTimer = null;
          if (document.body && self._currentScale && self._currentScale !== 1) {
            self._scaleProportionalRoot(document.body, self._currentScale);
          }
        }, 180);
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
    },

    init(cfg) {
      this.destroy();
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applySize();
    },

    onConfigChange(cfg) {
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applySize();
    },

    applySize() {
      const percent = Math.max(70, Math.min(400, Number(this._config.fontSizePercent) || 125));
      const scale = percent / 100;
      const mode = this._config.mode || 'hybrid';
      const counterScale = (1 / scale).toFixed(4);
      const isIOS = this._isIOSWebKit();

      if (percent === 100) {
        document.documentElement.style.zoom = '';
        this._restoreProportional();
        this._clearCss();
        return;
      }

      // On iOS/iPadOS Safari, CSS `zoom` on <html> is counter-scaled by WebKit, so Smart Hybrid
      // routes to true proportional font scaling (same engine as Text Only, without breaking layout).
      if (mode === 'text-only' || (mode === 'hybrid' && isIOS)) {
        document.documentElement.style.zoom = '';
        this._setCss(`
          html, body {
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `);
        if (document.body) {
          this._scaleProportionalRoot(document.body, scale);
          this._watchDynamicContent(scale);
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
              this._scaleProportionalRoot(document.body, scale);
              this._watchDynamicContent(scale);
            }
          }, { once: true });
        }
      } else if (mode === 'zoom') {
        // Standard Page Zoom (desktop Chromium/Edge full-layout zoom)
        this._restoreProportional();
        document.documentElement.style.zoom = scale;
        this._setCss(`
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            zoom: ${counterScale} !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `);
      } else {
        // Desktop Smart Hybrid (Chromium/Edge): Page zoom + guaranteed paragraph autosize unlock
        this._restoreProportional();
        document.documentElement.style.zoom = scale;
        this._setCss(`
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #content, #content p, #txtContent, #txtContent p,
          .chaptercontent, .chaptercontent p, .showtxt, .showtxt p,
          .read-content, .read-content p, article p, .novel-content,
          .entry-content p, .post-content p, .article-content p, p {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            zoom: ${counterScale} !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `);
      }
    },

    destroy() {
      document.documentElement.style.zoom = '';
      this._restoreProportional();
      this._clearCss();
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['text-size-control'] = TextSizeControl;
    if (!window.__BESING_EMBEDDED__) {
      TextSizeControl.init();
    }
  }
})();
