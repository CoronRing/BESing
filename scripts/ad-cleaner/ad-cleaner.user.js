// ==UserScript==
// @name         Ad Cleaner Lite
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Hides annoying intrusive floating overlays, sticky marketing banners, and cookie consent popups.
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
    name: 'Ad Cleaner Lite',
    version: '1.0.0',
    description: 'Hides intrusive floating overlays, sticky marketing banners, and cookie popups.',
    category: 'Privacy',
    _styleEl: null,

    init() {
      this.destroy();
      const style = document.createElement('style');
      style.id = 'besing-ad-cleaner-style';
      style.textContent = `
        [class*="cookie-banner"], [id*="cookie-banner"],
        [class*="consent-banner"], [id*="consent-banner"],
        [class*="popup-overlay"]:not(#__besing_root__ *),
        [class*="newsletter-popup"], [id*="newsletter-modal"],
        .ad-banner, .ads-placement {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
      this._styleEl = style;
    },

    destroy() {
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
