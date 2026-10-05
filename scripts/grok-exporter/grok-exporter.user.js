// ==UserScript==
// @name         Grok Exporter
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Copy or download the full Grok conversation on the current page as Markdown, including messages Grok has not rendered yet.
// @author       BESing Team
// @license      MIT
// @match        https://grok.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const GrokExporter = {
    id: 'grok-exporter',
    name: 'Grok Exporter',
    version: '1.0.0',
    description: 'Copy or download the full Grok conversation on the current page as Markdown, including messages Grok has not rendered yet.',
    category: 'Tools',
    _config: null,
    _toolbarEl: null,
    _watchTimer: null,
    _toastEl: null,
    _toastTimer: null,
    _busy: false,

    // Grok's own web API, called same-origin with the user's session cookies.
    API_BASE: '/rest/app-chat/conversations',
    LOAD_BATCH_SIZE: 75,
    ASSET_BASE: 'https://assets.grok.com/',
    TOOLBAR_ID: 'besing-grok-exporter-toolbar',
    TOAST_ID: 'besing-grok-exporter-toast',

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      if (!this.isGrokHost()) return;
      this._syncToolbar();
      this._watchTimer = setInterval(() => this._syncToolbar(), 1000);
    },

    onConfigChange(newConfig) {
      this._config = newConfig || {};
      this._syncToolbar();
    },

    destroy() {
      if (this._watchTimer) {
        clearInterval(this._watchTimer);
        this._watchTimer = null;
      }
      this._removeToolbar();
      this._hideToast();
    },

    isGrokHost() {
      return /(^|\.)grok\.com$/i.test(window.location.hostname);
    },

    getConversationId() {
      if (!this.isGrokHost()) return null;
      const m = window.location.pathname.match(/\/c\/([A-Za-z0-9-]{8,})/);
      return m ? m[1] : null;
    },

    // ---------- Public actions ----------

    async copyConversation(cfg = this._config) {
      if (!this._beginAction()) return null;
      const exportPromise = this.exportConversation(cfg);
      try {
        let result;
        try {
          // ClipboardItem accepts a promise, which keeps the click's user activation
          // alive while the conversation is still being fetched.
          if (typeof ClipboardItem === 'function' && navigator.clipboard && navigator.clipboard.write) {
            const item = new ClipboardItem({
              'text/plain': exportPromise.then(r => new Blob([r.markdown], { type: 'text/plain' }))
            });
            await navigator.clipboard.write([item]);
            result = await exportPromise;
          } else {
            throw new Error('ClipboardItem unavailable');
          }
        } catch (clipErr) {
          result = await exportPromise;
          await this._fallbackCopy(result.markdown);
        }
        this.toast(`Copied ${result.messageCount} messages (${this._formatCount(result.markdown.length)} chars)${this._noteSuffix(result)}`, 'ok');
        return result;
      } catch (err) {
        this.toast(`Copy failed: ${err && err.message ? err.message : err}`, 'error');
        return null;
      } finally {
        this._endAction();
      }
    },

    async downloadConversation(cfg = this._config) {
      if (!this._beginAction()) return null;
      try {
        const result = await this.exportConversation(cfg);
        const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this._buildFilename(result.title);
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        this.toast(`Downloaded ${result.messageCount} messages as ${a.download}${this._noteSuffix(result)}`, 'ok');
        return result;
      } catch (err) {
        this.toast(`Download failed: ${err && err.message ? err.message : err}`, 'error');
        return null;
      } finally {
        this._endAction();
      }
    },

    /**
     * Builds the Markdown export for the conversation on the current page.
     * Resolves to { markdown, title, messageCount, branchCount, source }.
     */
    async exportConversation(cfg = this._config) {
      const options = this._resolveOptions(cfg);
      const conversationId = this.getConversationId();
      if (!conversationId) {
        throw new Error('Open a Grok conversation first (URL should look like grok.com/c/...)');
      }

      let messages;
      let branchCount = 1;
      let source = 'api';
      let apiError = null;
      try {
        const fetched = await this._fetchFromApi(conversationId);
        messages = fetched.messages;
        branchCount = fetched.branchCount;
        if (!messages.length) throw new Error('API returned no messages');
      } catch (err) {
        apiError = err;
        console.warn('[BESing Grok Exporter] API export failed, falling back to page scroll capture:', err);
        this.toast('Grok API unavailable, scrolling the page to capture messages...', 'info', 0);
        messages = await this._captureFromDom();
        source = 'dom';
      }
      if (!messages.length) {
        throw apiError || new Error('No messages found on this page');
      }

      const title = await this._fetchTitle(conversationId);
      const markdown = this._toMarkdown({ title, messages, options, source });
      return { markdown, title, messageCount: messages.length, branchCount, source };
    },

    // ---------- Grok API ----------

    async _apiJson(path, init = {}) {
      const res = await fetch(path, {
        credentials: 'include',
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
      });
      if (!res.ok) {
        throw new Error(`Grok API ${init.method || 'GET'} ${path.split('?')[0]} returned HTTP ${res.status}`);
      }
      return res.json();
    },

    async _fetchFromApi(conversationId) {
      const base = `${this.API_BASE}/${encodeURIComponent(conversationId)}`;
      const tree = await this._apiJson(`${base}/response-node?includeThreads=true`);
      const nodes = (tree && (tree.responseNodes || tree.nodes)) || [];
      if (!nodes.length) return { messages: [], branchCount: 0 };

      const ids = nodes.map(n => n.responseId).filter(Boolean);
      const bodies = new Map();
      for (let i = 0; i < ids.length; i += this.LOAD_BATCH_SIZE) {
        const batch = ids.slice(i, i + this.LOAD_BATCH_SIZE);
        const loaded = await this._apiJson(`${base}/load-responses`, {
          method: 'POST',
          body: JSON.stringify({ responseIds: batch })
        });
        const list = Array.isArray(loaded) ? loaded : ((loaded && loaded.responses) || []);
        list.forEach(r => { if (r && r.responseId) bodies.set(r.responseId, r); });
      }

      const { path, branchCount } = this._selectBranch(nodes, bodies, this._visibleResponseIds());
      const messages = [];
      path.forEach(node => {
        const body = bodies.get(node.responseId);
        if (!body) return;
        const msg = this._normalizeApiMessage(body, node);
        if (msg.text || msg.images.length || msg.attachmentCount) messages.push(msg);
      });
      return { messages, branchCount };
    },

    async _fetchTitle(conversationId) {
      try {
        const meta = await this._apiJson(`${this.API_BASE}/${encodeURIComponent(conversationId)}`);
        const t = meta && (meta.title || (meta.conversation && meta.conversation.title));
        if (t && String(t).trim()) return String(t).trim();
      } catch (e) {}
      const docTitle = (document.title || '').replace(/\s*[-|–]\s*Grok\s*$/i, '').trim();
      return docTitle && docTitle.toLowerCase() !== 'grok' ? docTitle : 'Grok Conversation';
    },

    /**
     * Grok stores a conversation as a tree: regenerating or editing a message starts a branch.
     * Picks the root-to-leaf path that contains the most responses mounted on the page
     * (the branch the user is looking at), breaking ties by the newest leaf.
     */
    _selectBranch(nodes, bodies, preferredIds) {
      const byId = new Map();
      nodes.forEach(n => { if (n && n.responseId) byId.set(n.responseId, n); });
      const parents = new Set();
      byId.forEach(n => { if (n.parentResponseId) parents.add(n.parentResponseId); });
      const leaves = [...byId.values()].filter(n => !parents.has(n.responseId));
      const order = new Map([...byId.keys()].map((id, idx) => [id, idx]));

      let best = null;
      leaves.forEach(leaf => {
        const path = [];
        const seen = new Set();
        let cur = leaf;
        while (cur && !seen.has(cur.responseId)) {
          seen.add(cur.responseId);
          path.push(cur);
          cur = cur.parentResponseId ? byId.get(cur.parentResponseId) : null;
        }
        path.reverse();
        const score = path.reduce((acc, n) => acc + (preferredIds.has(n.responseId) ? 1 : 0), 0);
        const body = bodies.get(leaf.responseId);
        const parsed = body && body.createTime ? Date.parse(body.createTime) : NaN;
        const time = isNaN(parsed) ? (order.get(leaf.responseId) || 0) : parsed;
        if (!best || score > best.score || (score === best.score && time > best.time)) {
          best = { path, score, time };
        }
      });
      return { path: best ? best.path : [], branchCount: Math.max(1, leaves.length) };
    },

    _visibleResponseIds() {
      const ids = new Set();
      document.querySelectorAll('[id^="response-"]').forEach(el => {
        const id = el.id.slice('response-'.length);
        if (id) ids.add(id);
      });
      const rid = new URLSearchParams(window.location.search).get('rid');
      if (rid) ids.add(rid);
      return ids;
    },

    _normalizeApiMessage(body, node) {
      const sender = String(body.sender || node.sender || '').toLowerCase();
      const isUser = sender === 'human' || sender === 'user';
      let text = typeof body.message === 'string' ? body.message : '';
      if (isUser && !text.trim() && typeof body.query === 'string') text = body.query;

      const images = (Array.isArray(body.generatedImageUrls) ? body.generatedImageUrls : [])
        .filter(u => typeof u === 'string' && u.trim())
        .map(u => (/^https?:\/\//i.test(u) ? u : this.ASSET_BASE + u.replace(/^\/+/, '')));

      const sources = (Array.isArray(body.webSearchResults) ? body.webSearchResults : [])
        .filter(s => s && typeof s.url === 'string')
        .map(s => ({ url: s.url, title: (s.title || s.url).toString().trim() }));

      return {
        role: isUser ? 'user' : 'assistant',
        text: this._cleanText(text),
        thinking: typeof body.thinkingTrace === 'string' ? body.thinkingTrace.trim() : '',
        createTime: body.createTime || '',
        images,
        sources,
        attachmentCount: Array.isArray(body.fileAttachments) ? body.fileAttachments.length : 0
      };
    },

    _cleanText(text) {
      return String(text || '')
        // Inline citation cards are UI markup that renders as nothing useful outside Grok.
        .replace(/<grok:render\b[\s\S]*?<\/grok:render>/gi, '')
        .replace(/<grok:render\b[^>]*\/>/gi, '')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
    },

    // ---------- DOM fallback ----------

    /**
     * Grok virtualizes its transcript, so only nearby messages are mounted.
     * Scrolls the transcript top to bottom and collects each message as it mounts.
     */
    async _captureFromDom() {
      const first = document.querySelector('[id^="response-"]');
      if (!first) return [];
      const scroller = this._findScrollContainer(first);
      const originalTop = scroller.scrollTop;
      const collected = new Map();
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const collect = () => {
        document.querySelectorAll('[id^="response-"]').forEach(el => {
          if (collected.has(el.id)) return;
          const content = el.querySelector('.response-content-markdown') || el;
          const text = (content.innerText || '').trim();
          if (!text) return;
          collected.set(el.id, {
            role: el.classList.contains('items-end') ? 'user' : 'assistant',
            text,
            thinking: '',
            createTime: '',
            images: [],
            sources: [],
            attachmentCount: 0
          });
        });
      };

      // Reach the true top first: Grok loads older turns as the top comes into view.
      let lastHeight = -1;
      for (let i = 0; i < 40; i++) {
        scroller.scrollTop = 0;
        await wait(400);
        if (scroller.scrollHeight === lastHeight && scroller.scrollTop === 0) break;
        lastHeight = scroller.scrollHeight;
      }

      let stalled = 0;
      for (let i = 0; i < 2000 && stalled < 3; i++) {
        collect();
        const before = scroller.scrollTop;
        scroller.scrollTop = before + Math.max(200, scroller.clientHeight * 0.7);
        await wait(250);
        stalled = scroller.scrollTop <= before ? stalled + 1 : 0;
      }
      collect();
      scroller.scrollTop = originalTop;
      return [...collected.values()];
    },

    _findScrollContainer(el) {
      let cur = el.parentElement;
      while (cur && cur !== document.body) {
        const style = window.getComputedStyle(cur);
        if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight + 10) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    },

    // ---------- Markdown ----------

    _resolveOptions(cfg) {
      const c = cfg || {};
      return {
        includeThinking: c.includeThinking === true,
        includeTimestamps: c.includeTimestamps === true,
        includeSources: c.includeSources === true
      };
    },

    _toMarkdown({ title, messages, options, source }) {
      const lines = [];
      lines.push(`# ${title}`, '');
      lines.push(`Exported from Grok on ${new Date().toLocaleString()} · ${window.location.origin}${window.location.pathname}`);
      if (source === 'dom') {
        lines.push('', '> Captured from the rendered page because the Grok API was unavailable. Formatting such as code fences and tables may be simplified.');
      }
      lines.push('');

      messages.forEach(msg => {
        lines.push('---', '');
        let heading = msg.role === 'user' ? '## User' : '## Grok';
        if (options.includeTimestamps && msg.createTime) {
          const d = new Date(msg.createTime);
          if (!isNaN(d.getTime())) heading += ` · ${d.toLocaleString()}`;
        }
        lines.push(heading, '');

        if (options.includeThinking && msg.thinking) {
          lines.push('<details>', '<summary>Thinking</summary>', '', msg.thinking, '', '</details>', '');
        }
        if (msg.attachmentCount) {
          lines.push(`*[${msg.attachmentCount} attachment${msg.attachmentCount > 1 ? 's' : ''} not included]*`, '');
        }
        if (msg.text) lines.push(msg.text, '');
        msg.images.forEach((url, idx) => lines.push(`![Generated image ${idx + 1}](${url})`, ''));
        if (options.includeSources && msg.sources.length) {
          lines.push('**Sources**', '');
          msg.sources.forEach(s => lines.push(`- [${s.title.replace(/[\[\]]/g, '')}](${s.url})`));
          lines.push('');
        }
      });

      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    },

    _buildFilename(title) {
      const safe = String(title || 'Grok Conversation')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Grok Conversation';
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `Grok - ${safe} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
    },

    _noteSuffix(result) {
      const notes = [];
      if (result.branchCount > 1) notes.push(`current branch of ${result.branchCount}`);
      if (result.source === 'dom') notes.push('page capture');
      return notes.length ? ` (${notes.join(', ')})` : '';
    },

    _formatCount(n) {
      return Number(n).toLocaleString();
    },

    async _fallbackCopy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch (e) {}
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (!ok) {
        throw new Error('Clipboard blocked by the browser. Use Download instead.');
      }
    },

    _beginAction() {
      if (this._busy) {
        this.toast('Export already in progress...', 'info');
        return false;
      }
      this._busy = true;
      this._setToolbarBusy(true);
      this.toast('Loading the full conversation...', 'info', 0);
      return true;
    },

    _endAction() {
      this._busy = false;
      this._setToolbarBusy(false);
    },

    // ---------- Page UI (built with DOM APIs; no innerHTML, for Trusted Types pages) ----------

    _svg(paths) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '15');
      svg.setAttribute('height', '15');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      paths.forEach(([tag, attrs]) => {
        const el = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        svg.appendChild(el);
      });
      return svg;
    },

    _makeButton(label, title, icon, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = title;
      btn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:1px solid rgba(129,140,248,0.45);background:rgba(15,23,42,0.92);color:#e0e7ff;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,0.35);transition:transform 0.15s ease,border-color 0.15s ease,opacity 0.15s ease;';
      btn.appendChild(icon);
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'rgba(165,180,252,0.9)'; btn.style.transform = 'translateY(-1px)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'rgba(129,140,248,0.45)'; btn.style.transform = ''; });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return btn;
    },

    _syncToolbar() {
      const shouldShow = this.isGrokHost() && !!this.getConversationId() && (this._config || {}).showFloatingButtons !== false;
      if (!shouldShow) {
        this._removeToolbar();
        return;
      }
      if (this._toolbarEl && this._toolbarEl.isConnected) return;
      this._removeToolbar();

      const bar = document.createElement('div');
      bar.id = this.TOOLBAR_ID;
      bar.style.cssText = 'position:fixed;right:16px;bottom:140px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';
      bar.appendChild(this._makeButton('Copy chat', 'Copy the full conversation as Markdown', this._svg([
        ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }],
        ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
      ]), () => this.copyConversation()));
      bar.appendChild(this._makeButton('Download .md', 'Download the full conversation as a Markdown file', this._svg([
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
        ['polyline', { points: '7 10 12 15 17 10' }],
        ['line', { x1: '12', y1: '15', x2: '12', y2: '3' }]
      ]), () => this.downloadConversation()));

      (document.body || document.documentElement).appendChild(bar);
      this._toolbarEl = bar;
      this._setToolbarBusy(this._busy);
    },

    _removeToolbar() {
      if (this._toolbarEl) {
        this._toolbarEl.remove();
        this._toolbarEl = null;
      }
      const stray = document.getElementById(this.TOOLBAR_ID);
      if (stray) stray.remove();
    },

    _setToolbarBusy(busy) {
      if (!this._toolbarEl) return;
      this._toolbarEl.querySelectorAll('button').forEach(b => {
        b.disabled = busy;
        b.style.opacity = busy ? '0.55' : '1';
        b.style.cursor = busy ? 'progress' : 'pointer';
      });
    },

    toast(message, kind = 'info', durationMs = 3500) {
      this._hideToast();
      const colors = {
        ok: ['#34d399', 'rgba(52,211,153,0.45)'],
        error: ['#f87171', 'rgba(248,113,113,0.5)'],
        info: ['#93c5fd', 'rgba(147,197,253,0.45)']
      };
      const [fg, border] = colors[kind] || colors.info;
      const t = document.createElement('div');
      t.id = this.TOAST_ID;
      t.textContent = message;
      t.style.cssText = `position:fixed;top:24px;right:24px;max-width:min(420px,calc(100vw - 48px));background:#0f172a;color:${fg};border:1px solid ${border};padding:10px 16px;border-radius:10px;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.5);z-index:2147483647;transition:opacity 0.3s ease;`;
      (document.body || document.documentElement).appendChild(t);
      this._toastEl = t;
      if (durationMs > 0) {
        this._toastTimer = setTimeout(() => {
          t.style.opacity = '0';
          setTimeout(() => { if (this._toastEl === t) this._hideToast(); }, 300);
        }, durationMs);
      }
    },

    _hideToast() {
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }
      if (this._toastEl) {
        this._toastEl.remove();
        this._toastEl = null;
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['grok-exporter'] = GrokExporter;
    if (!window.__BESING_EMBEDDED__) {
      GrokExporter.init();
    }
  }
})();
