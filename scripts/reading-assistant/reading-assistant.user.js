// ==UserScript==
// @name         Reading Assistant
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Calculates word count, reading duration, and provides a quick jump heading outline for any article or webpage.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ReadingAssistant = {
    id: 'reading-assistant',
    name: 'Reading Assistant',
    version: '1.0.0',
    description: 'Calculates word count, reading duration, and provides a quick jump heading outline.',
    category: 'Productivity',
    _dom: null,

    init() {
      this.destroy();
      const text = document.body ? document.body.innerText || '' : '';
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const readMin = Math.max(1, Math.ceil(words / 200));
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(h => h.innerText.trim()).slice(0, 15);

      const badge = document.createElement('div');
      badge.id = 'besing-reading-assistant-badge';
      badge.style.cssText = `position:fixed;bottom:24px;left:24px;z-index:999980;background:rgba(15,23,42,0.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:9999px;padding:8px 16px;color:#e2e8f0;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;user-select:none;transition:all 0.2s ease;`;
      badge.innerHTML = `<span style="display:flex;align-items:center;gap:5px;color:#38bdf8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>${readMin} min</span><span style="color:rgba(255,255,255,0.25);">|</span><span style="color:#94a3b8;">${words.toLocaleString()} words</span>${headings.length ? `<span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;">${headings.length} headings</span>` : ''}`;

      let popover = null;
      badge.onclick = (e) => {
        e.stopPropagation();
        if (popover) { popover.remove(); popover = null; return; }
        if (!headings.length) return;
        popover = document.createElement('div');
        popover.style.cssText = `position:fixed;bottom:74px;left:24px;width:300px;max-height:360px;overflow-y:auto;background:#0f172a;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:14px;color:#f1f5f9;font-family:-apple-system,sans-serif;font-size:13px;box-shadow:0 16px 36px rgba(0,0,0,0.5);z-index:999981;`;
        popover.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:#38bdf8;font-size:12px;text-transform:uppercase;">Document Outline</div>';
        headings.forEach(h => {
          const item = document.createElement('div');
          const level = parseInt(h.tagName[1], 10);
          item.style.cssText = `padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;padding-left:${(level-1)*12 + 6}px;color:${level===1?'#f8fafc':(level===2?'#cbd5e1':'#94a3b8')};font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
          item.textContent = h.innerText.trim();
          item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.08)';
          item.onmouseleave = () => item.style.background = 'transparent';
          item.onclick = (ev) => {
            ev.stopPropagation();
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            popover.remove(); popover = null;
          };
          popover.appendChild(item);
        });
        document.body.appendChild(popover);
        const closeDoc = () => { if (popover) { popover.remove(); popover = null; } document.removeEventListener('click', closeDoc); };
        setTimeout(() => document.addEventListener('click', closeDoc), 50);
      };

      document.body.appendChild(badge);
      this._dom = badge;
    },

    destroy() {
      if (this._dom) { this._dom.remove(); this._dom = null; }
      const b = document.getElementById('besing-reading-assistant-badge');
      if (b) b.remove();
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['reading-assistant'] = ReadingAssistant;
    if (!window.__BESING_EMBEDDED__) {
      ReadingAssistant.init();
    }
  }
})();
