// ==UserScript==
// @name         Text Size Enhancer
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Intelligently scales text and page size with custom percentage controls (125%, 150%, 200%, 300%) for comfortable reading.
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
    name: 'Text Size Enhancer',
    version: '1.0.0',
    description: 'Enlarges text and page zoom (125%, 150%, 200%+) so small website fonts become easily readable.',
    category: 'Accessibility',
    _styleNode: null,
    _config: {
      fontSizePercent: 125,
      mode: 'zoom'
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

      // Apply zoom to documentElement for full layout and text scaling
      document.documentElement.style.zoom = scale;

      // Counter-zoom BESing root so manager and widget remain crisp 1x size
      if (!this._styleNode) {
        const style = document.createElement('style');
        style.id = 'besing-text-size-style';
        (document.head || document.documentElement).appendChild(style);
        this._styleNode = style;
      }

      const counterScale = (1 / scale).toFixed(4);
      this._styleNode.textContent = `
        #__besing_root__ {
          zoom: ${counterScale} !important;
        }
      `;
    },

    destroy() {
      document.documentElement.style.zoom = '';
      if (this._styleNode) {
        this._styleNode.remove();
        this._styleNode = null;
      }
      const s = document.getElementById('besing-text-size-style');
      if (s) s.remove();
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
