// ==UserScript==
// @name         PageStream
// @namespace    https://github.com/CoronRing/BESing
// @version      1.2.0
// @description  Continuous page streaming via smart pagination detection and automated clicks for infinite scrolling with rate limiting and IP flood protection.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PageStream = {
    id: 'pagestream',
    name: 'PageStream',
    version: '1.2.0',
    description: 'Auto-stream infinite pages by automated click or URL fetch splicing. Supports intelligent pagination detection, history sync, and customizable preload.',
    category: 'Productivity',

    // Runtime state
    _active: false,
    _config: {
      whenToLoad: 'bottom', // 'start', 'half point', 'bottom' (90%)
      preloadPages: 1,      // default: 1
      enableHistory: true,  // default: true
      mode: 'auto',         // 'auto', 'splice', 'click'
      customNextSelector: '',
      customPageSelector: ''
    },

    _curPageNum: 1,
    _initialUrl: '',
    _initialTitle: '',
    _currentNextUrl: null,
    _currentNextElement: null,
    _pageCache: [], // Preloaded pages [{ pageNum, url, title, contentNodes, nextUrl }]
    _pushedUrls: new Set(),
    _loadedUrls: new Set(),
    _observer: null,
    _scrollHandler: null,
    _popstateHandler: null,
    _styleEl: null,
    _isLoading: false,
    _isPreloading: false,
    _preloadTimer: null,
    _preloadPromise: null,  // in-flight background preload, awaited by the scroll trigger
    _lastStreamTime: 0,
    _lastFetchTime: 0,
    _minStreamInterval: 2500, // Minimum 2.5s between page loads
    _minFetchInterval: 1500,  // Minimum 1.5s between network fetches
    _hasEnded: false,
    _consecutiveErrors: 0,
    _maxPagesPerSession: 50,  // Circuit breaker: max 50 streamed pages per session
    _rule: null,
    _liveMainSignature: null, // selector of page 1's content container, reused on fetched pages
    _maxContentScripts: 3,    // document.write content scripts resolved per fetched page

    // Built-in site rules (Pagetual format compatible)
    _builtinRules: [
      {
        name: 'shudugu',
        url: '^https?://(?:www\\.)?shudugu\\.org/',
        nextLink: '#next_url, .bottem2 a:last-child, .bottem1 a:last-child, a:contains("下一页"), a:contains("下一章")',
        pageElement: '#content, #txtContent, .chaptercontent, .content',
        replace: '.bottem2, .bottem1, .page_chapter',
        filter: '.ad-banner, ins, .read_ads'
      },
      {
        // Pages 2+ of each chapter write their text from /i/a.aspx with document.write.
        name: 'suduguu',
        url: '^https?://(?:www\\.|m\\.)?suduguu\\.com/\\d+/\\d+(?:-\\d+)?\\.html',
        nextLink: '.prenext a:contains("下一页"), .prenext a:contains("下一章")',
        pageElement: '.con',
        replace: '.prenext'
      },
      {
        name: 'biquge',
        url: '^https?://(?:www\\.)?(?:biquge|xbiquge|bqg)\\w*\\.',
        nextLink: '#next_url, .bottem2 a:last-child, a.next, a:contains("下一页"), a:contains("下一章")',
        pageElement: '#content, #htmlContent, .showtxt',
        replace: '.bottem2, .page_chapter'
      },
      {
        name: 'generic-novel',
        url: '^https?://.*novel.*',
        nextLink: 'a[rel="next"], a.next, .next>a, a:contains("下一章"), a:contains("下一页")',
        pageElement: '#content, .content, .read-content, #chaptercontent, article'
      },
      {
        name: 'google-search',
        url: '^https?://(?:www\\.)?google\\.[a-z.]+/search',
        nextLink: '#pnnext, a[aria-label="Next page"]',
        pageElement: '#search, #rso',
        replace: '#rcnt #navcnt'
      },
      {
        name: 'bing-search',
        url: '^https?://(?:www\\.)?bing\\.com/search',
        nextLink: 'a.sb_pagN, a[title="Next page"]',
        pageElement: '#b_results',
        replace: '.b_pag'
      },
      {
        name: 'baidu-search',
        url: '^https?://(?:www\\.)?baidu\\.com/s',
        nextLink: 'a.n:last-child, a:contains("下一页>")',
        pageElement: '#content_left',
        replace: '#page'
      }
    ],

    init(config = {}) {
      if (this._active) {
        this.destroy();
      }
      this._active = true;
      this._config = {
        whenToLoad: config.whenToLoad || 'bottom',
        preloadPages: config.preloadPages !== undefined ? Number(config.preloadPages) : 1,
        enableHistory: config.enableHistory !== false,
        mode: config.mode || 'auto',
        customNextSelector: config.customNextSelector || '',
        customPageSelector: config.customPageSelector || ''
      };

      this._curPageNum = 1;
      this._initialUrl = window.location.href;
      this._initialTitle = document.title;
      this._loadedUrls = new Set([this._initialUrl]);
      this._pushedUrls = new Set([this._initialUrl]);
      this._pageCache = [];
      this._isLoading = false;
      this._isPreloading = false;
      this._preloadTimer = null;
      this._lastStreamTime = 0;
      this._lastFetchTime = 0;
      this._hasEnded = false;
      this._consecutiveErrors = 0;

      this._injectStyles();
      this._matchRule();
      this._liveMainSignature = this._signatureOf(this._findMainContentElement(document));
      this._setupNextLink();
      this._setupScrollListener();
      this._setupHistoryObserver();

      // Trigger initial preload if configured (polite 2500ms delay to allow initial page to settle)
      if (this._config.preloadPages > 0) {
        this._schedulePreload(2500);
      }

      console.log(`[PageStream] Initialized (When: ${this._config.whenToLoad}, Preload: ${this._config.preloadPages}, History: ${this._config.enableHistory})`);
    },

    destroy() {
      if (!this._active) return;
      this._active = false;

      if (this._preloadTimer) {
        clearTimeout(this._preloadTimer);
        this._preloadTimer = null;
      }
      if (this._scrollHandler) {
        window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = null;
      }
      if (this._popstateHandler) {
        window.removeEventListener('popstate', this._popstateHandler);
        this._popstateHandler = null;
      }
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._styleEl && this._styleEl.parentNode) {
        this._styleEl.parentNode.removeChild(this._styleEl);
        this._styleEl = null;
      }

      // Remove streamed dividers
      document.querySelectorAll('.pagestream-divider, .pagestream-streamed-block, .pagestream-continue').forEach(el => {
        el.remove();
      });

      this._pageCache = [];
      this._loadedUrls.clear();
      this._pushedUrls.clear();
      console.log('[PageStream] Destroyed');
    },

    onConfigChange(newConfig = {}) {
      this._config = {
        ...this._config,
        ...newConfig,
        preloadPages: newConfig.preloadPages !== undefined ? Number(newConfig.preloadPages) : this._config.preloadPages,
        enableHistory: newConfig.enableHistory !== false
      };
      // If rule overrides changed, re-detect next link
      this._setupNextLink();
      if (this._config.preloadPages > 0 && this._pageCache.length === 0) {
        this._schedulePreload(2000);
      }
    },

    // 1. Rule & Selector Matching
    _matchRule() {
      const curHref = window.location.href;
      for (const rule of this._builtinRules) {
        try {
          const reg = new RegExp(rule.url, 'i');
          if (reg.test(curHref)) {
            this._rule = rule;
            console.log(`[PageStream] Matched rule: ${rule.name}`);
            return;
          }
        } catch (e) {}
      }
      this._rule = null;
    },

    _setupNextLink() {
      const doc = document;
      let nextEl = null;

      // 1. User custom selector override
      if (this._config.customNextSelector) {
        try {
          nextEl = this._queryBySelector(this._config.customNextSelector, doc);
        } catch (e) {}
      }

      // 2. Active rule nextLink
      if (!nextEl && this._rule && this._rule.nextLink) {
        nextEl = this._queryBySelector(this._rule.nextLink, doc);
      }

      // 3. Smart Heuristic Detection
      if (!nextEl) {
        nextEl = this._smartDetectNextLink(doc);
      }

      if (nextEl) {
        this._currentNextElement = nextEl;
        const href = this._extractHref(nextEl);
        this._currentNextUrl = this._ruleAllows(href) ? href : null;
      } else {
        this._currentNextElement = null;
        this._currentNextUrl = null;
      }
    },

    // With a site rule, only pages its URL pattern matches are streamed; a finished book's last
    // "next" link often leads to the table of contents instead of another chapter.
    _ruleAllows(url) {
      if (!url || !this._rule || !this._rule.url) return true;
      try {
        return new RegExp(this._rule.url, 'i').test(url);
      } catch (e) {
        return true;
      }
    },

    _extractHref(el, baseUrl = window.location.href) {
      if (!el) return null;
      let rawHref = null;
      if (el.getAttribute) {
        rawHref = el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-url');
      }
      if (!rawHref && el.href) {
        rawHref = el.href;
      }
      if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) return null;
      try {
        return new URL(rawHref, baseUrl).href;
      } catch (e) {
        return null;
      }
    },

    _queryBySelector(selectorStr, root = document) {
      if (!selectorStr) return null;
      const selectors = selectorStr.split(',').map(s => s.trim()).filter(Boolean);
      for (const sel of selectors) {
        if (sel.includes(':contains(')) {
          const m = sel.match(/^(.*?):contains\(['"]?(.*?)['"]?\)$/);
          if (m) {
            const baseTag = m[1] || '*';
            const textMatch = m[2];
            const candidates = root.querySelectorAll(baseTag);
            for (const c of candidates) {
              if (c.textContent && c.textContent.trim().includes(textMatch)) {
                return c;
              }
            }
            continue;
          }
        }
        try {
          const found = root.querySelector(sel);
          if (found) return found;
        } catch (e) {}
      }
      return null;
    },

    _smartDetectNextLink(doc = document) {
      // 1. Standard HTML5 next links
      const relNext = doc.querySelector('a[rel~="next"], link[rel="next"]');
      if (relNext && relNext.href) return relNext;

      // 2. High-confidence class/ID selectors
      const standardSelectors = [
        '#next_url', 'a#next_url', '#next-url', 'a#next-url',
        'a.next', '.next>a', 'a.next_page', '#next_page', '.page-next>a',
        '#next-page', 'a#next-page', '.pagination-next>a', 'a.page-numbers.next',
        '[aria-label="Next"]', '[aria-label="Next page"]', '[aria-label$="next page"]',
        '.pagination .active + li > a', '.pagination .current + a',
        'a#pb_next', 'a#rightFix', 'a#linkNext', 'a.btn-next'
      ];
      for (const sel of standardSelectors) {
        const el = doc.querySelector(sel);
        if (el && (el.href || el.tagName.toLowerCase() === 'button')) return el;
      }

      // 3. Text content heuristic on links
      const nextTexts = [
        '下一页', '下一頁', '下一章', '下页', '后一页', '后一章',
        'next page', 'next chapter', 'next', 'next >', '›', '»'
      ];
      const links = doc.querySelectorAll('a[href], button');
      for (const a of links) {
        const txt = (a.innerText || a.textContent || '').trim().toLowerCase();
        if (!txt) continue;
        for (const target of nextTexts) {
          if (txt === target || (txt.length < 25 && txt.includes(target))) {
            return a;
          }
        }
      }

      // 4. Numeric page increment heuristic
      const numMatch = window.location.href.match(/([?&]p(?:age)?=|\/page\/|\/p\/|\bpage-)(\d+)/i);
      if (numMatch) {
        const nextNum = parseInt(numMatch[2], 10) + 1;
        const pageLink = doc.querySelector(`a[href*="page=${nextNum}"], a[href*="/page/${nextNum}"], a[href*="p=${nextNum}"]`);
        if (pageLink) return pageLink;
      }

      return null;
    },

    _findMainContentElement(doc = document) {
      // 1. Custom page selector override
      if (this._config.customPageSelector) {
        try {
          const el = this._queryBySelector(this._config.customPageSelector, doc);
          if (el) return el;
        } catch (e) {}
      }

      // 2. Active rule pageElement
      if (this._rule && this._rule.pageElement) {
        const el = this._queryBySelector(this._rule.pageElement, doc);
        if (el) return el;
      }

      // 3. On fetched pages, the same container page 1 used
      if (doc !== document && this._liveMainSignature) {
        try {
          const el = doc.querySelector(this._liveMainSignature);
          if (el) return el;
        } catch (e) {}
      }

      // 4. Common content container candidates
      const candidates = [
        '#content', '#txtContent', '#chaptercontent', '.chaptercontent',
        '.novel-content', '.read-content', '.post-content', '.entry-content',
        '.article-content', 'article', 'main', '[role="main"]',
        '#main', '.main-content', '.post', '.results', '#results'
      ];

      for (const sel of candidates) {
        const el = doc.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 100) {
          return el;
        }
      }

      // 5. Heuristic: Find element with highest paragraph / text density
      let bestEl = null;
      let maxScore = 0;
      const divs = doc.querySelectorAll('div, section, article, main');
      for (const d of divs) {
        // Skip nav, header, footer, sidebar, comments
        const cls = (d.className || '') + ' ' + (d.id || '');
        if (/header|footer|nav|sidebar|comment|menu|ad-|banner/i.test(cls)) continue;
        const pCount = d.querySelectorAll('p').length;
        const textLen = (d.innerText || '').length;
        const score = pCount * 150 + textLen;
        if (score > maxScore && textLen > 200) {
          maxScore = score;
          bestEl = d;
        }
      }

      return bestEl || doc.body;
    },

    // CSS selector identifying a content container (id, or tag plus classes), or null for <body>.
    _signatureOf(el) {
      if (!el || !el.tagName || el === el.ownerDocument.body || el === el.ownerDocument.documentElement) return null;
      const esc = (v) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&');
      if (el.id) return `#${esc(el.id)}`;
      const classes = String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      return el.tagName.toLowerCase() + classes.map(c => `.${esc(c)}`).join('');
    },

    // Some sites (many novel sites) write the page text from a script, e.g.
    // <div class="con"><script src="/i/a.aspx?id=1&p=2"></script></div> answering document.write("<p>...</p>").
    // Fetched pages never run scripts, so the text would be missing. This finds such scripts inside
    // content containers, reads the string literals they would write (never executing them), and
    // puts the resulting HTML in the script's place. Only same-origin scripts are fetched.
    async _resolveWrittenContent(doc, pageUrl) {
      const containers = [];
      const ruleEl = (this._config.customPageSelector && this._queryBySelector(this._config.customPageSelector, doc)) ||
        (this._rule && this._rule.pageElement && this._queryBySelector(this._rule.pageElement, doc));
      if (ruleEl) containers.push(ruleEl);
      const contentLike = /(^|[\s_-])(con|content|contents|chapter\w*|txt\w*|text|article|read\w*|book\w*|novel\w*|entry|post)([\s_-]|$)/i;
      const scripts = Array.from(doc.querySelectorAll('body script')).filter(sc => {
        const parent = sc.parentElement;
        if (!parent || parent === doc.body) return false;
        if (containers.some(c => c.contains(sc))) return true;
        return contentLike.test(`${parent.id || ''} ${parent.getAttribute('class') || ''}`);
      }).slice(0, this._maxContentScripts);

      let origin;
      try { origin = new URL(pageUrl).origin; } catch (e) { return 0; }
      let resolved = 0;
      for (const sc of scripts) {
        let code = '';
        const src = sc.getAttribute('src');
        if (src) {
          let abs;
          try { abs = new URL(src, pageUrl); } catch (e) { continue; }
          if (abs.origin !== origin || abs.origin !== window.location.origin) continue;
          try {
            const resp = await fetch(abs.href, { credentials: 'include' });
            if (!resp.ok) continue;
            code = await resp.text();
          } catch (e) {
            continue;
          }
        } else {
          code = sc.textContent || '';
        }
        if (!code || code.length > 2000000) continue;
        const html = this._extractWrittenHtml(code);
        if (!html) continue;
        const written = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
        written.querySelectorAll('script, iframe, object, embed').forEach(n => n.remove());
        const frag = doc.createDocumentFragment();
        Array.from(written.body.childNodes).forEach(n => frag.appendChild(doc.importNode(n, true)));
        sc.replaceWith(frag);
        resolved++;
      }
      return resolved;
    },

    // Concatenates the string literals passed to document.write / document.writeln in `code`.
    _extractWrittenHtml(code) {
      const calls = /document\.write(?:ln)?\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|`((?:[^`\\$]|\\[\s\S])*)`)\s*\)/g;
      let out = '';
      let m;
      while ((m = calls.exec(code)) !== null) {
        const body = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
        out += this._decodeJsString(body);
      }
      return out;
    },

    // Decodes the escapes of a JavaScript string literal body without evaluating it.
    _decodeJsString(body) {
      const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r': '' };
      return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (all, esc) => {
        if (esc[0] === 'u' && esc.length > 1) {
          const hex = esc[1] === '{' ? esc.slice(2, -1) : esc.slice(1);
          try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return ''; }
        }
        if (esc[0] === 'x' && esc.length === 3) return String.fromCharCode(parseInt(esc.slice(1), 16));
        return Object.prototype.hasOwnProperty.call(simple, esc) ? simple[esc] : esc;
      });
    },

    // 2. Scroll & Trigger Evaluation (Requirement 3)
    _setupScrollListener() {
      let ticking = false;
      this._scrollHandler = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          this._checkScrollTrigger();
          ticking = false;
        });
      };
      window.addEventListener('scroll', this._scrollHandler, { passive: true });
    },

    _checkScrollTrigger() {
      if (!this._active || this._isLoading || this._hasEnded) return;

      // Rate limit check: do not evaluate trigger if within cooldown period
      const now = Date.now();
      if (now - this._lastStreamTime < this._minStreamInterval) return;

      // Circuit breaker check
      if (this._curPageNum >= this._maxPagesPerSession) {
        if (!this._hasEnded) {
          console.warn(`[PageStream] Reached maximum safe page limit (${this._maxPagesPerSession}). Halting automatic streaming.`);
          this._showToast(`PageStream: Reached safety limit (${this._maxPagesPerSession} pages). Streaming paused.`);
          this._hasEnded = true;
        }
        return;
      }

      const innerHeight = window.innerHeight;
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      const thresholdMode = this._config.whenToLoad; // 'start' (15%), 'half point' (50%), 'bottom' (90%)

      let shouldTrigger = false;

      if (this._curPageNum === 1) {
        // Page 1: measure progress through the original document
        const scrollHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight
        );
        const scrollBottom = scrollY + innerHeight;
        const progress = scrollHeight > 0 ? (scrollBottom / scrollHeight) : 0;

        if (thresholdMode === 'start') {
          // Trigger at 15% mark or if page is short, but require user to have actually scrolled a bit (>= 80px)
          shouldTrigger = (progress >= 0.15 && scrollY >= 80) || (scrollHeight <= innerHeight * 1.15 && scrollY >= 30);
        } else if (thresholdMode === 'half point') {
          // Trigger at 50% mark
          shouldTrigger = progress >= 0.50;
        } else {
          // 'bottom': Trigger at 90% mark
          shouldTrigger = progress >= 0.90;
        }
      } else {
        // Page N >= 2: measure progress strictly through the LATEST streamed block
        const latestBlock = document.querySelector(`.pagestream-streamed-block[data-pagestream-page="${this._curPageNum}"]`);
        if (!latestBlock) {
          // Fallback if latestBlock DOM element was removed or not found
          const scrollHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          );
          const scrollBottom = scrollY + innerHeight;
          const progress = scrollHeight > 0 ? (scrollBottom / scrollHeight) : 0;
          if (thresholdMode === 'start') {
            shouldTrigger = progress >= 0.85;
          } else if (thresholdMode === 'half point') {
            shouldTrigger = progress >= 0.90;
          } else {
            shouldTrigger = progress >= 0.95;
          }
        } else {
          const rect = latestBlock.getBoundingClientRect();
          const blockHeight = rect.height || latestBlock.offsetHeight || 1;
          // How much of the latest block has entered the viewport
          const scrolledIntoBlock = innerHeight - rect.top;

          // If the top of the block has not entered the viewport, user is still reading previous page!
          if (scrolledIntoBlock <= 0) {
            return;
          }

          const progress = scrolledIntoBlock / blockHeight;

          if (thresholdMode === 'start') {
            // Trigger when user scrolls 15% into this new block
            shouldTrigger = progress >= 0.15;
          } else if (thresholdMode === 'half point') {
            // Trigger when user scrolls 50% into this new block
            shouldTrigger = progress >= 0.50;
          } else {
            // 'bottom': Trigger when user scrolls 90% into this new block
            shouldTrigger = progress >= 0.90;
          }
        }
      }

      if (shouldTrigger) {
        this._streamNextPage();
      }
    },

    // 3. Page Streaming Execution (Fetch/Splice or Click)
    async _streamNextPage() {
      if (this._isLoading || this._hasEnded || !this._active) return;

      const now = Date.now();
      if (now - this._lastStreamTime < this._minStreamInterval) return;

      this._isLoading = true;
      this._lastStreamTime = now;

      try {
        // A background preload may be fetching this very page; wait for it instead of fetching it twice.
        if (this._preloadPromise) {
          try { await this._preloadPromise; } catch (e) {}
          if (!this._active || this._hasEnded) return;
        }

        // 1. Check if we already have preloaded page ready
        if (this._pageCache.length > 0) {
          const cached = this._pageCache.shift();
          this._insertPage(cached);
          // Preload next page politely after 3000ms delay
          this._schedulePreload(3000);
          return;
        }

        // 2. Check mode: Click vs URL Fetch
        const isClickMode = this._config.mode === 'click' ||
          (this._config.mode === 'auto' && this._isClickOnlyElement(this._currentNextElement));

        if (isClickMode && this._currentNextElement) {
          await this._executeAutoClick(this._currentNextElement);
        } else if (this._currentNextUrl) {
          await this._fetchAndSplice(this._currentNextUrl);
        } else {
          console.log('[PageStream] No more pages detected.');
          this._hasEnded = true;
        }
      } catch (err) {
        console.error('[PageStream] Error streaming next page:', err);
      } finally {
        this._isLoading = false;
      }
    },

    _isClickOnlyElement(el) {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return true;
      if (tag === 'a') {
        const href = el.getAttribute('href');
        return !href || href === '#' || href.startsWith('javascript:');
      }
      return true;
    },

    async _executeAutoClick(btn) {
      console.log('[PageStream] Automating click on next button:', btn);
      this._lastStreamTime = Date.now();
      const preCount = document.querySelectorAll('*').length;
      try {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
      } catch (e) {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        btn.dispatchEvent(evt);
      }

      // Wait for DOM mutation or new content
      await new Promise(r => setTimeout(r, 1200));
      const postCount = document.querySelectorAll('*').length;
      if (postCount > preCount) {
        this._curPageNum++;
        this._createDivider(this._curPageNum, window.location.href, document.title || `Page ${this._curPageNum}`);
        this._setupNextLink();
      }
    },

    async _fetchAndSplice(url) {
      if (this._loadedUrls.has(url)) {
        console.log(`[PageStream] URL already loaded or cyclic: ${url}`);
        this._hasEnded = true;
        return;
      }

      console.log(`[PageStream] Fetching next page: ${url}`);
      const pageData = await this._loadRemotePage(url);
      if (!pageData) {
        this._hasEnded = true;
        this._showContinueLink(url);
        return;
      }

      this._loadedUrls.add(url);
      this._insertPage(pageData);

      // Background preload next page if configured (scheduled with a 3500ms delay to be polite to the host)
      this._schedulePreload(3500);
    },

    async _loadRemotePage(url) {
      // Minimum fetch interval throttle
      const now = Date.now();
      const timeSinceLastFetch = now - this._lastFetchTime;
      if (timeSinceLastFetch < this._minFetchInterval) {
        await new Promise(r => setTimeout(r, this._minFetchInterval - timeSinceLastFetch));
      }
      this._lastFetchTime = Date.now();

      try {
        const resp = await fetch(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          credentials: 'include'
        });

        // HTTP Rate limit and Block protection
        if (resp.status === 429) {
          console.error('[PageStream] HTTP 429 Too Many Requests detected. Halting PageStream to prevent IP ban.');
          this._hasEnded = true;
          this._showToast('PageStream: Server rate limit reached (HTTP 429). Streaming stopped to protect your IP.');
          return null;
        }

        if (resp.status === 403) {
          console.error('[PageStream] HTTP 403 Forbidden detected. Halting PageStream.');
          this._hasEnded = true;
          this._showToast('PageStream: Access forbidden (HTTP 403). Streaming stopped.');
          return null;
        }

        if (!resp.ok) {
          console.warn(`[PageStream] Remote page returned HTTP ${resp.status}`);
          this._consecutiveErrors++;
          if (this._consecutiveErrors >= 2) {
            this._hasEnded = true;
            this._showToast(`PageStream: Repeated server errors (HTTP ${resp.status}). Streaming stopped.`);
          }
          return null;
        }

        // Successful response - reset error counter
        this._consecutiveErrors = 0;

        const text = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        await this._resolveWrittenContent(doc, url);

        const title = (doc.querySelector('title') ? doc.querySelector('title').textContent : '') || `Page ${this._curPageNum + 1}`;
        const mainContent = this._findMainContentElement(doc);
        // Splicing a whole <body> would duplicate the site's header, menus and footer.
        if (!mainContent || (mainContent === doc.body && this._liveMainSignature)) {
          console.warn('[PageStream] Could not detect main content container in remote document.');
          this._showToast('PageStream: could not find the text on the next page. Streaming stopped.');
          return null;
        }

        // Clean up unwanted elements inside cloned content
        if (this._rule && this._rule.filter) {
          mainContent.querySelectorAll(this._rule.filter).forEach(e => e.remove());
        }

        // Clean scripts to prevent re-execution/malicious ads
        mainContent.querySelectorAll('script').forEach(s => s.remove());

        if ((mainContent.textContent || '').trim().length < 20 && !mainContent.querySelector('img')) {
          console.warn(`[PageStream] Next page has no readable content: ${url}`);
          this._showToast('PageStream: the next page had no readable text. Streaming stopped.');
          return null;
        }

        // Smart next link extraction from the loaded document
        let nextEl = null;
        if (this._config.customNextSelector) {
          nextEl = this._queryBySelector(this._config.customNextSelector, doc);
        }
        if (!nextEl && this._rule && this._rule.nextLink) {
          nextEl = this._queryBySelector(this._rule.nextLink, doc);
        }
        if (!nextEl) {
          nextEl = this._smartDetectNextLink(doc);
        }

        const nextUrl = this._extractHref(nextEl, url);

        return {
          pageNum: this._curPageNum + 1,
          url,
          title: title.trim(),
          contentNode: document.importNode(mainContent, true),
          nextUrl,
          nextEl
        };
      } catch (e) {
        console.warn('[PageStream] Failed to load remote page:', e);
        this._consecutiveErrors++;
        if (this._consecutiveErrors >= 2) {
          this._hasEnded = true;
        }
        return null;
      }
    },

    _insertPage(pageData) {
      const { url, title, contentNode, nextUrl } = pageData;
      const escUrl = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(url) : String(url).replace(/["\\]/g, '\\$&');
      if (document.querySelector(`.pagestream-streamed-block[data-pagestream-url="${escUrl}"]`)) {
        console.log(`[PageStream] Page already on screen, skipped: ${url}`);
        return;
      }
      // Numbered at insert time: a page preloaded ahead does not know how many pages precede it.
      const pageNum = this._curPageNum + 1;
      this._curPageNum = pageNum;
      this._currentNextUrl = nextUrl;

      if (!nextUrl || this._loadedUrls.has(nextUrl) || nextUrl === window.location.href || !this._ruleAllows(nextUrl)) {
        console.log('[PageStream] No further unique next pages detected.');
        this._currentNextUrl = null;
        this._hasEnded = true;
      }

      // 1. Create clean divider (Cyber-Pet badge, NO TaiChi icon)
      const divider = this._createDivider(pageNum, url, title);

      // 2. Wrap content node in streamed container
      const streamedWrapper = document.createElement('div');
      streamedWrapper.className = 'pagestream-streamed-block';
      streamedWrapper.setAttribute('data-pagestream-page', pageNum);
      streamedWrapper.setAttribute('data-pagestream-url', url);
      streamedWrapper.setAttribute('data-pagestream-title', title);
      streamedWrapper.appendChild(contentNode);

      // 3. Find insertion target: ALWAYS after the latest streamed block if one exists!
      const existingBlocks = document.querySelectorAll('.pagestream-streamed-block');
      const lastBlock = existingBlocks.length > 0 ? existingBlocks[existingBlocks.length - 1] : null;

      if (lastBlock && lastBlock.parentNode) {
        lastBlock.parentNode.insertBefore(divider, lastBlock.nextSibling);
        lastBlock.parentNode.insertBefore(streamedWrapper, divider.nextSibling);
      } else {
        const currentMain = this._findMainContentElement(document);
        if (currentMain && currentMain.parentNode) {
          // Insert after main content container
          currentMain.parentNode.insertBefore(divider, currentMain.nextSibling);
          currentMain.parentNode.insertBefore(streamedWrapper, divider.nextSibling);
        } else {
          document.body.appendChild(divider);
          document.body.appendChild(streamedWrapper);
        }
      }

      // 4. Hide / remove original pagination or replace target from previous page
      if (this._rule && this._rule.replace) {
        document.querySelectorAll(this._rule.replace).forEach(el => {
          el.style.display = 'none';
        });
      }

      // 5. Observe divider and content for History pushState (Requirement 1)
      if (this._observer) {
        this._observer.observe(divider);
        this._observer.observe(streamedWrapper);
      }

      console.log(`[PageStream] Successfully spliced Page ${pageNum}: ${title}`);
    },

    _createDivider(pageNum, url, title) {
      const divider = document.createElement('div');
      divider.className = 'pagestream-divider';
      divider.setAttribute('data-pagestream-page', pageNum);
      divider.setAttribute('data-pagestream-url', url);
      divider.setAttribute('data-pagestream-title', title);

      // Modern Cyber-Pet style divider - clean, minimal, NO TaiChi icon
      divider.innerHTML = `
        <div class="pagestream-divider-line"></div>
        <div class="pagestream-divider-badge">
          <span class="pagestream-badge-icon">📄</span>
          <span class="pagestream-badge-text">Page ${pageNum}: ${this._escapeHtml(title)}</span>
          <a href="${this._escapeHtml(url)}" class="pagestream-badge-link" target="_blank" title="Open original page in new tab">↗</a>
        </div>
        <div class="pagestream-divider-line"></div>
      `;

      return divider;
    },

    // 4. Preload Engine (Requirement 2)
    _schedulePreload(delay = 3000) {
      if (this._preloadTimer) {
        clearTimeout(this._preloadTimer);
        this._preloadTimer = null;
      }
      if (!this._active || this._hasEnded || this._config.preloadPages <= 0) return;

      this._preloadTimer = setTimeout(() => {
        this._preloadTimer = null;
        this._checkAndPreload();
      }, delay);
    },

    async _checkAndPreload() {
      const preloadCount = this._config.preloadPages;
      if (preloadCount <= 0 || !this._active || this._hasEnded || this._isPreloading || this._isLoading) return;

      if (this._pageCache.length < preloadCount && this._currentNextUrl) {
        const targetUrl = this._currentNextUrl;
        if (this._loadedUrls.has(targetUrl)) return;

        this._isPreloading = true;
        console.log(`[PageStream] Preloading background page: ${targetUrl}`);
        this._preloadPromise = (async () => {
          try {
            const preData = await this._loadRemotePage(targetUrl);
            // Dropped if the page was streamed directly while this preload was in flight.
            if (preData && this._active && !this._loadedUrls.has(targetUrl)) {
              this._loadedUrls.add(targetUrl);
              this._pageCache.push(preData);
              this._currentNextUrl = preData.nextUrl;
              console.log(`[PageStream] Background preloaded ${targetUrl} ready in cache.`);
            }
          } catch (e) {
            console.warn('[PageStream] Preload failed:', e);
          } finally {
            this._isPreloading = false;
            this._preloadPromise = null;
          }
        })();
        await this._preloadPromise;
      }
    },

    // 5. History Synchronization (Requirement 1)
    _setupHistoryObserver() {
      if (!this._config.enableHistory) return;

      // Track active page intersection
      this._observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
            const el = entry.target;
            const pageNum = el.getAttribute('data-pagestream-page');
            const pageUrl = el.getAttribute('data-pagestream-url');
            const pageTitle = el.getAttribute('data-pagestream-title');

            if (pageUrl && pageUrl !== window.location.href) {
              this._syncHistory(pageNum, pageUrl, pageTitle);
            }
          }
        });
      }, {
        threshold: [0.1, 0.5],
        rootMargin: '-10% 0px -70% 0px' // Active reading zone
      });

      // Handle browser back/forward buttons
      this._popstateHandler = (e) => {
        if (e.state && e.state.pagestream) {
          const targetPage = e.state.pagestream;
          const targetEl = document.querySelector(`[data-pagestream-page="${targetPage}"]`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      };
      window.addEventListener('popstate', this._popstateHandler);
    },

    _syncHistory(pageNum, pageUrl, pageTitle) {
      if (!this._config.enableHistory || !pageUrl) return;

      const num = parseInt(pageNum, 10);
      const title = pageTitle || document.title;

      try {
        if (!this._pushedUrls.has(pageUrl)) {
          // Push newly scrolled-to page into browser history
          this._pushedUrls.add(pageUrl);
          window.history.pushState({ pagestream: num, url: pageUrl }, title, pageUrl);
          console.log(`[PageStream] History pushState: Page ${num} -> ${pageUrl}`);
        } else {
          // Replace current state when scrolling through already recorded page
          window.history.replaceState({ pagestream: num, url: pageUrl }, title, pageUrl);
        }
      } catch (e) {
        // Cross-origin URL or sandbox origin restriction guard
      }

      if (title) {
        try { document.title = title; } catch (e) {}
      }
    },

    _escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    // When streaming stops on an error, the site's own pagination may already be hidden, so a plain
    // same-tab link to the page that failed is added after the last streamed block.
    _showContinueLink(url) {
      try {
        if (!url || document.getElementById('pagestream-continue')) return;
        const wrap = document.createElement('div');
        wrap.id = 'pagestream-continue';
        wrap.className = 'pagestream-continue';
        const link = document.createElement('a');
        link.href = url;
        link.textContent = 'Continue reading: open the next page';
        wrap.appendChild(link);
        const blocks = document.querySelectorAll('.pagestream-streamed-block');
        const last = blocks.length ? blocks[blocks.length - 1] : this._findMainContentElement(document);
        if (last && last.parentNode && last !== document.body) last.parentNode.insertBefore(wrap, last.nextSibling);
        else (document.body || document.documentElement).appendChild(wrap);
      } catch (e) {}
    },

    _showToast(msg) {
      try {
        let toast = document.getElementById('pagestream-status-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'pagestream-status-toast';
          toast.className = 'pagestream-status-toast';
          (document.body || document.documentElement).appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => {
          if (toast && toast.parentNode) {
            toast.classList.remove('visible');
          }
        }, 4500);
      } catch (e) {}
    },

    // 6. Visual Styles (Divider, Frosted Glass, No TaiChi)
    _injectStyles() {
      if (document.getElementById('pagestream-injected-styles')) return;
      const style = document.createElement('style');
      style.id = 'pagestream-injected-styles';
      style.textContent = `
        .pagestream-divider {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 14px !important;
          margin: 36px 0 !important;
          padding: 10px 0 !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          width: 100% !important;
          box-sizing: border-box !important;
          clear: both !important;
        }
        .pagestream-divider-line {
          flex: 1 !important;
          height: 1px !important;
          background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.4), transparent) !important;
        }
        .pagestream-divider-badge {
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          padding: 6px 14px !important;
          background: rgba(15, 23, 42, 0.85) !important;
          backdrop-filter: blur(8px) !important;
          -webkit-backdrop-filter: blur(8px) !important;
          border: 1px solid rgba(56, 189, 248, 0.35) !important;
          border-radius: 9999px !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 0 10px rgba(56, 189, 248, 0.15) !important;
          color: #f1f5f9 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 12px !important;
          font-weight: 600 !important;
        }
        .pagestream-badge-icon {
          font-size: 13px !important;
        }
        .pagestream-badge-text {
          max-width: 320px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          color: #e2e8f0 !important;
        }
        .pagestream-badge-link {
          color: #38bdf8 !important;
          text-decoration: none !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          margin-left: 2px !important;
          transition: transform 0.15s ease !important;
        }
        .pagestream-badge-link:hover {
          transform: scale(1.2) !important;
          color: #7dd3fc !important;
        }
        .pagestream-streamed-block {
          width: 100% !important;
          box-sizing: border-box !important;
          animation: pagestreamFadeIn 0.35s ease-out !important;
        }
        .pagestream-continue {
          text-align: center !important;
          margin: 28px 0 !important;
        }
        .pagestream-continue a {
          display: inline-block !important;
          padding: 12px 22px !important;
          border-radius: 9999px !important;
          background: rgba(15, 23, 42, 0.85) !important;
          border: 1px solid rgba(56, 189, 248, 0.45) !important;
          color: #38bdf8 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 15px !important;
          font-weight: 600 !important;
          text-decoration: none !important;
        }
        .pagestream-status-toast {
          position: fixed !important;
          bottom: 24px !important;
          left: 50% !important;
          transform: translateX(-50%) translateY(20px) !important;
          background: rgba(15, 23, 42, 0.94) !important;
          backdrop-filter: blur(10px) !important;
          -webkit-backdrop-filter: blur(10px) !important;
          color: #f87171 !important;
          border: 1px solid rgba(248, 113, 113, 0.4) !important;
          border-radius: 9999px !important;
          padding: 8px 18px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
          z-index: 2147483647 !important;
          pointer-events: none !important;
          opacity: 0 !important;
          transition: opacity 0.3s ease, transform 0.3s ease !important;
        }
        .pagestream-status-toast.visible {
          opacity: 1 !important;
          transform: translateX(-50%) translateY(0) !important;
        }
        @keyframes pagestreamFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `;
      (document.head || document.documentElement).appendChild(style);
      this._styleEl = style;
    }
  };

  if (typeof window !== 'undefined') {
    window.PageStream = PageStream;
  }
})();
