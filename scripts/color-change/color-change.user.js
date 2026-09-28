// ==UserScript==
// @name         Color Change
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Changes page background color to red for dynamic testing and visual confirmation.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ColorChange = {
    id: 'color-change',
    name: 'Color Change',
    version: '1.0.0',
    description: 'Changes page background color to red.',
    category: 'Visual',
    _prevBg: null,

    init() {
      this._prevBg = document.body ? document.body.style.backgroundColor : null;
      if (document.body) {
        document.body.style.backgroundColor = 'red';
      }
    },

    destroy() {
      if (document.body) {
        document.body.style.backgroundColor = this._prevBg || '';
      }
      this._prevBg = null;
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['color-change'] = ColorChange;
    if (!window.__BESING_EMBEDDED__) {
      ColorChange.init();
    }
  }
})();
