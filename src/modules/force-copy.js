/**
 * BESing Module: Force Allow Copy & Paste
 * Forcefully enables text selection, copy, cut, paste, and right-click on sites that attempt to disable them.
 */

export const ForceCopyModule = {
  id: 'force-copy',
  name: 'Force Allow Copy & Paste',
  version: '1.0.0',
  description: 'Enables text selection, copy, cut, paste, and right-click on sites that attempt to disable them.',
  category: 'Tools',
  author: 'BESing Team',
  enabled: true,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 14h6M9 18h4"></path></svg>`,
  _styleNode: null,
  _listeners: [],
  _interval: null,
  _config: {
    allowSelect: true,
    allowCopy: true,
    allowPaste: true,
    allowContextMenu: true
  },

  init(cfg) {
    this.destroy();
    if (cfg && typeof cfg === 'object') {
      this._config = { ...this._config, ...cfg };
    }

    // 1. Force enable CSS user-select
    this._injectStyle();

    // 2. Attach capture listeners to block website event prevention
    this._attachCaptureInterceptors();

    // 3. Clear legacy inline event handlers
    this._clearInlineHandlers();

    // 4. Periodic check to neutralize dynamic re-binding
    this._interval = setInterval(() => this._clearInlineHandlers(), 2000);
  },

  _injectStyle() {
    if (!this._styleNode) {
      const style = document.createElement('style');
      style.id = 'besing-force-copy-style';
      style.textContent = `
        *, *::before, *::after {
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          -ms-user-select: text !important;
          user-select: text !important;
          -webkit-touch-callout: default !important;
        }
        input, textarea, [contenteditable="true"] {
          -webkit-user-select: auto !important;
          user-select: auto !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
      this._styleNode = style;
    }
  },

  _attachCaptureInterceptors() {
    const handleCapture = (e) => {
      const type = e.type;
      if (type === 'copy' || type === 'cut') {
        if (this._config.allowCopy) e.stopImmediatePropagation();
      } else if (type === 'paste') {
        if (this._config.allowPaste) e.stopImmediatePropagation();
      } else if (type === 'contextmenu') {
        if (this._config.allowContextMenu) e.stopImmediatePropagation();
      } else if (type === 'selectstart' || type === 'selectionchange') {
        if (this._config.allowSelect) e.stopImmediatePropagation();
      }
    };

    const handleKeydown = (e) => {
      if (!this._config.allowCopy) return;
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a', 'C', 'V', 'X', 'A'].includes(e.key)) {
        e.stopImmediatePropagation();
      }
    };

    const events = ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'];
    events.forEach(evt => {
      window.addEventListener(evt, handleCapture, { capture: true, passive: false });
      document.addEventListener(evt, handleCapture, { capture: true, passive: false });
      this._listeners.push({ target: window, event: evt, fn: handleCapture });
      this._listeners.push({ target: document, event: evt, fn: handleCapture });
    });

    window.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
    this._listeners.push({ target: window, event: 'keydown', fn: handleKeydown });
  },

  _clearInlineHandlers() {
    const events = ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart', 'ondragstart', 'onmousedown', 'onmouseup'];
    events.forEach(evt => {
      try {
        if (document[evt]) document[evt] = null;
        if (document.body && document.body[evt]) document.body[evt] = null;
      } catch (e) {}
    });
  },

  onConfigChange(cfg) {
    if (cfg && typeof cfg === 'object') {
      this._config = { ...this._config, ...cfg };
    }
  },

  destroy() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._listeners.forEach(l => {
      try { l.target.removeEventListener(l.event, l.fn, { capture: true }); } catch (e) {}
    });
    this._listeners = [];

    if (this._styleNode) {
      this._styleNode.remove();
      this._styleNode = null;
    }
    const s = document.getElementById('besing-force-copy-style');
    if (s) s.remove();
  }
};
