// ==UserScript==
// @name         Page Color & Brightness
// @namespace    https://github.com/CoronRing/BESing
// @version      1.1.0
// @description  Customizes page background colors with comfort presets (Eye Protect, Old Paper, Dark) and live brightness dragger on top of site background.
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
    name: 'Page Color & Brightness',
    version: '1.1.0',
    description: 'Adjusts background color presets (Eye Protect, Old Paper, Dark) and site background brightness.',
    category: 'Visual',
    _prevBodyBg: null,
    _prevHtmlBg: null,
    _presetOverlay: null,
    _brightnessOverlay: null,
    _config: {
      brightness: 0, // -100 (lighten) to +100 (deepen / darken)
      preset: 'eye-protect', // 'none' | 'eye-protect' | 'old-paper' | 'dark' | 'soft-sepia' | 'cool-mint' | 'custom'
      customColor: '#cce8cf'
    },

    PRESETS: {
      'none': { name: 'Original', color: 'transparent', overlay: 'transparent' },
      'eye-protect': { name: 'Eye Protect', color: '#cce8cf', overlay: 'rgba(204, 232, 207, 0.45)' },
      'old-paper': { name: 'Old Paper', color: '#f4ecd8', overlay: 'rgba(244, 236, 216, 0.48)' },
      'dark': { name: 'Dark Mode', color: '#18181b', overlay: 'rgba(24, 24, 27, 0.65)' },
      'soft-sepia': { name: 'Soft Sepia', color: '#eee4cd', overlay: 'rgba(238, 228, 205, 0.42)' },
      'cool-mint': { name: 'Cool Mint', color: '#e0f2fe', overlay: 'rgba(224, 242, 254, 0.42)' }
    },

    init(cfg) {
      this.destroy();
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }

      this._prevBodyBg = document.body ? document.body.style.backgroundColor : null;
      this._prevHtmlBg = document.documentElement ? document.documentElement.style.backgroundColor : null;

      this._createOverlays();
      this.applyConfig();
    },

    _createOverlays() {
      // 1. Preset tint overlay (z-index 2147483625)
      if (!this._presetOverlay) {
        const pLayer = document.createElement('div');
        pLayer.id = 'besing-bg-preset-overlay';
        pLayer.style.cssText = `
          position: fixed !important;
          inset: 0 !important;
          pointer-events: none !important;
          z-index: 2147483625 !important;
          transition: background-color 0.2s ease, opacity 0.2s ease !important;
        `;
        (document.body || document.documentElement).appendChild(pLayer);
        this._presetOverlay = pLayer;
      }

      // 2. Brightness dragger overlay (z-index 2147483630, above preset tint but below BESing root 2147483642)
      if (!this._brightnessOverlay) {
        const bLayer = document.createElement('div');
        bLayer.id = 'besing-bg-brightness-overlay';
        bLayer.style.cssText = `
          position: fixed !important;
          inset: 0 !important;
          pointer-events: none !important;
          z-index: 2147483630 !important;
          transition: background-color 0.15s ease, opacity 0.15s ease !important;
        `;
        (document.body || document.documentElement).appendChild(bLayer);
        this._brightnessOverlay = bLayer;
      }
    },

    onConfigChange(cfg) {
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applyConfig();
    },

    applyConfig() {
      this._createOverlays();

      const presetKey = this._config.preset || 'none';
      let presetColor = 'transparent';
      let presetOverlayColor = 'transparent';

      if (presetKey === 'custom') {
        presetColor = this._config.customColor || '#cce8cf';
        presetOverlayColor = presetColor;
      } else if (this.PRESETS[presetKey]) {
        presetColor = this.PRESETS[presetKey].color;
        presetOverlayColor = this.PRESETS[presetKey].overlay;
      }

      // Apply Preset
      if (presetKey !== 'none') {
        if (document.documentElement) document.documentElement.style.backgroundColor = presetColor;
        if (document.body) document.body.style.backgroundColor = presetColor;
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = presetOverlayColor;
          this._presetOverlay.style.mixBlendMode = presetKey === 'dark' ? 'multiply' : 'multiply';
        }
      } else {
        if (document.documentElement) document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
        if (document.body) document.body.style.backgroundColor = this._prevBodyBg || '';
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Apply Brightness Dragger on top of site's current background
      // Dragging left (< 0): makes it lighter (e.g., blue -> light blue)
      // Dragging right (> 0): makes it deep and eventually dark (e.g., blue -> deep navy -> dark)
      const bVal = Math.max(-100, Math.min(100, Number(this._config.brightness) || 0));
      if (this._brightnessOverlay) {
        if (bVal < 0) {
          // Lighter: white overlay with soft screen / mix blend
          const factor = Math.min(0.88, (Math.abs(bVal) / 100) * 0.95).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(255, 255, 255, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'screen';
        } else if (bVal > 0) {
          // Deeper / Darker: black overlay with multiply / darkening blend
          const factor = Math.min(0.92, (bVal / 100) * 0.96).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(0, 0, 0, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'multiply';
        } else {
          this._brightnessOverlay.style.backgroundColor = 'transparent';
        }
      }
    },

    destroy() {
      if (document.documentElement) {
        document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
      }
      if (document.body) {
        document.body.style.backgroundColor = this._prevBodyBg || '';
      }
      if (this._presetOverlay) {
        this._presetOverlay.remove();
        this._presetOverlay = null;
      }
      if (this._brightnessOverlay) {
        this._brightnessOverlay.remove();
        this._brightnessOverlay = null;
      }
      const p1 = document.getElementById('besing-bg-preset-overlay');
      if (p1) p1.remove();
      const p2 = document.getElementById('besing-bg-brightness-overlay');
      if (p2) p2.remove();
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
