// ==UserScript==
// @name         Quick Transfer
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Send copied strings, clipboard screenshots, or files (up to 5 MB) between PC, iPhone, and iPad with automatic 2-day expiry. Open and use anytime without enabling.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const QuickTransfer = {
    id: 'quick-transfer',
    name: 'Quick Transfer',
    version: '1.0.0',
    description: 'Send copied strings, clipboard screenshots, or files (up to 5 MB) between PC, iPhone, and iPad with automatic 2-day expiry. Open and use anytime without enabling.',
    category: 'Sync',

    MAX_BYTES: 5 * 1024 * 1024, // 5 MB raw limit
    DEFAULT_TTL_HOURS: 48,

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    _senderName() {
      const mgr = this._manager();
      const cloud = (mgr && mgr.cloud && typeof mgr.cloud.getConfig === 'function') ? mgr.cloud.getConfig() : {};
      return (cloud.deviceName && String(cloud.deviceName).trim()) || 'Device';
    },

    isConfigured() {
      const mgr = this._manager();
      return Boolean(mgr && mgr.cloud && typeof mgr.cloud.isConfigured === 'function' && mgr.cloud.isConfigured());
    },

    _blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const comma = res.indexOf(',');
          resolve(comma >= 0 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(new Error('Failed to read file/image data'));
        reader.readAsDataURL(blob);
      });
    },

    _base64ToBlob(b64, mimeType) {
      const bin = atob(String(b64 || ''));
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
    },

    async _compressImageIfLarge(blob) {
      // Compress large clipboard PNG screenshots (> 1.5 MB) via canvas WebP/JPEG to keep DB & egress lean.
      if (!blob || blob.size <= 1500000 || !/^image\/(png|bmp|tiff)$/i.test(blob.type || '')) {
        return blob;
      }
      try {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return blob;
        ctx.drawImage(bmp, 0, 0);
        const out = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b || blob), 'image/webp', 0.85);
        });
        return (out && out.size < blob.size) ? out : blob;
      } catch (e) {
        return blob;
      }
    },

    async listTransfers() {
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked. Configure Sync Link in BESing Settings.' };
      }
      const res = await mgr.cloud.rpc('besing_transfer_list', {}, { trafficKind: 'pull' });
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Failed to list transfers' };
      return { ok: true, items: (res.data && Array.isArray(res.data.items)) ? res.data.items : [], serverTime: res.data && res.data.server_time };
    },

    async sendText(text, title = '', ttlHours = 48) {
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked. Configure Sync Link in BESing Settings.' };
      }
      const cleanText = String(text || '');
      if (!cleanText.trim()) return { ok: false, error: 'Enter or paste text to send.' };
      const byteLen = new TextEncoder().encode(cleanText).length;
      if (byteLen > this.MAX_BYTES) {
        return { ok: false, error: `Text is ${(byteLen / (1024 * 1024)).toFixed(2)} MB (max 5 MB).` };
      }
      const autoTitle = String(title || '').trim() || cleanText.trim().split(/\r?\n/)[0].slice(0, 60) || 'Text Snippet';
      const res = await mgr.cloud.rpc('besing_transfer_put', {
        p_payload: {
          kind: 'text',
          title: autoTitle.slice(0, 160),
          mime_type: 'text/plain',
          file_name: '',
          size_bytes: byteLen,
          content: cleanText,
          preview_text: cleanText.replace(/\s+/g, ' ').trim().slice(0, 200),
          sender_name: this._senderName(),
          ttl_hours: Math.max(1, Math.min(48, Number(ttlHours) || this.DEFAULT_TTL_HOURS))
        }
      }, { trafficKind: 'push' });
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Upload failed' };
      return { ok: true, item: res.data };
    },

    async sendBlob(blob, { title = '', fileName = '', ttlHours = 48 } = {}) {
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked. Configure Sync Link in BESing Settings.' };
      }
      if (!blob) return { ok: false, error: 'No file or image provided.' };
      let target = blob;
      const isImage = /^image\//i.test(target.type || '');
      if (isImage) {
        target = await this._compressImageIfLarge(target);
      }
      if (target.size > this.MAX_BYTES) {
        return { ok: false, error: `File is ${(target.size / (1024 * 1024)).toFixed(2)} MB (max 5 MB).` };
      }
      const b64 = await this._blobToBase64(target);
      const mime = target.type || (isImage ? 'image/png' : 'application/octet-stream');
      const ext = isImage ? (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') : 'bin';
      const cleanFileName = String(fileName || (target.name || (isImage ? `clipboard-${Date.now()}.${ext}` : `file-${Date.now()}.bin`))).trim().slice(0, 180);
      const cleanTitle = String(title || '').trim() || cleanFileName;
      const res = await mgr.cloud.rpc('besing_transfer_put', {
        p_payload: {
          kind: isImage ? 'image' : 'file',
          title: cleanTitle.slice(0, 160),
          mime_type: mime.slice(0, 120),
          file_name: cleanFileName,
          size_bytes: target.size,
          content: b64,
          preview_text: `${cleanFileName} (${(target.size / 1024).toFixed(1)} KB)`,
          sender_name: this._senderName(),
          ttl_hours: Math.max(1, Math.min(48, Number(ttlHours) || this.DEFAULT_TTL_HOURS))
        }
      }, { trafficKind: 'push' });
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Upload failed' };
      return { ok: true, item: res.data };
    },

    async readClipboardImage() {
      if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        return { ok: false, error: 'Direct clipboard image read is unavailable here. Click inside the box above and press Ctrl+V (or use Upload File).' };
      }
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            return { ok: true, blob };
          }
        }
        return { ok: false, error: 'No image found on clipboard. Copy an image first or paste text into the box.' };
      } catch (e) {
        return { ok: false, error: `Clipboard read denied: ${e.message || e}. Try pressing Ctrl+V inside the text box.` };
      }
    },

    async fetchTransfer(id) {
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked.' };
      }
      const res = await mgr.cloud.rpc('besing_transfer_get', { p_id: String(id || '') }, { trafficKind: 'pull' });
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Failed to fetch item' };
      return { ok: true, item: res.data };
    },

    async deleteTransfer(id) {
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked.' };
      }
      const res = await mgr.cloud.rpc('besing_transfer_delete', { p_id: String(id || '') }, { trafficKind: 'push' });
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Failed to delete item' };
      return { ok: true };
    },

    triggerDownload(item) {
      if (!item) return false;
      try {
        const blob = item.kind === 'text'
          ? new Blob([item.content || ''], { type: 'text/plain;charset=utf-8' })
          : this._base64ToBlob(item.content || '', item.mime_type);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.file_name || `${(item.title || 'transfer').replace(/[^a-z0-9._-]+/gi, '_')}.${item.kind === 'text' ? 'txt' : 'bin'}`;
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
        return true;
      } catch (e) {
        return false;
      }
    },

    // Open-and-use tool: init/destroy are no-ops so leaving it OFF costs zero page overhead.
    init() {},
    destroy() {}
  };

  if (typeof window !== 'undefined' && window.__BESING_REGISTER__) {
    window.__BESING_REGISTER__(QuickTransfer);
  }
})();
