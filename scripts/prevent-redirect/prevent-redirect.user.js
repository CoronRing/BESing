// ==UserScript==
// @name         Prevent Redirect & Tab Hijack
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Prevents unwanted automatic redirects to external sites and strictly blocks new tab popups.
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
    version: '1.0.0',
    description: 'Prevents automatic redirects to external sites and strictly blocks unwanted new tab popups.',
    category: 'Security',
    _origOpen: null,
    _origAssign: null,
    _origReplace: null,
    _clickHandler: null,

    _isSameHost(targetUrl) {
      if (!targetUrl || typeof targetUrl !== 'string') return true;
      try {
        const parsed = new URL(targetUrl, window.location.href);
        if (parsed.protocol === 'javascript:' || parsed.protocol === 'about:') return true;
        const curHost = (window.location.hostname || '').toLowerCase();
        const targetHost = parsed.hostname.toLowerCase();
        return targetHost === curHost || targetHost.endsWith('.' + curHost) || curHost.endsWith('.' + targetHost);
      } catch (e) {
        return false;
      }
    },

    notifyBlocked(targetUrl, reason) {
      console.warn(`[BESing Prevent Redirect] Blocked ${reason}:`, targetUrl);
      window.dispatchEvent(new CustomEvent('besing:redirect-blocked', {
        detail: { url: targetUrl, reason }
      }));
    },

    init() {
      this.destroy();
      const self = this;

      // 1. Intercept window.open (Strictly block new tabs / popups to external sites or blank)
      this._origOpen = window.open;
      window.open = function (url, target, features) {
        if (url && !self._isSameHost(url)) {
          self.notifyBlocked(url, 'external window.open redirect');
          return null;
        }
        if (target === '_blank' || !target) {
          self.notifyBlocked(url || 'about:blank', 'new tab popup');
          return null;
        }
        return self._origOpen.call(window, url, target, features);
      };

      // 2. Intercept programmatic location changes
      try {
        this._origAssign = window.location.assign;
        window.location.assign = function (url) {
          if (!self._isSameHost(url)) {
            self.notifyBlocked(url, 'location.assign redirect');
            return;
          }
          return self._origAssign.call(window.location, url);
        };
      } catch (e) {}

      try {
        this._origReplace = window.location.replace;
        window.location.replace = function (url) {
          if (!self._isSameHost(url)) {
            self.notifyBlocked(url, 'location.replace redirect');
            return;
          }
          return self._origReplace.call(window.location, url);
        };
      } catch (e) {}

      // 3. Intercept click events on links with target="_blank" or external redirects
      this._clickHandler = function (e) {
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        if (!self._isSameHost(href)) {
          // If it was not a direct user click (e.g. synthetic script click)
          if (!e.isTrusted) {
            e.preventDefault();
            e.stopImmediatePropagation();
            self.notifyBlocked(href, 'synthetic link click');
          }
        }
      };
      document.addEventListener('click', this._clickHandler, true);
    },

    destroy() {
      if (this._origOpen) {
        window.open = this._origOpen;
        this._origOpen = null;
      }
      if (this._origAssign) {
        window.location.assign = this._origAssign;
        this._origAssign = null;
      }
      if (this._origReplace) {
        window.location.replace = this._origReplace;
        this._origReplace = null;
      }
      if (this._clickHandler) {
        document.removeEventListener('click', this._clickHandler, true);
        this._clickHandler = null;
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
