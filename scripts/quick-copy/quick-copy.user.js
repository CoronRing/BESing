// ==UserScript==
// @name         Page Copy
// @namespace    https://github.com/CoronRing/BESing
// @version      2.0.0
// @description  Copy link, Markdown, HTML, or full WARC archive with media.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const QuickCopy = {
    id: 'quick-copy',
    name: 'Page Copy',
    version: '2.0.0',
    activationMode: 'none',
    description: 'Copy link, Markdown, HTML, or full WARC archive with media.',
    category: 'Tools',
    MAX_CLIPBOARD_HTML_BYTES: 1500000,
    MAX_WARC_ASSETS: 60,
    MAX_WARC_TOTAL_BYTES: 25 * 1024 * 1024,

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    _slug(ext) {
      const base = (document.title || window.location.hostname || 'page')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'page';
      const stamp = new Date().toISOString().slice(0, 10);
      return `${base}-${stamp}.${ext}`;
    },

    async _copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) {
        return false;
      }
    },

    async _promptSaveFile(blob, filename, mimeType) {
      const mgr = this._manager();
      if (mgr) mgr._suppressOutsideCloseUntil = Date.now() + 800;

      // Prefer native Save As dialog when available so user can cancel cleanly if they only wanted clipboard.
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const ext = '.' + (filename.split('.').pop() || 'txt');
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: ext.toUpperCase().slice(1) + ' File', accept: { [mimeType || 'application/octet-stream']: [ext] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return { saved: true, cancelled: false };
        } catch (err) {
          if (err && err.name === 'AbortError') return { saved: false, cancelled: true };
        }
      }

      // Universal fallback (iOS Safari, mobile browsers, Firefox)
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        a.addEventListener('click', (ev) => ev.stopPropagation());
        const host = (mgr && mgr.shadow) ? mgr.shadow : (document.body || document.documentElement);
        host.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
        return { saved: true, cancelled: false };
      } catch (e) {
        return { saved: false, cancelled: false, error: e.message || String(e) };
      }
    },

    // 1. Copy Markdown link: [Title](URL)
    async copyLink() {
      const title = (document.title || window.location.hostname || 'Untitled').replace(/[\[\]]/g, '').trim();
      const md = `[${title}](${window.location.href})`;
      const ok = await this._copyText(md);
      return { ok, text: md, msg: ok ? 'Copied link.' : 'Copy blocked by browser.' };
    },

    // Convert DOM subtree to clean text-only Markdown (omitting media, scripts, nav, and BESing UI).
    _extractMarkdown() {
      const root = document.querySelector('article, main, [role="main"]') || document.body || document.documentElement;
      const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
      const skipClosest = (el) => el.id === '__besing_root__' || el.tagName === 'BESING-HOST' || (el.id && el.id.startsWith('besing-'));

      const walk = (node, listDepth = 0) => {
        if (!node) return '';
        if (node.nodeType === 3) {
          return (node.nodeValue || '').replace(/\s+/g, ' ');
        }
        if (node.nodeType !== 1) return '';
        if (skipTags.has(node.tagName) || skipClosest(node)) return '';
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return '';

        const tag = node.tagName;
        const inner = () => Array.from(node.childNodes).map(c => walk(c, listDepth)).join('');

        if (/^H[1-6]$/.test(tag)) {
          const t = inner().trim();
          return t ? `\n\n${'#'.repeat(Number(tag[1]))} ${t}\n\n` : '';
        }
        if (tag === 'PRE') {
          const code = (node.textContent || '').replace(/\n+$/, '');
          return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : '';
        }
        if (tag === 'CODE') {
          const t = (node.textContent || '').trim();
          return t ? `\`${t.replace(/`/g, "'")}\`` : '';
        }
        if (tag === 'BLOCKQUOTE') {
          const t = inner().trim();
          return t ? `\n\n${t.split('\n').map(l => `> ${l}`).join('\n')}\n\n` : '';
        }
        if (tag === 'A') {
          const t = inner().trim();
          const href = node.href || '';
          if (!t) return '';
          if (/^https?:\/\//i.test(href)) return `[${t}](${href})`;
          return t;
        }
        if (tag === 'STRONG' || tag === 'B') {
          const t = inner().trim();
          return t ? `**${t}**` : '';
        }
        if (tag === 'EM' || tag === 'I') {
          const t = inner().trim();
          return t ? `*${t}*` : '';
        }
        if (tag === 'BR') return '\n';
        if (tag === 'HR') return '\n\n---\n\n';
        if (tag === 'LI') {
          const indent = '  '.repeat(Math.max(0, listDepth - 1));
          const t = Array.from(node.childNodes).map(c => walk(c, listDepth)).join('').trim();
          return t ? `${indent}- ${t}\n` : '';
        }
        if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(node.childNodes).map(c => walk(c, listDepth + 1)).join('');
          return items ? `\n${items}\n` : '';
        }
        if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'HEADER' || tag === 'TR') {
          const t = inner().trim();
          return t ? `\n\n${t}\n\n` : '';
        }
        if (tag === 'TD' || tag === 'TH') {
          const t = inner().trim();
          return t ? `${t} | ` : '';
        }
        return inner();
      };

      const title = (document.title || window.location.hostname || 'Untitled').trim();
      const bodyMd = walk(root, 0)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return `# ${title}\n\nSource: ${window.location.href}\n\n${bodyMd}\n`;
    },

    // 2. Copy text-only Markdown to clipboard + prompt file save (.md)
    async copyMarkdown() {
      const md = this._extractMarkdown();
      const copied = await this._copyText(md);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const saveRes = await this._promptSaveFile(blob, this._slug('md'), 'text/markdown');
      const kb = (blob.size / 1024).toFixed(1);
      if (saveRes.cancelled) {
        return { ok: copied, msg: copied ? `Copied Markdown (${kb} KB). Save dismissed.` : 'Save cancelled.' };
      }
      return { ok: true, msg: `${copied ? 'Copied & saved' : 'Saved'} Markdown (${kb} KB).` };
    },

    _serializeCleanHtml() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('#__besing_root__, besing-host, #besing-bg-preset-overlay, #besing-bg-brightness-overlay, #besing-night-dimmer-overlay, #besing-text-color-style, #besing-text-size-style, #besing-ad-cleaner-style').forEach(el => el.remove());
      return '<!DOCTYPE html>\n' + clone.outerHTML;
    },

    // 3. Copy HTML to clipboard (if <= 1.5 MB) + prompt file save (.html)
    async copyHtml() {
      const html = this._serializeCleanHtml();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      let copied = false;
      let tooLarge = false;
      if (blob.size <= this.MAX_CLIPBOARD_HTML_BYTES) {
        copied = await this._copyText(html);
      } else {
        tooLarge = true;
      }
      const saveRes = await this._promptSaveFile(blob, this._slug('html'), 'text/html');
      const kb = (blob.size / 1024).toFixed(1);
      if (saveRes.cancelled) {
        if (tooLarge) return { ok: false, msg: `HTML too large for clipboard (${kb} KB). Save dismissed.` };
        return { ok: copied, msg: copied ? `Copied HTML (${kb} KB). Save dismissed.` : 'Save cancelled.' };
      }
      if (tooLarge) return { ok: true, msg: `Saved HTML (${kb} KB, skipped clipboard size limit).` };
      return { ok: true, msg: `${copied ? 'Copied & saved' : 'Saved'} HTML (${kb} KB).` };
    },

    async _fetchAssetBytes(url) {
      // Try native fetch first (fast for same-origin & CORS assets)
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          return {
            ok: true,
            bytes: new Uint8Array(buf),
            contentType: res.headers.get('content-type') || 'application/octet-stream',
            status: res.status
          };
        }
      } catch (e) {}

      // Fallback to GM_xmlhttpRequest in Tampermonkey/Stay to capture cross-origin media
      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve) => {
          try {
            GM_xmlhttpRequest({
              method: 'GET',
              url,
              responseType: 'arraybuffer',
              timeout: 6000,
              onload: (r) => {
                if (r.status >= 200 && r.status < 300 && r.response) {
                  let ct = 'application/octet-stream';
                  const m = String(r.responseHeaders || '').match(/content-type:\s*([^\r\n]+)/i);
                  if (m) ct = m[1].trim();
                  resolve({ ok: true, bytes: new Uint8Array(r.response), contentType: ct, status: r.status });
                } else {
                  resolve({ ok: false });
                }
              },
              onerror: () => resolve({ ok: false }),
              ontimeout: () => resolve({ ok: false })
            });
          } catch (e) {
            resolve({ ok: false });
          }
        });
      }
      return { ok: false };
    },

    _uuid() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },

    _buildWarcRecord(headersObj, payloadBytes) {
      const enc = new TextEncoder();
      const lines = ['WARC/1.0'];
      Object.keys(headersObj).forEach(k => {
        if (headersObj[k] !== undefined && headersObj[k] !== null) {
          lines.push(`${k}: ${headersObj[k]}`);
        }
      });
      lines.push(`Content-Length: ${payloadBytes.byteLength}`);
      lines.push('', '');
      const headBytes = enc.encode(lines.join('\r\n'));
      const tailBytes = enc.encode('\r\n\r\n');
      const out = new Uint8Array(headBytes.byteLength + payloadBytes.byteLength + tailBytes.byteLength);
      out.set(headBytes, 0);
      out.set(payloadBytes, headBytes.byteLength);
      out.set(tailBytes, headBytes.byteLength + payloadBytes.byteLength);
      return out;
    },

    _buildHttpResponsePayload(status, contentType, bodyBytes) {
      const enc = new TextEncoder();
      const httpHead = enc.encode(
        `HTTP/1.1 ${status || 200} OK\r\nContent-Type: ${contentType || 'application/octet-stream'}\r\nContent-Length: ${bodyBytes.byteLength}\r\n\r\n`
      );
      const out = new Uint8Array(httpHead.byteLength + bodyBytes.byteLength);
      out.set(httpHead, 0);
      out.set(bodyBytes, httpHead.byteLength);
      return out;
    },

    // 4. Save ISO 28500 WARC archive including main HTML + page media (images, stylesheets, posters, audio)
    async saveWarc(onProgress) {
      const enc = new TextEncoder();
      const warcDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const filename = this._slug('warc');
      const chunks = [];
      let totalBytes = 0;

      const infoPayload = enc.encode(
        `software: BESing Page Copy/${this.version}\r\nformat: WARC File Format 1.0\r\nconformsTo: http://bibnum.bnf.fr/WARC/WARC_ISO_28500_version1_latestdraft.pdf\r\n`
      );
      const infoRec = this._buildWarcRecord({
        'WARC-Type': 'warcinfo',
        'WARC-Date': warcDate,
        'WARC-Filename': filename,
        'WARC-Record-ID': `<urn:uuid:${this._uuid()}>`,
        'Content-Type': 'application/warc-fields'
      }, infoPayload);
      chunks.push(infoRec);
      totalBytes += infoRec.byteLength;

      // Main page HTML response record
      const htmlBytes = enc.encode(this._serializeCleanHtml());
      const mainPayload = this._buildHttpResponsePayload(200, 'text/html; charset=utf-8', htmlBytes);
      const mainRec = this._buildWarcRecord({
        'WARC-Type': 'response',
        'WARC-Target-URI': window.location.href,
        'WARC-Date': warcDate,
        'WARC-Record-ID': `<urn:uuid:${this._uuid()}>`,
        'Content-Type': 'application/http; msgtype=response'
      }, mainPayload);
      chunks.push(mainRec);
      totalBytes += mainRec.byteLength;

      // Collect unique media & stylesheet URLs on the page
      const assetUrls = [];
      const seen = new Set([window.location.href]);
      const addUrl = (raw) => {
        if (!raw || assetUrls.length >= this.MAX_WARC_ASSETS) return;
        try {
          const abs = new URL(raw, window.location.href).href;
          if (!/^https?:\/\//i.test(abs) || seen.has(abs)) return;
          seen.add(abs);
          assetUrls.push(abs);
        } catch (e) {}
      };

      document.querySelectorAll('img[src], img[currentSrc]').forEach(img => {
        if (img.closest('#__besing_root__')) return;
        addUrl(img.currentSrc || img.src);
      });
      document.querySelectorAll('link[rel="stylesheet"][href], link[rel~="icon"][href]').forEach(l => addUrl(l.href));
      document.querySelectorAll('video[poster]').forEach(v => addUrl(v.getAttribute('poster')));
      document.querySelectorAll('video[src], audio[src], source[src]').forEach(m => addUrl(m.src));

      let packedCount = 0;
      for (let i = 0; i < assetUrls.length; i++) {
        if (totalBytes >= this.MAX_WARC_TOTAL_BYTES) break;
        if (typeof onProgress === 'function') {
          onProgress(`Packing media ${i + 1}/${assetUrls.length}...`);
        }
        const assetUrl = assetUrls[i];
        const fetched = await this._fetchAssetBytes(assetUrl);
        if (!fetched || !fetched.ok || !fetched.bytes || fetched.bytes.byteLength === 0) continue;
        if (totalBytes + fetched.bytes.byteLength > this.MAX_WARC_TOTAL_BYTES) continue;

        const payload = this._buildHttpResponsePayload(fetched.status || 200, fetched.contentType, fetched.bytes);
        const rec = this._buildWarcRecord({
          'WARC-Type': 'response',
          'WARC-Target-URI': assetUrl,
          'WARC-Date': warcDate,
          'WARC-Record-ID': `<urn:uuid:${this._uuid()}>`,
          'Content-Type': 'application/http; msgtype=response'
        }, payload);
        chunks.push(rec);
        totalBytes += rec.byteLength;
        packedCount++;
      }

      const blob = new Blob(chunks, { type: 'application/warc' });
      const saveRes = await this._promptSaveFile(blob, filename, 'application/warc');
      const sizeStr = blob.size >= 1048576 ? `${(blob.size / 1048576).toFixed(2)} MB` : `${(blob.size / 1024).toFixed(1)} KB`;
      if (saveRes.cancelled) {
        return { ok: false, msg: `WARC save dismissed (${packedCount} media, ${sizeStr}).` };
      }
      return { ok: true, msg: `Saved WARC (${packedCount} media, ${sizeStr}).`, mediaCount: packedCount, sizeBytes: blob.size };
    },

    init() {},
    destroy() {}
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['quick-copy'] = QuickCopy;
  }
})();
