// ==UserScript==
// @name         Text Size Enhancer
// @namespace    https://github.com/CoronRing/BESing
// @version      1.1.0
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
    version: '1.1.0',
    description: 'Enlarges text and page zoom (125%, 150%, 200%+) so small website fonts and novel paragraphs become easily readable.',
    category: 'Accessibility',
    _styleNode: null,
    _config: {
      fontSizePercent: 125,
      mode: 'hybrid' // 'hybrid' | 'text-only' | 'zoom'
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

      if (!this._styleNode) {
        const style = document.createElement('style');
        style.id = 'besing-text-size-style';
        (document.head || document.documentElement).appendChild(style);
        this._styleNode = style;
      }

      const counterScale = (1 / scale).toFixed(4);

      if (percent === 100) {
        document.documentElement.style.zoom = '';
        this._styleNode.textContent = '';
        return;
      }

      if (mode === 'text-only') {
        // Mode 1: Text-Only - keeps page layout width intact, enlarges all reading text & paragraphs
        document.documentElement.style.zoom = '';
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          p, li, dt, dd, blockquote,
          #content, #content p, #txtContent, #txtContent p,
          .chaptercontent, .chaptercontent p, .showtxt, .showtxt p,
          .read-content, .read-content p, article, article p,
          .entry-content, .entry-content p, .post-content, .post-content p,
          .article-content, .article-content p, .novel-content, .novel-content p {
            font-size: calc(max(1.05rem, 16px) * ${scale}) !important;
            line-height: 1.7 !important;
          }
          h1 { font-size: calc(max(1.75rem, 24px) * ${scale}) !important; }
          h2 { font-size: calc(max(1.4rem, 20px) * ${scale}) !important; }
          h3 { font-size: calc(max(1.2rem, 18px) * ${scale}) !important; }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `;
      } else if (mode === 'zoom') {
        // Mode 2: Standard Page Zoom
        document.documentElement.style.zoom = scale;
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            zoom: ${counterScale} !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `;
      } else {
        // Mode 3: Smart Hybrid (Default) - Page zoom + guaranteed paragraph scaling
        document.documentElement.style.zoom = scale;
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          /* Ensure novel reading containers and paragraphs expand even when mobile browsers clamp them */
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
        `;
      }
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
