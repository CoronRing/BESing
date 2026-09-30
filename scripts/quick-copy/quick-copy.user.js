// ==UserScript==
// @name         Markdown Link Copier
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Press Alt+C to copy current page title & URL formatted as Markdown [Title](URL).
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const QuickCopy = {
    id: 'quick-copy',
    name: 'Markdown Link Copier',
    version: '1.0.0',
    description: 'Press Alt+C to copy current page title & URL formatted as Markdown [Title](URL).',
    category: 'Tools',
    _handler: null,

    init() {
      this.destroy();
      this._handler = (e) => {
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          const title = (document.title || 'Untitled').replace(/[\[\]]/g, '');
          const md = `[${title}](${window.location.href})`;
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(md).then(() => this.toast(title));
          }
        }
      };
      window.addEventListener('keydown', this._handler);
    },

    toast(title) {
      const t = document.createElement('div');
      t.style.cssText = `position:fixed;top:24px;right:24px;background:#0f172a;color:#38bdf8;border:1px solid rgba(56,189,248,0.4);padding:10px 18px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;box-shadow:0 10px 25px rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;gap:8px;`;
      const cleanTitle = String(title || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      t.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied Markdown: "${cleanTitle.slice(0, 25)}..."</span>`;
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s ease'; setTimeout(() => t.remove(), 300); }, 2000);
    },

    destroy() {
      if (this._handler) {
        window.removeEventListener('keydown', this._handler);
        this._handler = null;
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['quick-copy'] = QuickCopy;
    if (!window.__BESING_EMBEDDED__) {
      QuickCopy.init();
    }
  }
})();
