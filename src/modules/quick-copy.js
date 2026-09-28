/**
 * BESing Module: Quick Copy (Markdown Linker)
 * Press Alt+C or use trigger to copy page title and URL as Markdown link: [Title](URL).
 */

export const QuickCopyModule = {
  id: 'quick-copy',
  name: 'Markdown Link Copier',
  version: '1.0.0',
  description: 'Quickly copies current page title & URL formatted as clean Markdown [Title](URL).',
  category: 'Tools',
  author: 'BESing Team',
  enabled: true,
  matches: ['*'],
  icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`,

  _keyHandler: null,
  _toastNode: null,

  init(context) {
    this.destroy();

    this._keyHandler = (e) => {
      // Alt + C
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        this.copyMarkdownLink();
      }
    };

    window.addEventListener('keydown', this._keyHandler);
  },

  copyMarkdownLink() {
    const title = document.title || 'Untitled';
    const cleanTitle = title.replace(/[\[\]]/g, '');
    const url = window.location.href;
    const md = `[${cleanTitle}](${url})`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(() => {
        this.showToast(`Copied Markdown link: "${cleanTitle.slice(0, 30)}..."`);
      }).catch(() => {
        this._fallbackCopy(md);
      });
    } else {
      this._fallbackCopy(md);
    }
  },

  _fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      this.showToast('Copied Markdown link!');
    } catch (e) {
      console.error('[QuickCopy] Copy failed:', e);
    }
    document.body.removeChild(el);
  },

  showToast(msg) {
    if (this._toastNode) this._toastNode.remove();

    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: #0f172a;
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 10px 20px;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 12px rgba(56, 189, 248, 0.2);
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: besingFadeIn 0.2s ease-out;
    `;
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>${msg}</span>
    `;

    document.body.appendChild(toast);
    this._toastNode = toast;

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 2200);
  },

  destroy() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._toastNode) {
      this._toastNode.remove();
      this._toastNode = null;
    }
  }
};
