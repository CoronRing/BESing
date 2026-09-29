/**
 * BESing Module: Page Color & Brightness
 * Dynamically changes background color presets (Eye Protect, Old Paper, Dark) and controls site brightness.
 */

export const ColorChangeModule = {
  id: 'color-change',
  name: 'Page Color & Brightness',
  version: '1.1.0',
  description: 'Adjusts background color presets (Eye Protect, Old Paper, Dark) and site background brightness.',
  category: 'Visual',
  author: 'BESing Team',
  enabled: true,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,

  _prevBodyBg: null,
  _prevHtmlBg: null,
  _presetOverlay: null,
  _brightnessOverlay: null,
  _config: {
    brightness: 0,
    preset: 'eye-protect',
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

    const bVal = Math.max(-100, Math.min(100, Number(this._config.brightness) || 0));
    if (this._brightnessOverlay) {
      if (bVal < 0) {
        const factor = Math.min(0.88, (Math.abs(bVal) / 100) * 0.95).toFixed(3);
        this._brightnessOverlay.style.backgroundColor = `rgba(255, 255, 255, ${factor})`;
        this._brightnessOverlay.style.mixBlendMode = 'screen';
      } else if (bVal > 0) {
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
