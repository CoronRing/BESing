// ==UserScript==
// @name         Prevent Redirect & Tab Hijack
// @namespace    https://github.com/CoronRing/BESing
// @version      1.2.0
// @description  Prevents unwanted automatic redirects, mobile touch/sensor traps, popups, and malicious ad network script injections while preserving normal site navigation.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const PreventRedirect = {
    id: 'prevent-redirect',
    name: 'Prevent Redirect',
    version: '1.2.0',
    description: 'Strictly blocks automatic redirects, mobile sensor traps, new tab popups, and malicious ad network script injections while preserving legitimate site navigation.',
    category: 'Security',
    _origOpen: null,
    _origUnsafeOpen: null,
    _origWebSocket: null,
    _origUnsafeWebSocket: null,
    _origAnchorClick: null,
    _origAssign: null,
    _origReplace: null,
    _origScriptSrcDesc: null,
    _origIframeSrcDesc: null,
    _origAppendChild: null,
    _origInsertBefore: null,
    _origInsertAdjacentHTML: null,
    _origAEL: null,
    _clickHandler: null,
    _auxClickHandler: null,
    _touchHandler: null,
    _beforeUnloadHandler: null,
    _userIntentionalClick: false,
    _userClickTimer: null,
    _injectedGuardEl: null,

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

    _isAdOrRedirectUrl(targetUrl) {
      if (!targetUrl || typeof targetUrl !== 'string') return false;
      const u = targetUrl.toLowerCase().trim();
      if (!u || u.startsWith('#') || u.startsWith('javascript:') || u.startsWith('about:')) return false;

      // 1. Non-standard ports commonly used by evasive ad/redirect servers
      if (/:(8001|8002|8003|8080|8081|8888|9999|20091|20092|20093)\b/.test(u)) {
        if (!this._isSameHost(u)) return true;
      }

      // 2. Known mobile ad / redirect networks
      const adDomains = [
        'lkg6odg.com', 'kt6th8f.com', 'fumeiti', 'comprelu.cc', 'dsygc.com',
        'uuysi5.cc', 'uuysi6.cc', '5bjoeih.com', 'xq04k6u.com', 'qq26oeg.com',
        'popcash', 'propellerads', 'exoclick', 'adsterra', 'clickadu',
        'richpush', 'trafficjunky', 'adservice', 'adnetwork', 'tsyndicate',
        'hilltopads', 'adcash', 'juicyads', 'yabidos'
      ];
      for (let i = 0; i < adDomains.length; i++) {
        if (u.includes(adDomains[i])) return true;
      }

      // 3. Known ad tracking redirect url path patterns
      if (/(\/sc\/\d+|\/cc\/\d+|\/d\/\d+\?c=|\/push\/|\/stat\/|\/click\/)/.test(u) && !this._isSameHost(u)) {
        return true;
      }
      if ((u.includes('?n=ikooenpn') || u.includes('&target=1')) && !this._isSameHost(u)) {
        return true;
      }

      return false;
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

    _createFakeWebSocket(url) {
      this.notifyBlocked(url, 'ad tunnel WebSocket');
      return {
        url: url,
        readyState: 3, // CLOSED
        bufferedAmount: 0,
        extensions: '',
        protocol: '',
        binaryType: 'blob',
        send() {},
        close() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; }
      };
    },

    notifyBlocked(targetUrl, reason) {
      console.warn(`[BESing Prevent Redirect] Blocked ${reason}:`, targetUrl);
      try {
        window.dispatchEvent(new CustomEvent('besing:redirect-blocked', {
          detail: { url: targetUrl, reason }
        }));
      } catch (e) {}
    },

    _recordUserClick(e) {
      const target = e && e.target;
      const link = target && target.closest ? target.closest('a') : null;
      if (link) {
        const href = link.getAttribute('href') || link.href;
        if (this._isSameHost(href)) {
          this._userIntentionalClick = true;
          if (this._userClickTimer) clearTimeout(this._userClickTimer);
          this._userClickTimer = setTimeout(() => {
            this._userIntentionalClick = false;
          }, 3000);
        }
      }
    },

    init() {
      this.destroy();
      const self = this;
      const unsafeWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

      // 1. Hook window.open in current scope and unsafeWindow
      const hookedOpen = function (url, target, features) {
        const isExt = url && !self._isSameHost(url);
        const isNewTab = target === '_blank' || target === '_new' || !target;
        const isAd = self._isAdOrRedirectUrl(url);

        if (isExt || isNewTab || isAd) {
          self.notifyBlocked(url || 'about:blank', isAd ? 'ad window.open redirect' : (isExt ? 'external window.open redirect' : 'new tab popup'));
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

      // 2. Hook WebSocket to block ad tunnels (e.g. wss://...:20091 or :20093)
      try {
        const OrigWS = window.WebSocket;
        if (OrigWS) {
          this._origWebSocket = OrigWS;
          const hookedWebSocket = function(url, protocols) {
            if (self._isAdOrRedirectUrl(url)) {
              return self._createFakeWebSocket(url);
            }
            return new OrigWS(url, protocols);
          };
          hookedWebSocket.prototype = OrigWS.prototype;
          hookedWebSocket.CONNECTING = 0;
          hookedWebSocket.OPEN = 1;
          hookedWebSocket.CLOSING = 2;
          hookedWebSocket.CLOSED = 3;
          window.WebSocket = hookedWebSocket;
          if (unsafeWin && unsafeWin !== window) {
            this._origUnsafeWebSocket = unsafeWin.WebSocket;
            try { unsafeWin.WebSocket = hookedWebSocket; } catch (e) {}
          }
        }
      } catch (e) {}

      // 3. Drop mobile sensor traps (devicemotion, deviceorientation)
      try {
        const origAEL = window.addEventListener;
        this._origAEL = origAEL;
        const hookedAEL = function(type, listener, options) {
          if (type === 'devicemotion' || type === 'deviceorientation') {
            console.warn('[BESing Prevent Redirect] Suppressed mobile sensor trap:', type);
            return;
          }
          return origAEL.call(this, type, listener, options);
        };
        window.addEventListener = hookedAEL;
        if (unsafeWin && unsafeWin !== window) {
          try { unsafeWin.addEventListener = hookedAEL; } catch (e) {}
        }
      } catch (e) {}

      // 4. Hook HTMLScriptElement.prototype.src to intercept ad script injections
      try {
        const scriptProto = (unsafeWin.HTMLScriptElement || HTMLScriptElement).prototype;
        const scriptDesc = Object.getOwnPropertyDescriptor(scriptProto, 'src');
        if (scriptDesc && scriptDesc.set) {
          this._origScriptSrcDesc = scriptDesc;
          const origSet = scriptDesc.set;
          Object.defineProperty(scriptProto, 'src', {
            set: function(val) {
              if (self._isAdOrRedirectUrl(val)) {
                self.notifyBlocked(val, 'ad script injection');
                return origSet.call(this, 'data:text/javascript,/*besing-blocked*/');
              }
              return origSet.call(this, val);
            },
            get: scriptDesc.get,
            configurable: true
          });
        }
      } catch (e) {}

      // 5. Hook HTMLIFrameElement.prototype.src to intercept ad iframes
      try {
        const iframeProto = (unsafeWin.HTMLIFrameElement || HTMLIFrameElement).prototype;
        const iframeDesc = Object.getOwnPropertyDescriptor(iframeProto, 'src');
        if (iframeDesc && iframeDesc.set) {
          this._origIframeSrcDesc = iframeDesc;
          const origSet = iframeDesc.set;
          Object.defineProperty(iframeProto, 'src', {
            set: function(val) {
              if (self._isAdOrRedirectUrl(val)) {
                self.notifyBlocked(val, 'ad iframe injection');
                return origSet.call(this, 'about:blank');
              }
              return origSet.call(this, val);
            },
            get: iframeDesc.get,
            configurable: true
          });
        }
      } catch (e) {}

      // 6. Hook Node.prototype.appendChild and insertBefore
      try {
        const nodeProto = (unsafeWin.Node || Node).prototype;
        this._origAppendChild = nodeProto.appendChild;
        nodeProto.appendChild = function(node) {
          if (node && (node.tagName === 'SCRIPT' || node.tagName === 'IFRAME')) {
            const src = node.getAttribute('src') || node.src;
            if (self._isAdOrRedirectUrl(src)) {
              self.notifyBlocked(src, 'injected ' + node.tagName.toLowerCase());
              return node;
            }
          }
          return self._origAppendChild.call(this, node);
        };

        this._origInsertBefore = nodeProto.insertBefore;
        nodeProto.insertBefore = function(node, ref) {
          if (node && (node.tagName === 'SCRIPT' || node.tagName === 'IFRAME')) {
            const src = node.getAttribute('src') || node.src;
            if (self._isAdOrRedirectUrl(src)) {
              self.notifyBlocked(src, 'injected ' + node.tagName.toLowerCase());
              return node;
            }
          }
          return self._origInsertBefore.call(this, node, ref);
        };
      } catch (e) {}

      // 7. Hook Element.prototype.insertAdjacentHTML to filter invisible touch overlay tiles
      try {
        const elemProto = (unsafeWin.Element || Element).prototype;
        this._origInsertAdjacentHTML = elemProto.insertAdjacentHTML;
        elemProto.insertAdjacentHTML = function(pos, html) {
          if (typeof html === 'string' && html.includes('position:fixed') && (html.includes('opacity:0.01') || html.includes('opacity: 0.01') || html.includes('opacity:0;'))) {
            self.notifyBlocked('overlay', 'invisible trap touch tiles in insertAdjacentHTML');
            return;
          }
          return self._origInsertAdjacentHTML.call(this, pos, html);
        };
      } catch (e) {}

      // 8. Hook HTMLAnchorElement.prototype.click
      try {
        const anchorProto = (unsafeWin.HTMLAnchorElement || HTMLAnchorElement).prototype;
        this._origAnchorClick = anchorProto.click;
        anchorProto.click = function () {
          const href = this.getAttribute('href') || this.href;
          const target = (this.getAttribute('target') || this.target || '').toLowerCase();
          const isExt = href && !self._isSameHost(href);
          const isNewTab = target === '_blank' || target === '_new';
          const isAd = self._isAdOrRedirectUrl(href);

          if (isExt || isNewTab || isAd) {
            self.notifyBlocked(href || '', 'programmatic anchor.click()');
            return true;
          }
          return self._origAnchorClick.call(this);
        };
      } catch (e) {}

      // 9. Hook Location.prototype.assign and replace
      try {
        const locProto = (unsafeWin.Location || Location).prototype;
        if (locProto && locProto.assign) {
          this._origAssign = locProto.assign;
          locProto.assign = function (url) {
            if ((url && !self._isSameHost(url)) || self._isAdOrRedirectUrl(url)) {
              self.notifyBlocked(url, 'location.assign redirect');
              return;
            }
            return self._origAssign.call(this, url);
          };
        }
        if (locProto && locProto.replace) {
          this._origReplace = locProto.replace;
          locProto.replace = function (url) {
            if ((url && !self._isSameHost(url)) || self._isAdOrRedirectUrl(url)) {
              self.notifyBlocked(url, 'location.replace redirect');
              return;
            }
            return self._origReplace.call(this, url);
          };
        }
      } catch (e) {}

      // 10. Click and touch tracking to distinguish user navigation from background hijacks
      this._clickHandler = function (e) {
        self._recordUserClick(e);
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
        const isAd = self._isAdOrRedirectUrl(href);

        if (isExternal || isNewTab || isAd) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          self.notifyBlocked(href, isAd ? 'ad link click' : (isNewTab ? 'new tab link click' : 'external redirect link click'));
        }
      };

      this._touchHandler = function (e) {
        self._recordUserClick(e);
      };

      this._auxClickHandler = function (e) {
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

      this._beforeUnloadHandler = function (e) {
        if (!self._userIntentionalClick) {
          console.warn('[BESing Prevent Redirect] Intercepted unauthorized auto-redirect via beforeunload!');
          e.preventDefault();
          e.returnValue = 'Automatic redirect blocked by BESing.';
          return 'Automatic redirect blocked by BESing.';
        }
      };

      window.addEventListener('click', this._clickHandler, true);
      document.addEventListener('click', this._clickHandler, true);
      window.addEventListener('touchend', this._touchHandler, true);
      document.addEventListener('touchend', this._touchHandler, true);
      window.addEventListener('auxclick', this._auxClickHandler, true);
      document.addEventListener('auxclick', this._auxClickHandler, true);
      window.addEventListener('beforeunload', this._beforeUnloadHandler, true);

      // 11. Inject page-context guard for page scripts in main execution world
      try {
        const guardScript = document.createElement('script');
        guardScript.id = '__besing_pr_guard__';
        guardScript.textContent = `
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
            function isAd(u) {
              if (!u || typeof u !== 'string') return false;
              var s = u.toLowerCase();
              if (/:(8001|8002|8003|8080|8081|8888|9999|20091|20092|20093)\\b/.test(s) && !isSame(s)) return true;
              if (/(lkg6odg\\.com|kt6th8f\\.com|fumeiti|comprelu\\.cc|dsygc\\.com|uuysi5\\.cc|uuysi6\\.cc|5bjoeih\\.com|xq04k6u\\.com|qq26oeg\\.com|popcash|propellerads|exoclick|adsterra|clickadu|richpush|trafficjunky|adservice|adnetwork)/.test(s)) return true;
              if (/(\\/sc\\/\\d+|\\/cc\\/\\d+|\\/d\\/\\d+\\?c=|\\/push\\/|\\/stat\\/|\\/click\\/)/.test(s) && !isSame(s)) return true;
              if (s.indexOf('?n=ikooenpn') !== -1 || s.indexOf('&target=1') !== -1) return true;
              return false;
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
              if (isAd(url) || (url && !isSame(url)) || target === '_blank' || target === '_new' || !target) {
                window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script window.open' } }));
                return fakeWin(url);
              }
              return origOpen.call(this || window, url, target, feat);
            };
            var OrigWS = window.WebSocket;
            if (OrigWS) {
              window.WebSocket = function(url, proto) {
                if (isAd(url)) {
                  window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script WebSocket' } }));
                  return { url: url, readyState: 3, send: function(){}, close: function(){}, addEventListener: function(){}, removeEventListener: function(){} };
                }
                return new OrigWS(url, proto);
              };
              window.WebSocket.prototype = OrigWS.prototype;
            }
            var origAEL = window.addEventListener;
            window.addEventListener = function(t, l, o) {
              if (t === 'devicemotion' || t === 'deviceorientation') return;
              return origAEL.call(this, t, l, o);
            };
            try {
              var sDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
              if (sDesc && sDesc.set) {
                var oSet = sDesc.set;
                Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                  set: function(v) {
                    if (isAd(v)) {
                      window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: v, reason: 'page-script script.src' } }));
                      return oSet.call(this, 'data:text/javascript,/*besing-blocked*/');
                    }
                    return oSet.call(this, v);
                  },
                  get: sDesc.get,
                  configurable: true
                });
              }
            } catch(e){}
            var oInsert = Element.prototype.insertAdjacentHTML;
            Element.prototype.insertAdjacentHTML = function(p, h) {
              if (typeof h === 'string' && h.indexOf('position:fixed') !== -1 && (h.indexOf('opacity:0.01') !== -1 || h.indexOf('opacity: 0.01') !== -1)) {
                return;
              }
              return oInsert.call(this, p, h);
            };
          })();
        `;
        const root = document.head || document.documentElement;
        if (root) {
          root.appendChild(guardScript);
          this._injectedGuardEl = guardScript;
          guardScript.remove();
        }
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
      if (this._origWebSocket) {
        window.WebSocket = this._origWebSocket;
        this._origWebSocket = null;
      }
      if (this._origUnsafeWebSocket && unsafeWin) {
        try { unsafeWin.WebSocket = this._origUnsafeWebSocket; } catch (e) {}
        this._origUnsafeWebSocket = null;
      }
      if (this._origAEL) {
        window.addEventListener = this._origAEL;
        if (unsafeWin && unsafeWin !== window) {
          try { unsafeWin.addEventListener = this._origAEL; } catch (e) {}
        }
        this._origAEL = null;
      }
      if (this._origScriptSrcDesc) {
        try {
          Object.defineProperty((unsafeWin.HTMLScriptElement || HTMLScriptElement).prototype, 'src', this._origScriptSrcDesc);
        } catch (e) {}
        this._origScriptSrcDesc = null;
      }
      if (this._origIframeSrcDesc) {
        try {
          Object.defineProperty((unsafeWin.HTMLIFrameElement || HTMLIFrameElement).prototype, 'src', this._origIframeSrcDesc);
        } catch (e) {}
        this._origIframeSrcDesc = null;
      }
      if (this._origAppendChild) {
        try { (unsafeWin.Node || Node).prototype.appendChild = this._origAppendChild; } catch (e) {}
        this._origAppendChild = null;
      }
      if (this._origInsertBefore) {
        try { (unsafeWin.Node || Node).prototype.insertBefore = this._origInsertBefore; } catch (e) {}
        this._origInsertBefore = null;
      }
      if (this._origInsertAdjacentHTML) {
        try { (unsafeWin.Element || Element).prototype.insertAdjacentHTML = this._origInsertAdjacentHTML; } catch (e) {}
        this._origInsertAdjacentHTML = null;
      }
      if (this._origAnchorClick) {
        try {
          (unsafeWin.HTMLAnchorElement || HTMLAnchorElement).prototype.click = this._origAnchorClick;
        } catch (e) {}
        this._origAnchorClick = null;
      }
      if (this._origAssign) {
        try {
          (unsafeWin.Location || Location).prototype.assign = this._origAssign;
        } catch (e) {}
        this._origAssign = null;
      }
      if (this._origReplace) {
        try {
          (unsafeWin.Location || Location).prototype.replace = this._origReplace;
        } catch (e) {}
        this._origReplace = null;
      }
      if (this._clickHandler) {
        window.removeEventListener('click', this._clickHandler, true);
        document.removeEventListener('click', this._clickHandler, true);
        this._clickHandler = null;
      }
      if (this._touchHandler) {
        window.removeEventListener('touchend', this._touchHandler, true);
        document.removeEventListener('touchend', this._touchHandler, true);
        this._touchHandler = null;
      }
      if (this._auxClickHandler) {
        window.removeEventListener('auxclick', this._auxClickHandler, true);
        document.removeEventListener('auxclick', this._auxClickHandler, true);
        this._auxClickHandler = null;
      }
      if (this._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this._beforeUnloadHandler, true);
        this._beforeUnloadHandler = null;
      }
      if (this._userClickTimer) {
        clearTimeout(this._userClickTimer);
        this._userClickTimer = null;
      }
      this._userIntentionalClick = false;
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
