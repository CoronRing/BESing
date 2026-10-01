// ==UserScript==
// @name         PageStream
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Continuous page streaming via smart pagination detection and automated clicks for infinite scrolling.
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
    version: '1.0.0',
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
    _hasEnded: false,
    _rule: null,

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
      this._hasEnded = false;

      this._injectStyles();
      this._matchRule();
      this._setupNextLink();
      this._setupScrollListener();
      this._setupHistoryObserver();

      // Trigger initial preload if configured
      if (this._config.preloadPages > 0) {
        setTimeout(() => {
          this._checkAndPreload();
        }, 1200);
      }

      console.log(`[PageStream] Initialized (When: ${this._config.whenToLoad}, Preload: ${this._config.preloadPages}, History: ${this._config.enableHistory})`);
    },

    destroy() {
      if (!this._active) return;
      this._active = false;

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
      document.querySelectorAll('.pagestream-divider, .pagestream-streamed-block').forEach(el => {
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
        this._checkAndPreload();
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
        this._currentNextUrl = this._extractHref(nextEl);
      } else {
        this._currentNextElement = null;
        this._currentNextUrl = null;
      }
    },

    _extractHref(el) {
      if (!el) return null;
      if (el.tagName && el.tagName.toLowerCase() === 'a' && el.href) {
        return el.href;
      }
      const anchor = el.querySelector ? el.querySelector('a[href]') : null;
      if (anchor && anchor.href) return anchor.href;
      const dataHref = el.getAttribute ? (el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('href')) : null;
      if (dataHref) {
        try { return new URL(dataHref, window.location.href).href; } catch (e) { return dataHref; }
      }
      return null;
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

      // 3. Common content container candidates
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

      // 4. Heuristic: Find element with highest paragraph / text density
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

      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      const innerHeight = window.innerHeight;
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );

      const scrollPos = scrollY + innerHeight;
      const thresholdMode = this._config.whenToLoad; // 'start', 'half point', 'bottom'

      let shouldTrigger = false;
      if (thresholdMode === 'start') {
        // Trigger at 15% mark or after scrolling 150px
        shouldTrigger = (scrollPos >= scrollHeight * 0.15) || (scrollY > 150) || (scrollHeight <= innerHeight * 1.2);
      } else if (thresholdMode === 'half point') {
        // Trigger at 50% mark
        shouldTrigger = scrollPos >= (scrollHeight * 0.50);
      } else {
        // 'bottom': Trigger at 90% mark (not 100%, to eliminate loading stall)
        shouldTrigger = scrollPos >= (scrollHeight * 0.90);
      }

      if (shouldTrigger) {
        this._streamNextPage();
      }
    },

    // 3. Page Streaming Execution (Fetch/Splice or Click)
    async _streamNextPage() {
      if (this._isLoading || this._hasEnded || !this._active) return;
      this._isLoading = true;

      try {
        // 1. Check if we already have preloaded page ready
        if (this._pageCache.length > 0) {
          const cached = this._pageCache.shift();
          this._insertPage(cached);
          this._isLoading = false;
          // Trigger next preload in background
          this._checkAndPreload();
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
      const preCount = document.querySelectorAll('*').length;
      try {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
      } catch (e) {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        btn.dispatchEvent(evt);
      }

      // Wait for DOM mutation or new content
      await new Promise(r => setTimeout(r, 800));
      const postCount = document.querySelectorAll('*').length;
      if (postCount > preCount) {
        this._curPageNum++;
        this._createDivider(this._curPageNum, window.location.href, document.title || `Page ${this._curPageNum}`);
        this._setupNextLink();
      }
    },

    async _fetchAndSplice(url) {
      if (this._loadedUrls.has(url)) {
        this._hasEnded = true;
        return;
      }
      this._loadedUrls.add(url);

      console.log(`[PageStream] Fetching next page: ${url}`);
      const pageData = await this._loadRemotePage(url);
      if (!pageData) {
        this._hasEnded = true;
        return;
      }

      this._insertPage(pageData);

      // Background preload next page if configured
      this._checkAndPreload();
    },

    async _loadRemotePage(url) {
      try {
        const resp = await fetch(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          credentials: 'include'
        });

        if (!resp.ok) return null;
        const text = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        const title = (doc.querySelector('title') ? doc.querySelector('title').innerText : '') || `Page ${this._curPageNum + 1}`;
        const mainContent = this._findMainContentElement(doc);
        if (!mainContent) return null;

        // Clean up unwanted elements inside cloned content
        if (this._rule && this._rule.filter) {
          mainContent.querySelectorAll(this._rule.filter).forEach(e => e.remove());
        }

        // Clean scripts to prevent re-execution/malicious ads
        mainContent.querySelectorAll('script').forEach(s => s.remove());

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

        const nextUrl = this._extractHref(nextEl);

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
        return null;
      }
    },

    _insertPage(pageData) {
      const { pageNum, url, title, contentNode, nextUrl } = pageData;
      this._curPageNum = pageNum;
      this._currentNextUrl = nextUrl;

      // 1. Create clean divider (NO TaiChi icon!)
      const divider = this._createDivider(pageNum, url, title);

      // 2. Wrap content node in streamed container
      const streamedWrapper = document.createElement('div');
      streamedWrapper.className = 'pagestream-streamed-block';
      streamedWrapper.setAttribute('data-pagestream-page', pageNum);
      streamedWrapper.setAttribute('data-pagestream-url', url);
      streamedWrapper.setAttribute('data-pagestream-title', title);
      streamedWrapper.appendChild(contentNode);

      // 3. Find target insertion point
      const currentMain = this._findMainContentElement(document);
      if (currentMain && currentMain.parentNode) {
        // Insert after main content container
        currentMain.parentNode.insertBefore(divider, currentMain.nextSibling);
        currentMain.parentNode.insertBefore(streamedWrapper, divider.nextSibling);
      } else {
        document.body.appendChild(divider);
        document.body.appendChild(streamedWrapper);
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
    async _checkAndPreload() {
      const preloadCount = this._config.preloadPages;
      if (preloadCount <= 0 || !this._active || this._hasEnded) return;

      if (this._pageCache.length < preloadCount && this._currentNextUrl) {
        const targetUrl = this._currentNextUrl;
        if (this._loadedUrls.has(targetUrl)) return;

        console.log(`[PageStream] Preloading background page: ${targetUrl}`);
        const preData = await this._loadRemotePage(targetUrl);
        if (preData) {
          this._loadedUrls.add(targetUrl);
          this._pageCache.push(preData);
          this._currentNextUrl = preData.nextUrl;
          console.log(`[PageStream] Background preloaded page ${preData.pageNum} ready in cache.`);
        }
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
