/**
 * BESing Module: Reading Assistant & Heading Outline
 * Displays word count, estimated reading time, and interactive table of contents.
 */

export const ReadingAssistantModule = {
  id: 'reading-assistant',
  name: 'Reading Assistant',
  version: '1.0.0',
  description: 'Calculates word count, estimated reading time, and generates a quick jump heading outline.',
  category: 'Productivity',
  author: 'BESing Team',
  enabled: true,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`,

  _domNode: null,

  init(context) {
    this.destroy(); // clean if previously rendered

    // Calculate word count
    const text = document.body ? document.body.innerText || '' : '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const readMinutes = Math.max(1, Math.ceil(words / 200));

    // Discover headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter(h => h.innerText.trim().length > 0)
      .slice(0, 15); // limit to first 15 for compactness

    // Create floating badge container
    const container = document.createElement('div');
    container.id = 'besing-reading-assistant-badge';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 24px;
      z-index: 999980;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 9999px;
      padding: 8px 16px;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      user-select: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    container.innerHTML = `
      <span style="display:flex;align-items:center;gap:5px;color:#38bdf8;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        ${readMinutes} min read
      </span>
      <span style="color:rgba(255,255,255,0.25);">|</span>
      <span style="color:#94a3b8;">${words.toLocaleString()} words</span>
      ${headings.length > 0 ? `<span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${headings.length} headings</span>` : ''}
    `;

    container.addEventListener('mouseenter', () => {
      container.style.transform = 'translateY(-2px) scale(1.02)';
      container.style.boxShadow = '0 12px 28px rgba(0,0,0,0.45), 0 0 16px rgba(56,189,248,0.2)';
    });

    container.addEventListener('mouseleave', () => {
      container.style.transform = 'translateY(0) scale(1)';
      container.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';
    });

    // Toggle outline modal on click
    let outlinePopover = null;
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      if (outlinePopover) {
        outlinePopover.remove();
        outlinePopover = null;
        return;
      }

      if (headings.length === 0) return;

      outlinePopover = document.createElement('div');
      outlinePopover.style.cssText = `
        position: fixed;
        bottom: 74px;
        left: 24px;
        width: 300px;
        max-height: 380px;
        overflow-y: auto;
        background: #0f172a;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        padding: 14px;
        color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 16px 36px rgba(0,0,0,0.5);
        z-index: 999981;
      `;

      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;margin-bottom:10px;color:#38bdf8;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;';
      title.textContent = 'Document Outline';
      outlinePopover.appendChild(title);

      headings.forEach((h, idx) => {
        const item = document.createElement('div');
        const level = parseInt(h.tagName.substring(1), 10);
        const paddingLeft = (level - 1) * 12;
        item.style.cssText = `
          padding: 6px 8px;
          margin-bottom: 2px;
          border-radius: 6px;
          cursor: pointer;
          padding-left: ${paddingLeft + 8}px;
          color: ${level === 1 ? '#f8fafc' : (level === 2 ? '#cbd5e1' : '#94a3b8')};
          font-weight: ${level === 1 ? '600' : '400'};
          transition: background 0.15s ease;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        item.textContent = h.innerText.trim();
        item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.08)');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
          outlinePopover.remove();
          outlinePopover = null;
        });
        outlinePopover.appendChild(item);
      });

      document.body.appendChild(outlinePopover);

      const closeHandler = () => {
        if (outlinePopover) {
          outlinePopover.remove();
          outlinePopover = null;
        }
        document.removeEventListener('click', closeHandler);
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 50);
    });

    document.body.appendChild(container);
    this._domNode = container;
  },

  destroy() {
    if (this._domNode) {
      this._domNode.remove();
      this._domNode = null;
    }
    const pop = document.querySelector('#besing-reading-assistant-popover');
    if (pop) pop.remove();
  }
};
