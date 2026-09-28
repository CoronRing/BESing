/**
 * BESing Module: Dark Dimmer / Eye Comfort Filter
 * Provides late-night browsing eye protection with an adjustable dimming backdrop.
 */

export const DarkDimmerModule = {
  id: 'dark-dimmer',
  name: 'Night Comfort Dimmer',
  version: '1.0.0',
  description: 'Gentle night tint and brightness reduction to reduce eye strain during nighttime reading.',
  category: 'Accessibility',
  author: 'BESing Team',
  enabled: false,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,

  _overlay: null,

  init(context) {
    this.destroy();

    const overlay = document.createElement('div');
    overlay.id = 'besing-dark-dimmer-layer';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.35);
      backdrop-filter: contrast(0.95) brightness(0.9);
      pointer-events: none;
      z-index: 999970;
      transition: opacity 0.3s ease;
    `;

    document.documentElement.appendChild(overlay);
    this._overlay = overlay;
  },

  destroy() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    const layer = document.getElementById('besing-dark-dimmer-layer');
    if (layer) layer.remove();
  }
};
