// ==UserScript==
// @name         Ad Cleaner & Element Zapper
// @namespace    https://github.com/CoronRing/BESing
// @version      2.0.0
// @description  Aggressive page cleaner: finds the main content and hides popups, floating and sticky bars, ads, third-party frames and side widgets around it. Includes a tap-to-hide Element Zapper.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const AdCleaner = {
    id: 'ad-cleaner',
    name: 'Ad Cleaner & Element Zapper',
    version: '2.0.0',
    description: 'Aggressive page cleaner with a 0 to 4 aggressiveness level: hides popups, floating and sticky bars, ads, third-party frames and everything around the main content. Includes a tap-to-hide Element Zapper.',
    category: 'Privacy',

    DEFAULT_LEVEL: 3.4,
    MAX_LEVEL: 4,
    // Each rule runs at or above its level. Documented in docs/scripts/ad-cleaner.md, "Aggressiveness Levels".
    LEVELS: {
      knownAds: 0.5,
      overlays: 1,
      floats: 1.5,
      thirdParty: 2,
      imageLinks: 2.5,
      allFloating: 3,
      widgets: 3.2,
      sidebars: 3.4,
      comments: 3.6,
      isolate: 3.8,
      media: 4
    },
    LEVEL_NAMES: [
      [4, 'Text Only', 'Only the main content and page links stay, without images, video or frames.'],
      [3.8, 'Main Content Only', 'Everything beside the main content goes, except navigation and page links.'],
      [3.6, 'No Comments', 'Also hides comment sections.'],
      [3.4, 'No Sidebars', 'Also hides sidebars and asides outside the main content.'],
      [3.2, 'No Widgets', 'Also hides related, share, newsletter and promo widgets outside the main content.'],
      [3, 'Nothing Floats', 'Hides every fixed or sticky element, including headers.'],
      [2.5, 'Image Ads', 'Also hides off-site image links and blocks labelled as ads.'],
      [2, 'Third-Party', 'Also hides third-party frames, ad-sized boxes and ad class names.'],
      [1.5, 'Floats', 'Hides fixed bars, corner floats and scroll followers. Keeps a top header.'],
      [1, 'Popups', 'Hides popups covering a quarter of the screen and unlocks scrolling.'],
      [0.5, 'Known Ads', 'Hides known ad slots and cookie consent banners.'],
      [0, 'Zaps Only', 'Only elements you zapped are hidden.']
    ],
    // Hide reasons that mean "this was an ad", whose emptied wrappers are collapsed too.
    AD_REASONS: ['zap', 'known-ad', 'iframe', 'ad-class', 'ad-size', 'image-link', 'ad-label'],
    // Below this level, a fixed element that appears right after you press a button or menu is kept.
    USER_POPUP_GRACE_BELOW: 3.5,
    USER_POPUP_GRACE_MS: 1500,
    STANDALONE_STORAGE_KEY: 'besing-ad-cleaner',

    // Specific ad network and consent manager selectors, applied by stylesheet the moment the page renders.
    KNOWN_AD_SELECTORS: [
      'ins.adsbygoogle', '.adsbygoogle', '[id^="google_ads_iframe"]', '[id^="google_ads_frame"]', '[id^="div-gpt-ad"]',
      '[data-ad-slot]', '[data-ad-client]', '[data-google-query-id]', '[data-ad-unit]', '[data-adunit]',
      'amp-ad', 'amp-embed', 'amp-sticky-ad', '[id^="taboola-"]', '.trc_related_container', '.OUTBRAIN', '[data-widget-id^="AR_"]',
      '[id^="ezoic-pub-ad"]', '.ezoic-ad', '[class^="adthrive"]', '[id^="mgid_"]', '.mgbox', '[id^="rc_widget"]',
      'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="amazon-adsystem.com"]',
      'iframe[src*="adnxs.com"]', 'iframe[src*="criteo"]', 'a[href*="doubleclick.net"]', 'a[href*="googleadservices.com"]',
      '[aria-label="Advertisement" i]', '[aria-label="Ads" i]', '[aria-label="Sponsored" i]',
      '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
      '.qc-cmp2-container', '#qc-cmp2-container', '[id^="sp_message_container"]', '.fc-consent-root', '#didomi-host',
      '#truste-consent-track', '.truste_overlay', '.truste_box_overlay', '#usercentrics-root', '#cmpbox', '#cmpbox2',
      '.cc-window', '#cookie-law-info-bar', '#cookiescript_injected', '.cky-consent-container', '.cky-overlay',
      '#moove_gdpr_cookie_info_bar', '#gdpr-cookie-message', '.osano-cm-window', '#termly-code-snippet-support'
    ],
    // Broad consent and newsletter patterns, applied by scan so they can never hide the main content or <body>.
    CONSENT_SELECTORS: [
      '[id*="cookie-banner" i]', '[class*="cookie-banner" i]', '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
      '[id*="cookieconsent" i]', '[class*="cookieconsent" i]', '[id*="cookie-notice" i]', '[class*="cookie-notice" i]',
      '[id*="cookie-bar" i]', '[class*="cookie-bar" i]', '[id*="consent-banner" i]', '[class*="consent-banner" i]',
      '[class*="consent-modal" i]', '[id*="gdpr" i]', '[class*="gdpr" i]', '[class*="newsletter-popup" i]',
      '[id*="newsletter-modal" i]', '[class*="popup-overlay" i]', '[role="dialog"][aria-label*="cookie" i]',
      '[role="dialog"][aria-label*="consent" i]'
    ],
    AD_TOKENS: ['ad', 'ads', 'adv', 'advert', 'adverts', 'advertisement', 'advertisements', 'advertising', 'adsense',
      'adsbygoogle', 'adslot', 'adunit', 'adbox', 'adblock', 'adbanner', 'adwrap', 'adwrapper', 'adcontainer', 'adholder',
      'adplaceholder', 'adspace', 'adzone', 'adframe', 'sponsor', 'sponsored', 'sponsors', 'sponsorship', 'promoted',
      'dfp', 'doubleclick', 'taboola', 'outbrain', 'mgid', 'revcontent', 'zergnet', 'adthrive', 'mediavine', 'ezoic',
      'googleads', 'gads', 'guanggao'],
    WIDGET_TOKENS: ['related', 'recommend', 'recommended', 'recommendation', 'recommendations', 'trending', 'popular',
      'mostread', 'mostpopular', 'newsletter', 'subscribe', 'subscription', 'signup', 'social', 'share', 'sharing',
      'sharebar', 'follow', 'promo', 'promotion', 'banner', 'widget', 'widgets', 'toast', 'popup', 'modal', 'overlay',
      'interstitial', 'smartbanner', 'appbanner', 'openapp', 'getapp', 'downloadapp', 'appdownload', 'upsell', 'paywall'],
    SIDEBAR_TOKENS: ['sidebar', 'sidebars', 'aside', 'rail', 'rightrail', 'leftrail', 'rightcol', 'leftcol',
      'rightcolumn', 'leftcolumn', 'sidecol', 'sidecolumn', 'sidebox'],
    COMMENT_TOKENS: ['comment', 'comments', 'commentlist', 'disqus', 'discussion', 'replies', 'respond'],
    NAV_TOKENS: ['nav', 'navbar', 'navigation', 'menu', 'header', 'breadcrumb', 'breadcrumbs', 'topbar'],
    PAGER_TOKENS: ['pagination', 'pager', 'paging', 'pagenav', 'nextprev', 'chapternav', 'pages', 'page'],
    AD_LABELS: ['advertisement', 'advertisements', 'advertising', 'advert', 'ad', 'ads', 'sponsored', 'sponsoredcontent',
      'sponsoredlinks', 'promoted', 'promotedcontent', 'paidcontent', 'partnercontent', 'paidpartnership', 'adchoices',
      'anzeige', 'werbung', 'publicité', 'publicite', 'publicidad', 'pubblicità', 'pubblicita', 'реклама', '广告',
      '廣告', '推广', '推廣', '赞助', '贊助', '赞助商', '广告位', '広告', '광고', 'スポンサー'],
    PAGER_LINK_RE: /^(next|prev|previous|older|newer|first|last|next page|previous page|下一[页頁章节節篇]?|上一[页頁章节節篇]?|下[页頁]|上[页頁]|目录|目錄|返回目录|章节目录|›|»|«|‹|→|←|>|<|\d{1,4})$/i,
    // Third-party frames that are usually content, kept until the higher levels.
    EMBED_HOSTS: ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'player.bilibili.com', 'dailymotion.com',
      'player.twitch.tv', 'clips.twitch.tv', 'open.spotify.com', 'w.soundcloud.com', 'embed.music.apple.com',
      'archive.org', 'codepen.io', 'jsfiddle.net', 'codesandbox.io', 'stackblitz.com', 'openstreetmap.org',
      'docs.google.com', 'drive.google.com', 'platform.twitter.com', 'embed.ted.com'],
    // Third-party frames needed to use the site; only level 4 hides them.
    ESSENTIAL_HOSTS: ['recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com', 'js.stripe.com', 'hooks.stripe.com',
      'checkout.stripe.com', 'paypal.com', 'paypalobjects.com', 'appleid.apple.com', 'accounts.google.com',
      'login.microsoftonline.com'],
    // Standard IAB ad slot sizes.
    AD_SIZES: [[300, 250], [336, 280], [728, 90], [970, 90], [970, 250], [320, 50], [320, 100], [300, 50], [468, 60],
      [160, 600], [120, 600], [300, 600], [250, 250], [200, 200], [234, 60], [300, 100], [320, 480], [480, 320]],

    _config: null,
    _level: 3.4,
    _host: '',
    _running: false,
    _sheet: null,
    _styleEl: null,
    _observer: null,
    _scanTimer: 0,
    _lastScanAt: 0,
    _scanCost: 0,
    _scanCount: 0,
    _hidden: null,
    _styled: null,
    _firstSeen: null,
    _graceKept: null,
    _followers: null,
    _tokenCache: null,
    _lastGesture: null,
    _main: null,
    _mainAt: 0,
    _mainState: '',
    _listeners: null,
    _shortcutHandler: null,

    _zapperActive: false,
    _zapFrame: null,
    _zapUi: null,
    _zapCallback: null,
    _zapHistory: null,
    _zapParentKeyHandler: null,
    _zapScrollHandler: null,

    init(config = {}) {
      this.destroy();
      this._running = true;
      this._host = (window.location.hostname || 'localhost').toLowerCase().trim();
      this._hidden = new Map();
      this._styled = new Map();
      this._firstSeen = new WeakMap();
      this._graceKept = new WeakSet();
      this._followers = new WeakMap();
      this._tokenCache = new Map();
      this._lastGesture = { t: 0, interactive: false };
      this._listeners = [];
      this._zapHistory = [];
      this._config = this._withStandaloneConfig(config || {});
      this._level = this._readLevel(this._config);
      this._applySheet();
      this._listen();
      this._setupGlobalShortcut();
      this._schedule(0);
    },

    onConfigChange(newConfig) {
      const cfg = newConfig || {};
      const nextLevel = this._readLevel(cfg);
      const levelChanged = nextLevel !== this._level;
      this._config = cfg;
      this._level = nextLevel;
      if (!this._running) return;
      if (levelChanged) {
        this._restoreAll();
      } else {
        // Release zapped elements whose selector is no longer listed.
        const listed = this._zapSelectors();
        for (const [el, rec] of Array.from(this._hidden)) {
          if (rec.reason !== 'zap') continue;
          const still = listed.some(sel => {
            try { return el.matches(sel); } catch (e) { return false; }
          });
          if (!still) this._unhide(el);
        }
      }
      this._applySheet();
      this._schedule(0);
    },

    destroy() {
      this.stopZapper();
      this._running = false;
      if (this._scanTimer) clearTimeout(this._scanTimer);
      this._scanTimer = 0;
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      (this._listeners || []).forEach(([target, type, fn, opts]) => {
        try { target.removeEventListener(type, fn, opts); } catch (e) {}
      });
      this._listeners = [];
      if (this._shortcutHandler) {
        window.removeEventListener('keydown', this._shortcutHandler, true);
        this._shortcutHandler = null;
      }
      if (this._hidden) this._restoreAll();
      if (this._sheet) {
        try {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this._sheet);
        } catch (e) {}
        this._sheet = null;
      }
      if (this._styleEl) {
        this._styleEl.remove();
        this._styleEl = null;
      }
      const legacyStyle = document.getElementById('besing-ad-cleaner-style');
      if (legacyStyle) legacyStyle.remove();
      this._main = null;
    },

    // ---------- Settings ----------

    _readLevel(cfg) {
      const n = Number(cfg && cfg.level);
      if (cfg && cfg.level !== undefined && cfg.level !== null && cfg.level !== '' && Number.isFinite(n)) {
        return Math.round(Math.min(this.MAX_LEVEL, Math.max(0, n)) * 10) / 10;
      }
      return this.DEFAULT_LEVEL;
    },

    describeLevel(level) {
      const lv = Number(level);
      const hit = this.LEVEL_NAMES.find(([min]) => lv >= min - 1e-9) || this.LEVEL_NAMES[this.LEVEL_NAMES.length - 1];
      return { name: hit[1], detail: hit[2] };
    },

    _at(rule) {
      return this._level >= this.LEVELS[rule] - 1e-9;
    },

    _getManager() {
      return (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
             (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || null;
    },

    // Without the BESing manager, settings live in this site's localStorage.
    _withStandaloneConfig(config) {
      if (this._getManager() || Object.keys(config).length > 0) return config;
      try {
        const raw = window.localStorage.getItem(this.STANDALONE_STORAGE_KEY);
        return raw ? JSON.parse(raw) || {} : {};
      } catch (e) {
        return {};
      }
    },

    _persist(patch) {
      this._config = { ...(this._config || {}), ...patch };
      if (typeof this._zapCallback === 'function') {
        try { this._zapCallback(patch); } catch (e) {}
        return;
      }
      const mgr = this._getManager();
      if (mgr && typeof mgr.applyScriptConfig === 'function') {
        mgr.applyScriptConfig(this.id, patch);
        return;
      }
      try {
        window.localStorage.setItem(this.STANDALONE_STORAGE_KEY, JSON.stringify(this._config));
      } catch (e) {}
    },

    // Zapped selectors for this host, plus the pre-2.0 list that was not keyed by host.
    getZapLists(cfg = this._config) {
      const map = (cfg && cfg.zapped && typeof cfg.zapped === 'object') ? cfg.zapped : {};
      const host = this._host || (window.location.hostname || '').toLowerCase();
      return {
        site: Array.isArray(map[host]) ? map[host].filter(s => typeof s === 'string') : [],
        legacy: Array.isArray(cfg && cfg.blockedSelectors) ? cfg.blockedSelectors.filter(s => typeof s === 'string') : []
      };
    },

    _zapSelectors() {
      const { site, legacy } = this.getZapLists();
      return site.concat(legacy);
    },

    _saveSiteZaps(list) {
      const map = { ...((this._config && this._config.zapped) || {}) };
      if (list.length) map[this._host] = list;
      else delete map[this._host];
      this._persist({ zapped: map });
    },

    // ---------- Stylesheet ----------

    _buildCss() {
      const rules = ['[data-besing-ac]{display:none!important}'];
      const selectors = this._zapSelectors().slice();
      if (this._at('knownAds')) selectors.push(...this.KNOWN_AD_SELECTORS);
      // One rule per selector: an invalid selector only drops its own rule.
      selectors.forEach(sel => {
        if (sel && !/[{}]/.test(sel)) rules.push(`${sel}:not(html):not(body){display:none!important}`);
      });
      if (this._at('media')) {
        rules.push('img,picture,video,audio,canvas,embed,object,svg,figure,iframe:not([data-besing-ui]){display:none!important}');
        rules.push('*:not([data-besing-ui]),*::before,*::after{background-image:none!important}');
      }
      return rules.join('\n');
    },

    // A constructed sheet is CSSOM, so strict style-src CSP does not block it the way it blocks <style>.
    _applySheet() {
      const css = this._buildCss();
      try {
        if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
          if (!this._sheet) this._sheet = new CSSStyleSheet();
          this._sheet.replaceSync(css);
          this._ensureAdopted();
          if (document.adoptedStyleSheets.includes(this._sheet)) return;
        }
      } catch (e) {
        this._sheet = null;
      }
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'besing-ad-cleaner-style';
      }
      this._styleEl.textContent = css;
      this._ensureStyleEl();
    },

    _ensureAdopted() {
      if (!this._sheet) return;
      try {
        if (!document.adoptedStyleSheets.includes(this._sheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._sheet];
        }
      } catch (e) {}
    },

    _ensureStyleEl() {
      if (!this._styleEl || this._styleEl.isConnected) return;
      const parent = document.head || document.documentElement;
      if (parent) parent.appendChild(this._styleEl);
    },

    // ---------- Scheduling ----------

    _listen() {
      const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        this._listeners.push([target, type, fn, opts]);
      };
      const reschedule = () => this._schedule(200);
      on(window, 'scroll', reschedule, { passive: true });
      on(window, 'resize', reschedule, { passive: true });
      on(document, 'DOMContentLoaded', () => this._schedule(0), false);
      on(window, 'load', () => this._schedule(0), false);
      const gesture = (e) => {
        const t = e.target;
        const interactive = !!(t && t.closest && t.closest(
          'button,[role="button"],[role="menuitem"],[role="tab"],summary,label,select,input,a[href^="#"],a:not([href]),' +
          '[aria-haspopup],[aria-expanded],[aria-controls],[data-toggle],[data-bs-toggle]'));
        this._lastGesture = { t: Date.now(), interactive };
      };
      on(window, 'pointerdown', gesture, { capture: true, passive: true });
      on(window, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') gesture(e); }, { capture: true, passive: true });
      this._observe();
    },

    _observe() {
      const root = document.documentElement;
      if (!root) {
        setTimeout(() => { if (this._running && !this._observer) this._observe(); }, 20);
        return;
      }
      this._observer = new MutationObserver((records) => {
        let external = false;
        records.forEach(r => {
          const rec = r.type === 'attributes' ? this._styled.get(r.target) : null;
          if (!rec) {
            external = true;
            return;
          }
          // On elements this module handles, put back any style the page overwrote, without a full scan.
          if (r.attributeName !== 'style') return;
          rec.forEach((v, prop) => {
            if (r.target.style.getPropertyValue(prop) !== v.value || r.target.style.getPropertyPriority(prop) !== 'important') {
              r.target.style.setProperty(prop, v.value, 'important');
            }
          });
        });
        if (external) this._schedule(120);
      });
      this._observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'id', 'open', 'src'] });
    },

    _schedule(delay = 120) {
      if (!this._running || this._scanTimer) return;
      const minGap = Math.max(250, this._scanCost * 8);
      const wait = Math.max(delay, this._lastScanAt + minGap - Date.now(), 0);
      this._scanTimer = setTimeout(() => {
        this._scanTimer = 0;
        if (!this._running) return;
        const t0 = Date.now();
        try {
          this._scan();
        } catch (err) {
          console.warn('[BESing Ad Cleaner] scan failed', err);
        }
        this._lastScanAt = Date.now();
        this._scanCost = this._lastScanAt - t0;
        this._scanCount++;
      }, wait);
    },

    // ---------- Element helpers ----------

    _isOwnUi(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.localName.startsWith('besing')) return true;
      if (el.hasAttribute('data-besing-ui') || el.hasAttribute('data-pagestream-page')) return true;
      const tag = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      return /(^|[\s_])(besing|pagestream)/i.test(tag);
    },

    _tokens(el) {
      const id = el.getAttribute('id') || '';
      const cls = el.getAttribute('class') || '';
      if (!id && !cls) return null;
      const key = `${id} ${cls}`;
      let set = this._tokenCache.get(key);
      if (set) return set;
      const words = key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      set = new Set(words);
      for (let i = 0; i + 1 < words.length; i++) set.add(words[i] + words[i + 1]);
      // camelCase parts count only when long: generated ids such as Wikipedia's "mwAdQ" must not yield "ad".
      key.split(/[^A-Za-z0-9]+/).forEach(w => {
        w.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ').forEach(part => {
          if (part.length >= 4) set.add(part);
        });
      });
      if (this._tokenCache.size > 4000) this._tokenCache.clear();
      this._tokenCache.set(key, set);
      return set;
    },

    _hasToken(tokens, list) {
      if (!tokens) return false;
      for (let i = 0; i < list.length; i++) if (tokens.has(list[i])) return true;
      return false;
    },

    _textLen(el, ctx) {
      if (ctx && ctx.text.has(el)) return ctx.text.get(el);
      const n = (el.textContent || '').replace(/\s+/g, '').length;
      if (ctx) ctx.text.set(el, n);
      return n;
    },

    _site(host) {
      const h = String(host || '').toLowerCase();
      if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
      const parts = h.split('.').filter(Boolean);
      if (parts.length <= 2) return parts.join('.');
      // Two-letter country domains with a short second level (co.uk, com.cn, com.au) keep three labels.
      const keep = (parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) ? 3 : 2;
      return parts.slice(-keep).join('.');
    },

    _isSameSite(host) {
      return this._site(host) === this._site(this._host);
    },

    _hostIn(host, list) {
      return list.some(d => host === d || host.endsWith('.' + d));
    },

    _frameKind(el) {
      const raw = el.getAttribute('src') || el.getAttribute('data') || '';
      if (!raw || raw === 'about:blank' || /^javascript:/i.test(raw) || el.hasAttribute('srcdoc')) return 'blank';
      let url;
      try { url = new URL(raw, window.location.href); } catch (e) { return 'third'; }
      if (url.protocol === 'data:' || url.protocol === 'blob:') return 'blank';
      const host = url.hostname.toLowerCase();
      if (host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.gstatic.com')) {
        if (/^\/recaptcha/.test(url.pathname)) return 'essential';
        if (/^\/maps/.test(url.pathname) || host === 'maps.google.com') return 'embed';
      }
      if (this._hostIn(host, this.ESSENTIAL_HOSTS)) return 'essential';
      if (this._isSameSite(host)) return 'first';
      if (this._hostIn(host, this.EMBED_HOSTS)) return 'embed';
      return 'third';
    },

    _setStyle(el, prop, value) {
      let rec = this._styled.get(el);
      if (!rec) {
        rec = new Map();
        this._styled.set(el, rec);
      }
      if (!rec.has(prop)) {
        rec.set(prop, { value, orig: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
      } else {
        rec.get(prop).value = value;
      }
      el.style.setProperty(prop, value, 'important');
    },

    _restoreStyle(el, prop) {
      const rec = this._styled.get(el);
      if (!rec || !rec.has(prop)) return;
      const { orig, priority } = rec.get(prop);
      rec.delete(prop);
      if (orig) el.style.setProperty(prop, orig, priority);
      else el.style.removeProperty(prop);
      if (!rec.size) this._styled.delete(el);
    },

    _hide(el, reason) {
      if (!el || el.nodeType !== 1 || this._hidden.has(el) || this._isOwnUi(el)) return false;
      if (el === document.documentElement || el === document.body || el === document.head) return false;
      const rec = { reason, frames: [] };
      this._hidden.set(el, rec);
      this._setStyle(el, 'display', 'none');
      try { el.setAttribute('data-besing-ac', reason); } catch (e) {}
      // A hidden modal <dialog> or popover would still make the rest of the page inert.
      if (el.localName === 'dialog' && el.open) {
        try { el.close(); } catch (e) {}
      }
      try {
        if (el.matches(':popover-open')) el.hidePopover();
      } catch (e) {}
      this._silence(el, rec);
      return true;
    },

    // Hidden ads keep running and playing sound, so pause media and blank off-site frames inside.
    _silence(el, rec) {
      const media = el.matches('video,audio') ? [el] : Array.from(el.querySelectorAll('video,audio'));
      media.forEach(m => { try { m.pause(); } catch (e) {} });
      const frames = el.localName === 'iframe' ? [el] : Array.from(el.querySelectorAll('iframe'));
      frames.forEach(f => {
        const kind = this._frameKind(f);
        if (kind === 'blank' || kind === 'first' || f.hasAttribute('data-besing-ui')) return;
        const src = f.getAttribute('src');
        rec.frames.push([f, src]);
        try { f.setAttribute('src', 'about:blank'); } catch (e) {}
      });
    },

    _unhide(el) {
      const rec = this._hidden.get(el);
      if (!rec) return;
      this._hidden.delete(el);
      this._restoreStyle(el, 'display');
      try { el.removeAttribute('data-besing-ac'); } catch (e) {}
      rec.frames.forEach(([f, src]) => {
        try { if (src) f.setAttribute('src', src); } catch (e) {}
      });
    },

    _restoreAll() {
      Array.from(this._hidden.keys()).forEach(el => this._unhide(el));
      Array.from(this._styled.entries()).forEach(([el, rec]) => {
        Array.from(rec.keys()).forEach(prop => this._restoreStyle(el, prop));
      });
      this._hidden.clear();
      this._styled.clear();
    },

    // ---------- Main content ----------

    _findMain() {
      const body = document.body;
      if (!body) return null;
      const inline = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'FONT', 'SMALL', 'U', 'MARK', 'SUB', 'SUP', 'CODE', 'Q', 'CITE', 'ABBR', 'TIME', 'LABEL', 'S', 'DEL', 'INS', 'BIG']);
      const paragraphish = new Set(['P', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DD', 'DT', 'FIGCAPTION']);
      const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'OPTION', 'BUTTON', 'SELECT']);
      const cjk = /[぀-ヿ㐀-鿿가-힯]/;
      const scores = new Map();
      const add = (el, v) => { if (el && el !== document.documentElement) scores.set(el, (scores.get(el) || 0) + v); };
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node;
      let budget = 20000;
      while ((node = walker.nextNode()) && budget-- > 0) {
        const text = node.nodeValue.trim();
        const len = text.length;
        if (len < 8 || (len < 20 && !cjk.test(text))) continue;
        let p = node.parentElement;
        if (!p || skip.has(p.tagName)) continue;
        for (let i = 0; i < 4 && p && inline.has(p.tagName); i++) p = p.parentElement;
        if (!p) continue;
        if (p.closest('a,nav,header,footer,aside,[data-besing-ac],[id*="comment" i],[class*="comment" i]') || this._isOwnUi(p)) continue;
        const weight = cjk.test(text) ? len * 2 : len;
        if (paragraphish.has(p.tagName)) {
          add(p.parentElement, weight);
          add(p.parentElement && p.parentElement.parentElement, weight / 2);
        } else {
          add(p, weight);
          add(p.parentElement, weight / 2);
        }
      }
      let best = null;
      let bestScore = 0;
      scores.forEach((s, el) => {
        if (s > bestScore && el !== body) {
          best = el;
          bestScore = s;
        }
      });
      if (!best || bestScore < 500) return null;
      // Climb to take in the headline next to the text, as long as the parent adds little else.
      for (let i = 0; i < 3 && !best.querySelector('h1'); i++) {
        const parent = best.parentElement;
        if (!parent || parent === body || parent === document.documentElement) break;
        const heading = Array.from(parent.querySelectorAll('h1,h2')).find(h => !best.contains(h));
        if (!heading || this._textLen(parent) > this._textLen(best) * 1.25 + 300) break;
        best = parent;
      }
      return best;
    },

    // ---------- Scan ----------

    _scan() {
      const html = document.documentElement;
      const body = document.body;
      if (!html) return;
      if (this._sheet) this._ensureAdopted();
      else this._ensureStyleEl();
      if (!body) return;

      const now = Date.now();
      // Prune elements the page removed, and re-assert styles the page overwrote.
      this._styled.forEach((rec, el) => {
        if (!el.isConnected) {
          this._styled.delete(el);
          this._hidden.delete(el);
          return;
        }
        rec.forEach((v, prop) => {
          if (el.style.getPropertyValue(prop) !== v.value || el.style.getPropertyPriority(prop) !== 'important') {
            el.style.setProperty(prop, v.value, 'important');
          }
        });
      });

      const state = document.readyState;
      if (!this._main || !this._main.isConnected || now - this._mainAt > 2000 || state !== this._mainState) {
        // While the page is still parsing, the main content is not known yet, so main-based rules wait.
        this._main = state === 'loading' ? null : this._findMain();
        this._mainAt = now;
        this._mainState = state;
      }
      const main = this._main;
      const protect = new Set([html, body]);
      for (let n = main; n; n = n.parentElement) protect.add(n);
      protect.forEach(n => {
        const rec = this._hidden.get(n);
        if (rec && rec.reason !== 'zap') this._unhide(n);
      });

      const ctx = {
        main, protect, vw: window.innerWidth, vh: window.innerHeight, text: new Map(), hide: [], statics: [], adLeaves: []
      };
      const queue = (el, reason) => { if (el && !protect.has(el)) ctx.hide.push([el, reason]); };
      ctx.queue = queue;

      const querySafe = (sel, fn) => {
        try { document.querySelectorAll(sel).forEach(fn); } catch (e) {}
      };
      this._zapSelectors().forEach(sel => querySafe(sel, el => { if (el !== html && el !== body) ctx.hide.push([el, 'zap']); }));
      if (this._at('knownAds')) {
        this.KNOWN_AD_SELECTORS.forEach(sel => querySafe(sel, el => queue(el, 'known-ad')));
        this.CONSENT_SELECTORS.forEach(sel => querySafe(sel, el => {
          if (this._textLen(el, ctx) <= 3000) queue(el, 'consent');
        }));
      }

      // Read pass: every decision is collected first, so layout is computed once instead of after every write.
      const walker = document.createTreeWalker(html, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (el) => {
          if (el === document.head || this._hidden.has(el) || this._isOwnUi(el)) return NodeFilter.FILTER_REJECT;
          if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let el;
      while ((el = walker.nextNode())) {
        if (el === body) continue;
        const cs = window.getComputedStyle(el);
        const pos = cs.position;
        if (pos === 'fixed') this._checkFixed(el, cs, ctx, now);
        else if (pos === 'sticky' || pos === '-webkit-sticky') this._checkSticky(el, ctx);
        else if (pos === 'absolute' && this._at('floats')) this._checkFollower(el, cs, ctx);
        const tag = el.localName;
        if (tag === 'iframe' || tag === 'frame' || tag === 'embed' || tag === 'object') this._checkFrame(el, ctx);
        if (tag === 'iframe' || tag === 'ins' || tag === 'embed' || tag === 'object' || tag === 'canvas') ctx.adLeaves.push(el);
        if (this._at('thirdParty')) this._checkTokens(el, ctx);
        if (this._at('imageLinks')) {
          if (tag === 'a') this._checkImageLink(el, ctx);
          if (el.childElementCount === 0) this._checkAdLabel(el, ctx);
        }
      }
      if (this._at('thirdParty')) this._checkAdSizes(ctx);
      if (this._at('isolate') && main && document.readyState !== 'loading') this._isolate(ctx);

      // Write pass.
      const hiddenAds = [];
      ctx.hide.forEach(([target, reason]) => {
        if ((reason === 'zap' || !protect.has(target)) && this._hide(target, reason) && this.AD_REASONS.includes(reason)) {
          hiddenAds.push(target);
        }
      });
      this._collapseShells(hiddenAds, ctx);
      ctx.statics.forEach(target => this._setStyle(target, 'position', 'static'));
      if (this._at('overlays')) this._unlockPage(ctx);
      if (this._at('media')) {
        document.querySelectorAll('video,audio').forEach(m => { try { if (!m.paused) m.pause(); } catch (e) {} });
      }
    },

    _rectOf(el) {
      const r = el.getBoundingClientRect();
      if ((r.width < 2 || r.height < 2) && el.childElementCount > 0) {
        // Zero-size fixed wrappers whose children are what shows.
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        Array.from(el.children).forEach(c => {
          const cr = c.getBoundingClientRect();
          if (cr.width < 1 || cr.height < 1) return;
          left = Math.min(left, cr.left); top = Math.min(top, cr.top);
          right = Math.max(right, cr.right); bottom = Math.max(bottom, cr.bottom);
        });
        if (right > left && bottom > top) return { left, top, right, bottom, width: right - left, height: bottom - top };
      }
      return r;
    },

    _keptForUser(el, now) {
      if (this._graceKept.has(el)) return this._level < this.USER_POPUP_GRACE_BELOW;
      if (!this._firstSeen.has(el)) {
        this._firstSeen.set(el, now);
        const g = this._lastGesture;
        if (g.interactive && now >= g.t && now - g.t <= this.USER_POPUP_GRACE_MS) this._graceKept.add(el);
      }
      return this._graceKept.has(el) && this._level < this.USER_POPUP_GRACE_BELOW;
    },

    _checkFixed(el, cs, ctx, now) {
      if (ctx.protect.has(el) || cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = this._rectOf(el);
      if (r.width < 2 || r.height < 2) return;
      if (this._keptForUser(el, now)) return;
      // Without a detected main content, a text-heavy fixed element may be the page itself.
      if (!ctx.main && this._textLen(el, ctx) > 2000) return;
      const visW = Math.max(0, Math.min(r.right, ctx.vw) - Math.max(r.left, 0));
      const visH = Math.max(0, Math.min(r.bottom, ctx.vh) - Math.max(r.top, 0));
      const coverage = (visW * visH) / Math.max(1, ctx.vw * ctx.vh);
      const isHeader = r.top <= 4 && r.width >= ctx.vw * 0.6 && r.height <= ctx.vh * 0.3;
      if (this._at('allFloating')) ctx.queue(el, 'fixed');
      else if (this._at('floats') && !isHeader) ctx.queue(el, 'float');
      else if (this._at('overlays') && coverage >= 0.25) ctx.queue(el, 'overlay');
    },

    _checkSticky(el, ctx) {
      if (this._styled.has(el) && this._styled.get(el).has('position')) return;
      const isHeader = /^(header|nav)$/.test(el.localName) ||
        /^(banner|navigation)$/.test(el.getAttribute('role') || '') || this._hasToken(this._tokens(el), this.NAV_TOKENS);
      if (this._at('allFloating') || (this._at('thirdParty') && !isHeader)) ctx.statics.push(el);
    },

    // Absolutely positioned elements that a script keeps at the same screen spot while the page scrolls.
    _checkFollower(el, cs, ctx) {
      const z = parseInt(cs.zIndex, 10);
      if (!(z > 0) || ctx.protect.has(el)) return;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 1000 || area > ctx.vw * ctx.vh * 0.6) return;
      const sy = window.scrollY;
      const prev = this._followers.get(el);
      this._followers.set(el, { top: r.top, sy });
      if (prev && Math.abs(sy - prev.sy) > 60 && Math.abs(r.top - prev.top) < 3) ctx.queue(el, 'follower');
    },

    _checkFrame(el, ctx) {
      if (el.hasAttribute('data-besing-ui')) return;
      const kind = this._frameKind(el);
      const inMain = !!(ctx.main && ctx.main.contains(el));
      if (kind === 'third' && this._at('thirdParty')) {
        ctx.queue(el, 'iframe');
      } else if (kind === 'blank' && el.localName === 'iframe' && this._at('imageLinks')) {
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 30) return;
        let editable = false;
        try { editable = !!(el.contentDocument && el.contentDocument.body && el.contentDocument.body.isContentEditable); } catch (e) {}
        if (!editable) ctx.queue(el, 'iframe');
      } else if (kind === 'embed' && !inMain && this._at('allFloating')) {
        ctx.queue(el, 'iframe');
      } else if (this._at('media')) {
        ctx.queue(el, 'media');
      }
    },

    _checkTokens(el, ctx) {
      if (ctx.protect.has(el)) return;
      const tokens = this._tokens(el);
      const role = el.getAttribute('role') || '';
      const outside = !!ctx.main && !ctx.main.contains(el);
      if (tokens && this._hasToken(tokens, this.AD_TOKENS)) {
        if (this._textLen(el, ctx) <= 1500) ctx.queue(el, 'ad-class');
        return;
      }
      if (this._at('comments') && (this._hasToken(tokens, this.COMMENT_TOKENS) || el.id === 'disqus_thread')) {
        ctx.queue(el, 'comments');
        return;
      }
      if (!outside) return;
      if (this._at('sidebars') && (el.localName === 'aside' || role === 'complementary' || this._hasToken(tokens, this.SIDEBAR_TOKENS))) {
        ctx.queue(el, 'sidebar');
        return;
      }
      if (this._at('widgets') && this._hasToken(tokens, this.WIDGET_TOKENS)) {
        ctx.queue(el, 'widget');
      }
    },

    _checkImageLink(a, ctx) {
      if (ctx.protect.has(a)) return;
      const href = a.getAttribute('href') || '';
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
      let host;
      try { host = new URL(href, window.location.href).hostname.toLowerCase(); } catch (e) { return; }
      if (!host || this._isSameSite(host)) return;
      if (!a.querySelector('img,picture,video,canvas,svg')) return;
      if ((a.textContent || '').trim().length >= 40) return;
      ctx.queue(this._sameBoxWrapper(a, ctx), 'image-link');
    },

    _checkAdLabel(el, ctx) {
      const raw = (el.textContent || '').trim();
      if (!raw || raw.length > 24) return;
      const norm = raw.replace(/[\s\-–—_|·•:：()[\]【】（）「」]/g, '').toLowerCase();
      if (!this.AD_LABELS.includes(norm)) return;
      let best = null;
      let cur = el.parentElement;
      for (let i = 0; i < 5 && cur && !ctx.protect.has(cur) && cur !== document.body; i++) {
        if (this._textLen(cur, ctx) - norm.length > 300) break;
        best = cur;
        cur = cur.parentElement;
      }
      if (best) ctx.queue(best, 'ad-label');
    },

    _checkAdSizes(ctx) {
      const near = (a, b) => Math.abs(a - b) <= 3;
      ctx.adLeaves.forEach(leaf => {
        let cur = leaf;
        for (let i = 0; i < 4 && cur && !ctx.protect.has(cur) && cur !== document.body; i++) {
          const r = cur.getBoundingClientRect();
          if (this.AD_SIZES.some(([w, h]) => near(r.width, w) && near(r.height, h)) && this._textLen(cur, ctx) < 60) {
            ctx.queue(this._sameBoxWrapper(cur, ctx), 'ad-size');
            return;
          }
          cur = cur.parentElement;
        }
      });
    },

    // The outermost ancestor that draws the same box, so the whole slot goes instead of leaving its frame.
    _sameBoxWrapper(el, ctx) {
      let cur = el;
      const r = el.getBoundingClientRect();
      for (let i = 0; i < 6; i++) {
        const p = cur.parentElement;
        if (!p || p === document.body || p === document.documentElement || (ctx && ctx.protect.has(p))) break;
        const pr = p.getBoundingClientRect();
        if (Math.abs(pr.left - r.left) <= 4 && Math.abs(pr.top - r.top) <= 4 &&
            Math.abs(pr.right - r.right) <= 4 && Math.abs(pr.bottom - r.bottom) <= 4) cur = p;
        else break;
      }
      return cur;
    },

    _isPager(el, ctx) {
      if (this._hasToken(this._tokens(el), this.PAGER_TOKENS)) return true;
      if (this._textLen(el, ctx) > 400) return false;
      const links = el.matches('a') ? [el] : Array.from(el.querySelectorAll('a'));
      return links.some(a => /^(next|prev)$/i.test(a.getAttribute('rel') || '') ||
        this.PAGER_LINK_RE.test((a.textContent || '').trim()));
    },

    // Ad slots leave their wrappers behind as empty boxes with margins or a fixed height; hide wrappers
    // that show nothing once the ad inside is gone.
    _collapseShells(hiddenAds, ctx) {
      const visible = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.getClientRects().length > 0);
      const seen = new Set();
      hiddenAds.forEach(el => {
        let cur = el.parentElement;
        for (let i = 0; i < 3 && cur && !ctx.protect.has(cur) && !seen.has(cur); i++) {
          seen.add(cur);
          if (this._hidden.has(cur) || this._isOwnUi(cur)) break;
          if ((cur.innerText || '').trim() !== '') break;
          const content = cur.querySelectorAll('img,picture,video,iframe,canvas,svg,object,embed,input,button,select,textarea');
          if (Array.from(content).some(visible)) break;
          this._hide(cur, 'ad-shell');
          cur = cur.parentElement;
        }
      });
    },

    // Hide every sibling along the path from <body> to the main content.
    _isolate(ctx) {
      const keepNav = !this._at('media');
      for (let n = ctx.main; n && n !== document.body && n.parentElement; n = n.parentElement) {
        Array.from(n.parentElement.children).forEach(s => {
          if (s === n || ctx.protect.has(s) || this._isOwnUi(s)) return;
          if (/^(script|style|link|meta|noscript|template)$/.test(s.localName)) return;
          if (keepNav && (/^(header|nav)$/.test(s.localName) || /^(banner|navigation)$/.test(s.getAttribute('role') || '') ||
              this._hasToken(this._tokens(s), this.NAV_TOKENS))) return;
          if (this._isPager(s, ctx)) return;
          ctx.queue(s, 'isolate');
        });
      }
    },

    // Popups lock scrolling, blur the page or disable clicks on it; undo that.
    _unlockPage(ctx) {
      const html = document.documentElement;
      const body = document.body;
      const scroller = document.scrollingElement || html;
      const htmlCs = getComputedStyle(html);
      const bodyCs = getComputedStyle(body);
      const scrollable = scroller.scrollHeight > window.innerHeight + 40;
      if (scrollable && htmlCs.overflowY === 'hidden') this._setStyle(html, 'overflow-y', 'auto');
      if (scrollable && bodyCs.overflowY === 'hidden') this._setStyle(body, 'overflow-y', 'visible');
      if (bodyCs.position === 'fixed' && scrollable) this._setStyle(body, 'position', 'static');
      if (bodyCs.pointerEvents === 'none') this._setStyle(body, 'pointer-events', 'auto');
      if (htmlCs.pointerEvents === 'none') this._setStyle(html, 'pointer-events', 'auto');
      ctx.protect.forEach(n => {
        if (n === html) return;
        const f = getComputedStyle(n).filter;
        if (f && f.includes('blur')) this._setStyle(n, 'filter', 'none');
        if (n.hasAttribute('inert')) n.removeAttribute('inert');
      });
    },

    // ---------- Status ----------

    getStats() {
      const byReason = {};
      if (this._hidden) this._hidden.forEach(rec => { byReason[rec.reason] = (byReason[rec.reason] || 0) + 1; });
      let statics = 0;
      if (this._styled) this._styled.forEach((rec, el) => { if (rec.has('position') && el !== document.body) statics++; });
      const main = this._main;
      let mainLabel = 'none';
      if (main) {
        mainLabel = main.localName + (main.id ? `#${main.id}` : '') +
          (typeof main.className === 'string' && main.className.trim() ? '.' + main.className.trim().split(/\s+/)[0] : '');
      }
      return { level: this._level, hidden: this._hidden ? this._hidden.size : 0, byReason, statics, main: mainLabel, scans: this._scanCount, scanMs: this._scanCost };
    },

    debugStatus() {
      const s = this.getStats();
      const reasons = Object.entries(s.byReason).map(([k, v]) => `${k}:${v}`).join(',');
      const sheet = this._sheet ? 'adopted' : (this._styleEl && this._styleEl.isConnected ? 'style' : 'NO-SHEET');
      return `ad L${s.level} ${sheet} hidden=${s.hidden}${reasons ? `(${reasons})` : ''} static=${s.statics} main=${s.main} scans=${s.scans}/${s.scanMs}ms`;
    },

    // ---------- Element Zapper ----------

    _setupGlobalShortcut() {
      if (this._shortcutHandler) return;
      this._shortcutHandler = (e) => {
        if (e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
          e.preventDefault();
          if (this._zapperActive) this.stopZapper();
          else this.startZapper();
        }
      };
      window.addEventListener('keydown', this._shortcutHandler, true);
    },

    _stableToken(s) {
      if (!s || s.length > 40 || /^\d/.test(s) || s.includes('__besing')) return false;
      if (/^(css|sc|jsx|emotion|styled|svelte|astro|tw|_)-?[a-z0-9]{4,}$/i.test(s) && /\d/.test(s)) return false;
      if (/\d{3,}/.test(s)) return false;
      if (/[a-z]/i.test(s) && (s.match(/\d/g) || []).length >= 2 && s.length >= 6 && !/[-_]/.test(s)) return false;
      if (/__[a-z0-9]{5,}$/i.test(s) || s.includes(':')) return false;
      return true;
    },

    safeEscape(str) {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
      return String(str).replace(/([ #;&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
    },

    _isUniqueSelector(sel, el) {
      try {
        const m = document.querySelectorAll(sel);
        return m.length === 1 && m[0] === el;
      } catch (e) {
        return false;
      }
    },

    // Shortest path of stable ids, classes and positions that matches only this element.
    computeSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return '';
      const parts = [];
      let cur = el;
      for (let depth = 0; cur && cur.nodeType === 1 && depth < 8; depth++) {
        if (cur === document.body) {
          parts.unshift('body');
          break;
        }
        if (cur === document.documentElement) break;
        const id = cur.getAttribute('id');
        let part;
        if (id && this._stableToken(id)) {
          part = `#${this.safeEscape(id)}`;
        } else {
          const tag = this.safeEscape(cur.localName);
          const classes = Array.from(cur.classList).filter(c => !c.startsWith('besing') && this._stableToken(c)).slice(0, 2);
          part = tag + classes.map(c => `.${this.safeEscape(c)}`).join('');
          const parent = cur.parentElement;
          if (parent) {
            const same = Array.from(parent.children).filter(s => s.localName === cur.localName);
            if (same.length > 1) {
              let ambiguous = classes.length === 0;
              if (!ambiguous) {
                try { ambiguous = parent.querySelectorAll(`:scope > ${part}`).length > 1; } catch (e) { ambiguous = true; }
              }
              if (ambiguous) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
            }
          }
        }
        parts.unshift(part);
        const sel = parts.join(' > ');
        if (this._isUniqueSelector(sel, el)) return sel;
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    },

    // The element a tap means: a whole floating bar when any part of it is tapped, otherwise the outermost
    // wrapper drawing the same box as the tapped element.
    _resolveTarget(el) {
      const body = document.body;
      const main = this._main;
      let floating = null;
      for (let n = el; n && n !== body && n !== document.documentElement; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if ((pos === 'fixed' || pos === 'sticky' || pos === '-webkit-sticky') && !(main && n.contains(main))) floating = n;
      }
      if (floating) return floating;
      return this._sameBoxWrapper(el, null);
    },

    _targetAt(x, y) {
      const list = document.elementsFromPoint(x, y);
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (el === this._zapFrame || el === document.documentElement || el === document.body) continue;
        if (this._isOwnUi(el)) continue;
        return this._resolveTarget(el);
      }
      return null;
    },

    startZapper(onZappedCallback) {
      if (this._zapperActive) return;
      if (!this._hidden) {
        // Launched while the cleaner is off: run with zaps only.
        this.init({ ...(this._config || {}), level: 0 });
      }
      this._zapperActive = true;
      this._zapCallback = typeof onZappedCallback === 'function' ? onZappedCallback : null;
      this._zapHistory = [];
      window.__BESING_ZAPPER_ACTIVE__ = true;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = true; } catch (e) {}
      }
      const mgr = this._getManager();
      if (mgr && typeof mgr.closeModal === 'function') mgr.closeModal();

      // A same-origin frame over the whole page: taps land in it, so neither the page nor its ad frames
      // receive any event while zapping.
      const frame = document.createElement('iframe');
      frame.setAttribute('data-besing-ui', 'zapper');
      frame.setAttribute('aria-label', 'BESing Element Zapper');
      frame.setAttribute('title', 'BESing Element Zapper');
      const supportsPopover = typeof frame.showPopover === 'function';
      if (supportsPopover) frame.setAttribute('popover', 'manual');
      const fs = frame.style;
      [['position', 'fixed'], ['inset', '0'], ['top', '0'], ['left', '0'], ['width', '100%'], ['height', '100%'],
        ['max-width', 'none'], ['max-height', 'none'], ['margin', '0'], ['padding', '0'], ['border', '0'],
        ['background', 'transparent'], ['z-index', '2147483647'], ['display', 'block'], ['visibility', 'visible'],
        ['opacity', '1'], ['pointer-events', 'auto'], ['color-scheme', 'normal'], ['transform', 'none'], ['filter', 'none']
      ].forEach(([p, v]) => fs.setProperty(p, v, 'important'));
      frame.addEventListener('load', () => this._buildZapperUi(frame));
      (document.documentElement || document.body).appendChild(frame);
      if (supportsPopover) {
        try { frame.showPopover(); } catch (e) {}
      }
      this._zapFrame = frame;
      this._buildZapperUi(frame);

      this._zapParentKeyHandler = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.stopZapper();
        }
      };
      window.addEventListener('keydown', this._zapParentKeyHandler, true);
      this._zapScrollHandler = () => {
        if (this._zapUi && this._zapUi.lastPoint && this._zapUi.lastPoint.mouse) {
          this._zapHover(this._zapUi.lastPoint.x, this._zapUi.lastPoint.y);
        }
      };
      window.addEventListener('scroll', this._zapScrollHandler, { passive: true });
    },

    _buildZapperUi(frame) {
      if (!this._zapperActive || frame !== this._zapFrame) return;
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById('besing-zap-root')) return;
      if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
      if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
      const css = (el, text) => { el.style.cssText = text; return el; };
      css(doc.documentElement, 'margin:0;padding:0;height:100%;background:transparent;color-scheme:normal;overflow:hidden;');
      css(doc.body, 'margin:0;padding:0;height:100%;background:transparent;overflow:hidden;touch-action:none;cursor:crosshair;' +
        '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;');

      const root = css(doc.createElement('div'), 'position:fixed;inset:0;');
      root.id = 'besing-zap-root';

      const box = css(doc.createElement('div'), 'position:fixed;display:none;pointer-events:none;border:2.5px solid #ef4444;' +
        'background:rgba(239,68,68,0.22);border-radius:4px;box-shadow:0 0 16px rgba(239,68,68,0.6);box-sizing:border-box;');
      const badge = css(doc.createElement('div'), 'position:absolute;left:-2px;bottom:100%;margin-bottom:3px;background:#ef4444;color:#fff;' +
        'font:700 10px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:2px 6px;border-radius:4px;white-space:nowrap;' +
        'max-width:90vw;overflow:hidden;text-overflow:ellipsis;');
      box.appendChild(badge);

      const hud = css(doc.createElement('div'), 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:calc(100% - 24px);' +
        'max-width:520px;box-sizing:border-box;background:rgba(15,23,42,0.96);border:1.5px solid rgba(239,68,68,0.7);border-radius:12px;' +
        'padding:8px 10px;box-shadow:0 10px 30px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:6px;cursor:default;color:#f1f5f9;');
      const row = css(doc.createElement('div'), 'display:flex;align-items:center;gap:8px;');
      const tag = css(doc.createElement('span'), 'background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;flex-shrink:0;');
      tag.textContent = '⚡ ZAPPER';
      const hint = css(doc.createElement('span'), 'font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
      hint.textContent = 'Tap anything to hide it';
      row.appendChild(tag);
      row.appendChild(hint);
      const btnStyle = 'background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:12px;' +
        'font-weight:700;padding:6px 10px;border-radius:7px;cursor:pointer;flex:1;font-family:inherit;';
      const actions = css(doc.createElement('div'), 'display:flex;gap:6px;');
      const mkBtn = (label, title, fn) => {
        const b = css(doc.createElement('button'), btnStyle);
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
        actions.appendChild(b);
        return b;
      };
      mkBtn('↶ Undo', 'Show the last hidden element again', () => this._zapUndo());
      mkBtn('⬆ Bigger', 'Hide the container around the last hidden element instead', () => this._zapWider());
      const done = mkBtn('✓ Done', 'Leave the Zapper (Esc)', () => this.stopZapper());
      done.style.background = '#ef4444';
      done.style.borderColor = '#ef4444';
      const status = css(doc.createElement('div'), 'font:600 10px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#4ade80;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:14px;');
      hud.appendChild(row);
      hud.appendChild(actions);
      hud.appendChild(status);

      root.appendChild(box);
      root.appendChild(hud);
      doc.body.appendChild(root);
      this._zapUi = { doc, box, badge, hud, status, down: null, lastPoint: null, raf: 0 };

      const inHud = (e) => hud.contains(e.target);
      doc.addEventListener('pointerdown', (e) => {
        if (inHud(e)) return;
        e.preventDefault();
        this._zapUi.down = { x: e.clientX, y: e.clientY, lastY: e.clientY, lastX: e.clientX, panning: false, id: e.pointerId };
        if (e.pointerType !== 'mouse') this._zapHover(e.clientX, e.clientY);
      });
      doc.addEventListener('pointermove', (e) => {
        const ui = this._zapUi;
        if (!ui) return;
        ui.lastPoint = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
        const d = ui.down;
        if (d && e.pointerType !== 'mouse') {
          // Touch drags scroll the page underneath.
          if (!d.panning && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) {
            d.panning = true;
            box.style.display = 'none';
          }
          if (d.panning) {
            window.scrollBy(d.lastX - e.clientX, d.lastY - e.clientY);
            d.lastX = e.clientX;
            d.lastY = e.clientY;
          }
          return;
        }
        if (inHud(e)) {
          box.style.display = 'none';
          return;
        }
        if (ui.raf) return;
        ui.raf = requestAnimationFrame(() => {
          ui.raf = 0;
          if (this._zapUi === ui && ui.lastPoint) this._zapHover(ui.lastPoint.x, ui.lastPoint.y);
        });
      });
      doc.addEventListener('pointerup', (e) => {
        const d = this._zapUi && this._zapUi.down;
        if (this._zapUi) this._zapUi.down = null;
        if (inHud(e) || !d || d.panning) return;
        if (e.button !== undefined && e.button > 0) return;
        e.preventDefault();
        const target = this._targetAt(e.clientX, e.clientY);
        if (target) this._zapElement(target);
        else this._zapStatus('Nothing to hide here');
        box.style.display = 'none';
      });
      doc.addEventListener('pointercancel', () => { if (this._zapUi) this._zapUi.down = null; });
      doc.addEventListener('wheel', (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);
        window.scrollBy(e.deltaX * unit, e.deltaY * unit);
      }, { passive: false });
      doc.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.stopZapper();
      });
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.stopZapper();
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) this._zapUndo();
      });
      try { frame.contentWindow.focus(); } catch (e) {}
    },

    _zapHover(x, y) {
      const ui = this._zapUi;
      if (!ui) return;
      const target = this._targetAt(x, y);
      if (!target) {
        ui.box.style.display = 'none';
        return;
      }
      const r = target.getBoundingClientRect();
      ui.box.style.display = 'block';
      ui.box.style.left = `${r.left}px`;
      ui.box.style.top = `${r.top}px`;
      ui.box.style.width = `${r.width}px`;
      ui.box.style.height = `${r.height}px`;
      ui.badge.style.bottom = r.top < 24 ? 'auto' : '100%';
      ui.badge.style.top = r.top < 24 ? '2px' : 'auto';
      ui.badge.textContent = `${this.computeSelector(target)} (${Math.round(r.width)}×${Math.round(r.height)})`;
    },

    _zapStatus(text) {
      if (this._zapUi) this._zapUi.status.textContent = text;
    },

    _zapElement(target) {
      const sel = this.computeSelector(target);
      if (!sel) return;
      this._hide(target, 'zap');
      const { site } = this.getZapLists();
      const list = site.includes(sel) ? site : site.concat([sel]);
      this._zapHistory.push({ el: target, sel, added: !site.includes(sel) });
      this._saveSiteZaps(list);
      this._applySheet();
      this._zapStatus(`Hidden: ${sel}`);
    },

    _zapUndo() {
      const last = this._zapHistory.pop();
      if (!last) {
        this._zapStatus('Nothing to undo');
        return;
      }
      this._unhide(last.el);
      if (last.added) {
        const { site } = this.getZapLists();
        this._saveSiteZaps(site.filter(s => s !== last.sel));
        this._applySheet();
      }
      this._zapStatus(`Restored: ${last.sel}`);
    },

    _zapWider() {
      const last = this._zapHistory[this._zapHistory.length - 1];
      if (!last) {
        this._zapStatus('Hide something first');
        return;
      }
      const parent = last.el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) {
        this._zapStatus('Already the largest block');
        return;
      }
      this._zapUndo();
      this._zapElement(this._sameBoxWrapper(parent, null));
    },

    stopZapper() {
      if (!this._zapperActive && !this._zapFrame) return;
      this._zapperActive = false;
      window.__BESING_ZAPPER_ACTIVE__ = false;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = false; } catch (e) {}
      }
      if (this._zapUi && this._zapUi.raf) cancelAnimationFrame(this._zapUi.raf);
      this._zapUi = null;
      if (this._zapFrame) {
        this._zapFrame.remove();
        this._zapFrame = null;
      }
      if (this._zapParentKeyHandler) {
        window.removeEventListener('keydown', this._zapParentKeyHandler, true);
        this._zapParentKeyHandler = null;
      }
      if (this._zapScrollHandler) {
        window.removeEventListener('scroll', this._zapScrollHandler, { passive: true });
        this._zapScrollHandler = null;
      }
      this._zapCallback = null;
      this._zapHistory = [];
    }
  };

  if (typeof window !== 'undefined') {
    window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
    window.__BESING_SCRIPTS__['ad-cleaner'] = AdCleaner;
    if (!window.__BESING_EMBEDDED__) {
      const top = (() => { try { return window.top === window.self; } catch (e) { return false; } })();
      if (top) AdCleaner.init();
    }
  }
})();
