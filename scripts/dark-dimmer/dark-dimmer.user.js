// ==UserScript==
// @name         Night Comfort Dimmer
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Gentle screen dimming filter and tint to soothe eyes during late hours.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DarkDimmer = {
    id: 'dark-dimmer',
    name: 'Night Comfort Dimmer',
    version: '1.0.0',
    description: 'Gentle screen dimming filter and tint to soothe eyes during late hours.',
    category: 'Accessibility',
    _node: null,

    init() {
      this.destroy();
      const layer = document.createElement('div');
      layer.id = 'besing-dark-dimmer-layer';
      layer.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,0.32);backdrop-filter:contrast(0.95) brightness(0.9);pointer-events:none;z-index:999970;transition:opacity 0.3s ease;`;
      document.documentElement.appendChild(layer);
      this._node = layer;
    },

    destroy() {
      if (this._node) { this._node.remove(); this._node = null; }
      const l = document.getElementById('besing-dark-dimmer-layer');
      if (l) l.remove();
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['dark-dimmer'] = DarkDimmer;
    if (!window.__BESING_EMBEDDED__) {
      DarkDimmer.init();
    }
  }
})();
