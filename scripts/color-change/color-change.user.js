// ==UserScript==
// @name         Page Color
// @namespace    https://github.com/CoronRing/BESing
// @version      1.4.0
// @description  Color profiles, brightness, warmth, and text color presets.
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
    name: 'Page Color',
    version: '1.4.0',
    description: 'Color profiles, brightness, warmth, and text color presets.',
    category: 'Visual',
    _prevBodyBg: null,
    _prevHtmlBg: null,
    _presetOverlay: null,
    _brightnessOverlay: null,
    _warmthOverlay: null,
    _textColorSheet: null,
    _textColorStyle: null,
    _config: {
      brightnessEnabled: false,
      brightness: 0, // -100 (lighten) to +100 (darken)
      warmthEnabled: false,
      warmth: 35, // 0..100 warm amber blue-light filter
      preset: 'eye-protect',
      customColor: '#cce8cf',
      textColor: 'default',
      customTextColor: '#ffffff',
      activeProfile: '',
      profiles: []
    },

    DEFAULT_PROFILES: [
      {
        id: 'eye',
        name: 'EYE',
        builtin: true,
        preset: 'eye-protect',
        customColor: '#cce8cf',
        textColor: 'black',
        customTextColor: '#0f172a',
        brightnessEnabled: false,
        brightness: 0,
        warmthEnabled: false,
        warmth: 0
      },
      {
        id: 'night',
        name: 'NIGHT',
        builtin: true,
        preset: 'custom',
        customColor: '#222428',
        textColor: 'custom',
        customTextColor: '#e5e7eb',
        brightnessEnabled: false,
        brightness: 0,
        warmthEnabled: false,
        warmth: 0
      }
    ],

    PRESETS: {
      'none': { name: 'Original', color: 'transparent', overlay: 'transparent' },
      'eye-protect': { name: 'Eye Green', color: '#cce8cf', overlay: 'rgba(204, 232, 207, 0.45)' },
      'old-paper': { name: 'Old Paper', color: '#f4ecd8', overlay: 'rgba(244, 236, 216, 0.48)' },
      'dark': { name: 'Dark', color: '#18181b', overlay: 'rgba(24, 24, 27, 0.65)' },
      'soft-sepia': { name: 'Sepia', color: '#eee4cd', overlay: 'rgba(238, 228, 205, 0.42)' },
      'cool-mint': { name: 'Cool Mint', color: '#e0f2fe', overlay: 'rgba(224, 242, 254, 0.42)' }
    },

    TEXT_COLORS: {
      'default': { name: 'Original', color: 'transparent', text: null, border: '#475569' },
      'white': { name: 'White', color: '#ffffff', text: '#ffffff', border: '#f8fafc' },
      'black': { name: 'Black', color: '#0f172a', text: '#0f172a', border: '#0f172a' },
      'charcoal': { name: 'Charcoal', color: '#334155', text: '#334155', border: '#64748b' },
      'gray': { name: 'Gray', color: '#94a3b8', text: '#94a3b8', border: '#94a3b8' },
      'amber': { name: 'Cream', color: '#fef3c7', text: '#fef3c7', border: '#fde68a' }
    },

    _normalizeConfig(cfg) {
      const merged = { ...this._config, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
      if (cfg && cfg.brightnessEnabled === undefined && Number(cfg.brightness) !== 0 && !isNaN(Number(cfg.brightness))) {
        merged.brightnessEnabled = true;
      }
      return merged;
    },

    init(cfg) {
      this.destroy();
      this._config = this._normalizeConfig(cfg);
      this._prevBodyBg = document.body ? document.body.style.backgroundColor : null;
      this._prevHtmlBg = document.documentElement ? document.documentElement.style.backgroundColor : null;
      this._createOverlays();
      this.applyConfig();
    },

    _createOverlays() {
      const mountRoot = document.documentElement || document.body;
      if (!mountRoot) return;

      if (!this._presetOverlay) {
        const pLayer = document.createElement('div');
        pLayer.id = 'besing-bg-preset-overlay';
        pLayer.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483625!important;transition:background-color 0.2s ease,opacity 0.2s ease!important;';
        mountRoot.appendChild(pLayer);
        this._presetOverlay = pLayer;
      }

      if (!this._brightnessOverlay) {
        const bLayer = document.createElement('div');
        bLayer.id = 'besing-bg-brightness-overlay';
        bLayer.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483630!important;transition:background-color 0.15s ease,opacity 0.15s ease!important;';
        mountRoot.appendChild(bLayer);
        this._brightnessOverlay = bLayer;
      }

      if (!this._warmthOverlay) {
        const wLayer = document.createElement('div');
        wLayer.id = 'besing-warmth-overlay';
        wLayer.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483635!important;mix-blend-mode:multiply!important;display:none;transition:background-color 0.2s ease!important;';
        mountRoot.appendChild(wLayer);
        this._warmthOverlay = wLayer;
      }
    },

    onConfigChange(cfg) {
      this._config = this._normalizeConfig(cfg);
      this.applyConfig();
    },

    _applyTextColorCss(css) {
      try {
        if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
          if (!this._textColorSheet) this._textColorSheet = new CSSStyleSheet();
          this._textColorSheet.replaceSync(css);
          if (!document.adoptedStyleSheets.includes(this._textColorSheet)) {
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._textColorSheet];
          }
          return;
        }
      } catch (e) {
        this._textColorSheet = null;
      }
      if (!this._textColorStyle) {
        const s = document.createElement('style');
        s.id = 'besing-text-color-style';
        (document.head || document.documentElement).appendChild(s);
        this._textColorStyle = s;
      }
      this._textColorStyle.textContent = css;
    },

    _clearTextColorCss() {
      if (this._textColorSheet) {
        try {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this._textColorSheet);
        } catch (e) {}
        this._textColorSheet = null;
      }
      if (this._textColorStyle) {
        this._textColorStyle.remove();
        this._textColorStyle = null;
      }
      const s = document.getElementById('besing-text-color-style');
      if (s) s.remove();
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

      if (presetKey !== 'none') {
        if (document.documentElement) document.documentElement.style.backgroundColor = presetColor;
        if (document.body) document.body.style.backgroundColor = presetColor;
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = presetOverlayColor;
          this._presetOverlay.style.mixBlendMode = 'multiply';
        }
      } else {
        if (document.documentElement) document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
        if (document.body) document.body.style.backgroundColor = this._prevBodyBg || '';
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Brightness dragger (with independent on/off switch)
      const bEnabled = Boolean(this._config.brightnessEnabled);
      const bVal = Math.max(-100, Math.min(100, Number(this._config.brightness) || 0));
      if (this._brightnessOverlay) {
        if (bEnabled && bVal < 0) {
          const factor = Math.min(0.88, (Math.abs(bVal) / 100) * 0.95).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(255, 255, 255, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'screen';
        } else if (bEnabled && bVal > 0) {
          const factor = Math.min(0.92, (bVal / 100) * 0.96).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(0, 0, 0, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'multiply';
        } else {
          this._brightnessOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Warmth dragger (warm amber blue-light filter with independent on/off switch)
      const wEnabled = Boolean(this._config.warmthEnabled);
      const wVal = Math.max(0, Math.min(100, Number(this._config.warmth) || 0));
      if (this._warmthOverlay) {
        if (wEnabled && wVal > 0) {
          const alpha = (0.04 + (wVal / 100) * 0.38).toFixed(3);
          this._warmthOverlay.style.display = 'block';
          this._warmthOverlay.style.backgroundColor = `rgba(255, 148, 36, ${alpha})`;
        } else {
          this._warmthOverlay.style.display = 'none';
          this._warmthOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Text Color
      const tKey = this._config.textColor || 'default';
      let resolvedTextColor = null;
      if (tKey === 'custom') {
        resolvedTextColor = this._config.customTextColor || '#ffffff';
      } else if (this.TEXT_COLORS[tKey] && tKey !== 'default') {
        resolvedTextColor = this.TEXT_COLORS[tKey].text;
      }

      if (resolvedTextColor) {
        this._applyTextColorCss(`
          body *:not(#__besing_root__):not(#__besing_root__ *):not([id^="besing"]):not([class*="besing"]):not(input):not(textarea):not(select):not(button),
          p:not(#__besing_root__ *), span:not(#__besing_root__ *),
          a:not(#__besing_root__ *), li:not(#__besing_root__ *),
          h1:not(#__besing_root__ *), h2:not(#__besing_root__ *), h3:not(#__besing_root__ *),
          h4:not(#__besing_root__ *), h5:not(#__besing_root__ *), h6:not(#__besing_root__ *),
          article:not(#__besing_root__ *), section:not(#__besing_root__ *), blockquote:not(#__besing_root__ *),
          #content:not(#__besing_root__ *), #content *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          #txtContent:not(#__besing_root__ *), #txtContent *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .chaptercontent:not(#__besing_root__ *), .chaptercontent *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .showtxt:not(#__besing_root__ *), .showtxt *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .read-content:not(#__besing_root__ *), .read-content *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .entry-content:not(#__besing_root__ *), .entry-content *:not(#__besing_root__ *):not(input):not(textarea):not(button) {
            color: ${resolvedTextColor} !important;
          }
        `);
      } else {
        this._clearTextColorCss();
      }
    },

    destroy() {
      if (document.documentElement) {
        document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
      }
      if (document.body) {
        document.body.style.backgroundColor = this._prevBodyBg || '';
      }
      [this._presetOverlay, this._brightnessOverlay, this._warmthOverlay].forEach(el => {
        if (el) el.remove();
      });
      this._presetOverlay = null;
      this._brightnessOverlay = null;
      this._warmthOverlay = null;
      this._clearTextColorCss();
      ['besing-bg-preset-overlay', 'besing-bg-brightness-overlay', 'besing-warmth-overlay', 'besing-night-dimmer-overlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
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
