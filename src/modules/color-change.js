/**
 * BESing Module: Color Change
 * Dynamically changes the page background color to red.
 */

export const ColorChangeModule = {
  id: 'color-change',
  name: 'Color Change',
  version: '1.0.0',
  description: 'Changes page background color to red.',
  category: 'Visual',
  author: 'AI Agent',
  enabled: true,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,

  _prevBg: null,

  init(context) {
    this._prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'red';
  },

  destroy() {
    document.body.style.backgroundColor = this._prevBg || '';
    this._prevBg = null;
  }
};
