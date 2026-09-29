// ==UserScript==
// @name         Prevent Redirect & Tab Hijack
// @namespace    https://github.com/CoronRing/BESing
// @version      1.1.0
// @description  Prevents unwanted automatic redirects to external sites and strictly blocks new tab popups. Returns success to callers so ad scripts do not retry.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PreventRedirect = {
    id: 'prevent-redirect',
    name: 'Prevent Redirect',
    version: '1.1.0',
    description: 'Strictly blocks automatic redirects, new tab popups, and external link clicks. Returns mock window to satisfy callers so ad scripts do not retry.',
    category: 'Security',
    _origOpen: null,
    _origUnsafeOpen: null,
    _origAnchorClick: null,
    _origAssign: null,
    _origReplace: null,
    _clickHandler: null,
    _auxClickHandler: null,
    _injectedScript: null,

    _isSameHost(targetUrl) {
      if (!targetUrl || typeof targetUrl !== 'string') return true;
      const trimmed = targetUrl.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
        return true;
      }
      try {
        const parsed = new URL(trimmed, window.location.href);
        if (parsed.protocol === 'javascript:' || parsed.protocol === 'about:') return true;
        const curHost = (window.location.hostname || '').toLowerCase();
        const targetHost = (parsed.hostname || '').toLowerCase();
        if (!targetHost || !curHost) return true;
        return targetHost === curHost || targetHost.endsWith('.' + curHost) || curHost.endsWith('.' + targetHost);
      } catch (e) {
        return false;
      }
    },

    _createFakeWindow(url) {
      const fake = {
        closed: false,
        name: '',
        opener: window,
        parent: window,
        top: window,
        frames: [],
        length: 0,
        close() { this.closed = true; },
        focus() {},
        blur() {},
        postMessage() {},
        print() {},
        stop() {},
        location: {
          href: url || 'about:blank',
          hash: '',
          host: '',
          hostname: '',
          origin: '',
          pathname: '',
          port: '',
          protocol: 'https:',
          search: '',
          assign() {},
          replace() {},
          reload() {},
          toString() { return url || 'about:blank'; }
        },
        document: {
          open() { return this; },
          close() {},
          write() {},
          writeln() {},
          createElement(tag) { return document.createElement(tag || 'div'); }
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; }
      };
      fake.window = fake;
      return fake;
    },

    notifyBlocked(targetUrl, reason) {
      console.warn(`[BESing Prevent Redirect] Blocked ${reason}:`, targetUrl);
      try {
        window.dispatchEvent(new CustomEvent('besing:redirect-blocked', {
          detail: { url: targetUrl, reason }
        }));
      } catch (e) {}
    },

    init() {
      this.destroy();
      const self = this;
      const unsafeWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

      // 1. Hook window.open in current scope and unsafeWindow
      const hookedOpen = function (url, target, features) {
        const isExt = url && !self._isSameHost(url);
        const isNewTab = target === '_blank' || target === '_new' || !target;

        if (isExt || isNewTab) {
          self.notifyBlocked(url || 'about:blank', isExt ? 'external window.open redirect' : 'new tab popup');
          // Return a realistic mock window object to satisfy ad caller so it considers the action successful
          return self._createFakeWindow(url);
        }

        const orig = self._origUnsafeOpen || self._origOpen || window.open;
        try {
          return orig.call(this || window, url, target, features);
        } catch (e) {
          return self._createFakeWindow(url);
        }
      };

      this._origOpen = window.open;
      window.open = hookedOpen;
      if (unsafeWin && unsafeWin !== window) {
        this._origUnsafeOpen = unsafeWin.open;
        try { unsafeWin.open = hookedOpen; } catch (e) {}
      }

      // 2. Hook HTMLAnchorElement.prototype.click
      try {
        const anchorProto = (unsafeWin.HTMLAnchorElement || HTMLAnchorElement).prototype;
        this._origAnchorClick = anchorProto.click;
        anchorProto.click = function () {
          const href = this.getAttribute('href') || this.href;
          const target = (this.getAttribute('target') || this.target || '').toLowerCase();
          const isExt = href && !self._isSameHost(href);
          const isNewTab = target === '_blank' || target === '_new';

          if (isExt || isNewTab) {
            self.notifyBlocked(href || '', 'programmatic anchor.click()');
            return true; // Return success so calling script proceeds without error
          }
          return self._origAnchorClick.call(this);
        };
      } catch (e) {}

      // 3. Hook Location.prototype.assign and replace
      try {
        const locProto = (unsafeWin.Location || Location).prototype;
        if (locProto && locProto.assign) {
          this._origAssign = locProto.assign;
          locProto.assign = function (url) {
            if (url && !self._isSameHost(url)) {
              self.notifyBlocked(url, 'location.assign redirect');
              return;
            }
            return self._origAssign.call(this, url);
          };
        }
      } catch (e) {}

      try {
        const locProto = (unsafeWin.Location || Location).prototype;
        if (locProto && locProto.replace) {
          this._origReplace = locProto.replace;
          locProto.replace = function (url) {
            if (url && !self._isSameHost(url)) {
              self.notifyBlocked(url, 'location.replace redirect');
              return;
            }
            return self._origReplace.call(this, url);
          };
        }
      } catch (e) {}

      // 4. Capture and block link clicks (both user clicks and script-triggered clicks)
      this._clickHandler = function (e) {
        const link = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!link) return;
        const href = link.getAttribute('href') || link.href;
        if (!href) return;
        const trimmed = href.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
          return;
        }

        const target = (link.getAttribute('target') || link.target || '').toLowerCase();
        const isExternal = !self._isSameHost(href);
        const isNewTab = target === '_blank' || target === '_new' || e.ctrlKey || e.metaKey || e.shiftKey;

        if (isExternal || isNewTab) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          self.notifyBlocked(href, isNewTab ? 'new tab link click' : 'external redirect link click');
        }
      };

      this._auxClickHandler = function (e) {
        // Middle click
        if (e.button === 1) {
          const link = e.target && e.target.closest ? e.target.closest('a') : null;
          if (link) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            self.notifyBlocked(link.href || '', 'middle-click new tab');
          }
        }
      };

      window.addEventListener('click', this._clickHandler, true);
      document.addEventListener('click', this._clickHandler, true);
      window.addEventListener('auxclick', this._auxClickHandler, true);
      document.addEventListener('auxclick', this._auxClickHandler, true);

      // 5. Inject page-context guard for page scripts
      try {
        const pageScript = document.createElement('script');
        pageScript.id = '__besing_pr_guard__';
        pageScript.textContent = `
          (function() {
            if (window.__besing_pr_active__) return;
            window.__besing_pr_active__ = true;
            var curHost = (window.location.hostname || '').toLowerCase();
            function isSame(u) {
              if (!u || typeof u !== 'string') return true;
              var t = u.trim();
              if (!t || t.indexOf('#') === 0 || t.indexOf('javascript:') === 0) return true;
              try {
                var p = new URL(t, window.location.href);
                var h = (p.hostname || '').toLowerCase();
                return h === curHost || h.endsWith('.' + curHost) || curHost.endsWith('.' + h);
              } catch(e) { return false; }
            }
            function fakeWin(u) {
              var f = {
                closed: false, name: '', opener: window, parent: window, top: window, frames: [], length: 0,
                close: function() { this.closed = true; }, focus: function(){}, blur: function(){},
                postMessage: function(){}, print: function(){}, stop: function(){},
                location: { href: u || 'about:blank', assign: function(){}, replace: function(){}, reload: function(){} },
                document: { open: function(){ return this; }, close: function(){}, write: function(){}, writeln: function(){} }
              };
              f.window = f;
              return f;
            }
            var origOpen = window.open;
            window.open = function(url, target, feat) {
              var isExt = url && !isSame(url);
              var isNew = target === '_blank' || target === '_new' || !target;
              if (isExt || isNew) {
                window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script window.open' } }));
                return fakeWin(url);
              }
              return origOpen.call(this || window, url, target, feat);
            };
          })();
        `;
        (document.head || document.documentElement).appendChild(pageScript);
        pageScript.remove();
      } catch (e) {}
    },

    destroy() {
      const unsafeWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
      if (this._origOpen) {
        window.open = this._origOpen;
        this._origOpen = null;
      }
      if (this._origUnsafeOpen && unsafeWin) {
        try { unsafeWin.open = this._origUnsafeOpen; } catch (e) {}
        this._origUnsafeOpen = null;
      }
      if (this._origAnchorClick) {
        try {
          const anchorProto = (unsafeWin.HTMLAnchorElement || HTMLAnchorElement).prototype;
          anchorProto.click = this._origAnchorClick;
        } catch (e) {}
        this._origAnchorClick = null;
      }
      if (this._origAssign) {
        try {
          const locProto = (unsafeWin.Location || Location).prototype;
          locProto.assign = this._origAssign;
        } catch (e) {}
        this._origAssign = null;
      }
      if (this._origReplace) {
        try {
          const locProto = (unsafeWin.Location || Location).prototype;
          locProto.replace = this._origReplace;
        } catch (e) {}
        this._origReplace = null;
      }
      if (this._clickHandler) {
        window.removeEventListener('click', this._clickHandler, true);
        document.removeEventListener('click', this._clickHandler, true);
        this._clickHandler = null;
      }
      if (this._auxClickHandler) {
        window.removeEventListener('auxclick', this._auxClickHandler, true);
        document.removeEventListener('auxclick', this._auxClickHandler, true);
        this._auxClickHandler = null;
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['prevent-redirect'] = PreventRedirect;
    if (!window.__BESING_EMBEDDED__) {
      PreventRedirect.init();
    }
  }
})();
