// ==UserScript==
// @name         BESing Script Manager
// @namespace    https://github.com/CoronRing/BESing
// @version      1.4.1
// @description  Universal Browser Extension & Greasy Fork Script Manager with 4-way edge folding, desktop pet themes, non-blocking anchored bubble menu, and bundled productivity tools.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      raw.githubusercontent.com
// @connect      update.greasyfork.org
// @connect      greasyfork.org
// @updateURL    https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js
// @downloadURL  https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 1. Unified Adapter Layer
  const BESAdapter = {
    isGM: typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
    isExt: typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local,

    async get(key, defaultValue = null) {
      if (this.isGM) {
        try {
          const val = GM_getValue(key, defaultValue);
          return val !== undefined ? val : defaultValue;
        } catch (e) {
          return defaultValue;
        }
      }
      if (this.isExt) {
        return new Promise(resolve => {
          chrome.storage.local.get([key], res => {
            resolve(res[key] !== undefined ? res[key] : defaultValue);
          });
        });
      }
      try {
        const item = window.localStorage.getItem('besing_' + key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },

    async set(key, value) {
      if (this.isGM) {
        try { GM_setValue(key, value); return true; } catch (e) { return false; }
      }
      if (this.isExt) {
        return new Promise(resolve => {
          chrome.storage.local.set({ [key]: value }, () => resolve(true));
        });
      }
      try {
        window.localStorage.setItem('besing_' + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },

    registerMenu(name, cb) {
      if (typeof GM_registerMenuCommand === 'function') {
        try { GM_registerMenuCommand(name, cb); } catch (e) {}
      }
    }
  };

  // 2. Storage Manager
  class BESStorage {
    constructor() {
      this.blockedSites = [];
      this.enabledScripts = {};
      this.widgetPos = null;
      this.settings = {
        theme: 'cyber-pet',
        agentUrl: 'http://127.0.0.1:8765/api/sync',
        authToken: '',
        updateChannel: 'github',
        autoCheckUpdates: true
      };
    }

    async init() {
      this.blockedSites = await BESAdapter.get('blocked_sites', []);
      this.enabledScripts = await BESAdapter.get('enabled_scripts', {});
      this.widgetPos = await BESAdapter.get('widget_position', null);
      const s = await BESAdapter.get('global_settings', {});
      this.settings = { ...this.settings, ...s };
      if (!Array.isArray(this.blockedSites)) this.blockedSites = [];
    }

    isCurrentBlocked() {
      const cur = (window.location.hostname || '').toLowerCase().trim();
      return this.blockedSites.some(b => b.host.toLowerCase() === cur);
    }

    async blockSite(host = window.location.hostname) {
      const clean = (host || '').toLowerCase().trim();
      if (!clean) return;
      this.blockedSites = this.blockedSites.filter(b => b.host.toLowerCase() !== clean);
      this.blockedSites.unshift({ host: clean, addedAt: Date.now() });
      await BESAdapter.set('blocked_sites', this.blockedSites);
    }

    async unblockSite(host) {
      const clean = (host || '').toLowerCase().trim();
      this.blockedSites = this.blockedSites.filter(b => b.host.toLowerCase() !== clean);
      await BESAdapter.set('blocked_sites', this.blockedSites);
    }

    getBlockedSites() {
      return this.blockedSites || [];
    }

    // Default to FALSE: all modules are OFF by default!
    isScriptEnabled(id, defaultVal = false) {
      if (this.enabledScripts[id] !== undefined) {
        return !!this.enabledScripts[id];
      }
      return defaultVal;
    }

    async setScriptEnabled(id, enabled) {
      this.enabledScripts[id] = !!enabled;
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
    }

    getWidgetPosition() {
      return this.widgetPos;
    }

    async setWidgetPosition(pos) {
      this.widgetPos = pos;
      await BESAdapter.set('widget_position', pos);
    }

    getTheme() {
      return this.settings.theme || 'cyber-pet';
    }

    async setTheme(theme) {
      this.settings.theme = theme;
      await BESAdapter.set('global_settings', this.settings);
    }

    async updateSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      await BESAdapter.set('global_settings', this.settings);
    }
  }

  // 3. Pre-bundled Modules (Off by default, zero remote eval)
  const BUILTIN_MODULES = [
    // Module: Reading Assistant
    (() => {
      const mod = {
    id: 'reading-assistant',
    name: 'Reading Assistant',
    version: '1.0.0',
    description: 'Calculates word count, reading duration, and provides a quick jump heading outline.',
    category: 'Productivity',
    _dom: null,

    init() {
      this.destroy();
      const text = document.body ? document.body.innerText || '' : '';
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const readMin = Math.max(1, Math.ceil(words / 200));
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(h => h.innerText.trim()).slice(0, 15);

      const badge = document.createElement('div');
      badge.id = 'besing-reading-assistant-badge';
      badge.style.cssText = `position:fixed;bottom:24px;left:24px;z-index:999980;background:rgba(15,23,42,0.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:9999px;padding:8px 16px;color:#e2e8f0;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;user-select:none;transition:all 0.2s ease;`;
      badge.innerHTML = `<span style="display:flex;align-items:center;gap:5px;color:#38bdf8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>${readMin} min</span><span style="color:rgba(255,255,255,0.25);">|</span><span style="color:#94a3b8;">${words.toLocaleString()} words</span>${headings.length ? `<span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;">${headings.length} headings</span>` : ''}`;

      let popover = null;
      badge.onclick = (e) => {
        e.stopPropagation();
        if (popover) { popover.remove(); popover = null; return; }
        if (!headings.length) return;
        popover = document.createElement('div');
        popover.style.cssText = `position:fixed;bottom:74px;left:24px;width:300px;max-height:360px;overflow-y:auto;background:#0f172a;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:14px;color:#f1f5f9;font-family:-apple-system,sans-serif;font-size:13px;box-shadow:0 16px 36px rgba(0,0,0,0.5);z-index:999981;`;
        popover.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:#38bdf8;font-size:12px;text-transform:uppercase;">Document Outline</div>';
        headings.forEach(h => {
          const item = document.createElement('div');
          const level = parseInt(h.tagName[1], 10);
          item.style.cssText = `padding:5px 8px;margin-bottom:2px;border-radius:6px;cursor:pointer;padding-left:${(level-1)*12 + 6}px;color:${level===1?'#f8fafc':(level===2?'#cbd5e1':'#94a3b8')};font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
          item.textContent = h.innerText.trim();
          item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.08)';
          item.onmouseleave = () => item.style.background = 'transparent';
          item.onclick = (ev) => {
            ev.stopPropagation();
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            popover.remove(); popover = null;
          };
          popover.appendChild(item);
        });
        document.body.appendChild(popover);
        const closeDoc = () => { if (popover) { popover.remove(); popover = null; } document.removeEventListener('click', closeDoc); };
        setTimeout(() => document.addEventListener('click', closeDoc), 50);
      };

      document.body.appendChild(badge);
      this._dom = badge;
    },

    destroy() {
      if (this._dom) { this._dom.remove(); this._dom = null; }
      const b = document.getElementById('besing-reading-assistant-badge');
      if (b) b.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\"></path><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Productivity";
      return mod;
    })(),

    // Module: Night Comfort Dimmer
    (() => {
      const mod = {
    id: 'dark-dimmer',
    name: 'Night Comfort Dimmer',
    version: '1.0.0',
    description: 'Gentle screen dimming filter and tint to soothe eyes during late hours.',
    category: 'Accessibility',
    _node: null,

    init() {
      this.destroy();
      const layer = document.createElement('div');
      layer.id = 'besing-dark-dimmer-layer';
      layer.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,0.32);backdrop-filter:contrast(0.95) brightness(0.9);pointer-events:none;z-index:999970;transition:opacity 0.3s ease;`;
      document.documentElement.appendChild(layer);
      this._node = layer;
    },

    destroy() {
      if (this._node) { this._node.remove(); this._node = null; }
      const l = document.getElementById('besing-dark-dimmer-layer');
      if (l) l.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Accessibility";
      return mod;
    })(),

    // Module: Markdown Link Copier
    (() => {
      const mod = {
    id: 'quick-copy',
    name: 'Markdown Link Copier',
    version: '1.0.0',
    description: 'Press Alt+C to copy current page title & URL formatted as Markdown [Title](URL).',
    category: 'Tools',
    _handler: null,

    init() {
      this.destroy();
      this._handler = (e) => {
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          const title = (document.title || 'Untitled').replace(/[\[\]]/g, '');
          const md = `[${title}](${window.location.href})`;
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(md).then(() => this.toast(title));
          }
        }
      };
      window.addEventListener('keydown', this._handler);
    },

    toast(title) {
      const t = document.createElement('div');
      t.style.cssText = `position:fixed;top:24px;right:24px;background:#0f172a;color:#38bdf8;border:1px solid rgba(56,189,248,0.4);padding:10px 18px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;box-shadow:0 10px 25px rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;gap:8px;`;
      t.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied Markdown: "${title.slice(0, 25)}..."</span>`;
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s ease'; setTimeout(() => t.remove(), 300); }, 2000);
    },

    destroy() {
      if (this._handler) {
        window.removeEventListener('keydown', this._handler);
        this._handler = null;
      }
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"></path><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Tools";
      return mod;
    })(),

    // Module: Ad Cleaner Lite
    (() => {
      const mod = {
    id: 'ad-cleaner',
    name: 'Ad Cleaner Lite',
    version: '1.0.0',
    description: 'Hides intrusive floating overlays, sticky marketing banners, and cookie popups.',
    category: 'Privacy',
    _styleEl: null,

    init() {
      this.destroy();
      const style = document.createElement('style');
      style.id = 'besing-ad-cleaner-style';
      style.textContent = `
        [class*="cookie-banner"], [id*="cookie-banner"],
        [class*="consent-banner"], [id*="consent-banner"],
        [class*="popup-overlay"]:not(#__besing_root__ *),
        [class*="newsletter-popup"], [id*="newsletter-modal"],
        .ad-banner, .ads-placement {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
      this._styleEl = style;
    },

    destroy() {
      if (this._styleEl) {
        this._styleEl.remove();
        this._styleEl = null;
      }
      const el = document.getElementById('besing-ad-cleaner-style');
      if (el) el.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Privacy";
      return mod;
    })(),

    // Module: Color Change
    (() => {
      const mod = {
    id: 'color-change',
    name: 'Color Change',
    version: '1.0.0',
    description: 'Changes page background color to red.',
    category: 'Visual',
    _prevBg: null,

    init() {
      this._prevBg = document.body ? document.body.style.backgroundColor : null;
      if (document.body) {
        document.body.style.backgroundColor = 'red';
      }
    },

    destroy() {
      if (document.body) {
        document.body.style.backgroundColor = this._prevBg || '';
      }
      this._prevBg = null;
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"#ef4444\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/></svg>";
      mod.author = "BESing Team";
      mod.category = "Visual";
      return mod;
    })(),

    // Module: Prevent Redirect
    (() => {
      const mod = {
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
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\" ry=\"2\"></rect><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Security";
      return mod;
    })()
  ];

  // 4. Update Engine (Checks version, prompts native update, no eval)
  class BESUpdater {
    static CURRENT_VERSION = '1.4.1';

    static CHANNELS = {
      github: {
        name: 'GitHub Releases (Stable)',
        metaUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js',
        userUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js'
      },
      greasyfork: {
        name: 'Greasy Fork (Public)',
        metaUrl: 'https://update.greasyfork.org/scripts/520000/besing-script-manager.meta.js',
        userUrl: 'https://update.greasyfork.org/scripts/520000/besing-script-manager.user.js'
      }
    };

    static async fetchText(url) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'GET',
            url: `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`,
            timeout: 7000,
            onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error('HTTP ' + res.status)),
            onerror: (err) => reject(new Error(err.error || 'Network error')),
            ontimeout: () => reject(new Error('Timeout'))
          });
        } else {
          fetch(`${url}?_t=${Date.now()}`, { cache: 'no-cache' })
            .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
            .then(resolve)
            .catch(reject);
        }
      });
    }

    static parseVersion(metaText) {
      const match = metaText.match(/@version\s+([0-9\.]+)/i);
      return match ? match[1].trim() : null;
    }

    static compareVersions(vA, vB) {
      const a = (vA || '0').split('.').map(n => parseInt(n, 10) || 0);
      const b = (vB || '0').split('.').map(n => parseInt(n, 10) || 0);
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {
        const numA = a[i] || 0;
        const numB = b[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
      }
      return 0;
    }

    async checkForUpdates(manual = false) {
      const channelKey = 'github';
      const channel = BESUpdater.CHANNELS[channelKey];
      try {
        const text = await BESUpdater.fetchText(channel.metaUrl);
        const remoteVer = BESUpdater.parseVersion(text);
        if (!remoteVer) throw new Error('Could not parse remote version header');
        const hasUpdate = BESUpdater.compareVersions(remoteVer, BESUpdater.CURRENT_VERSION) > 0;
        return {
          ok: true,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          remoteVersion: remoteVer,
          hasUpdate,
          downloadUrl: channel.userUrl
        };
      } catch (err) {
        return {
          ok: false,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          error: err.message
        };
      }
    }

    triggerInstall(downloadUrl) {
      const url = downloadUrl || BESUpdater.CHANNELS.github.userUrl;
      window.open(url, '_blank');
    }
  }

  // 5. App Core & UI Controller
  class BESManagerApp {
    constructor() {
      this.storage = new BESStorage();
      this.updater = new BESUpdater();
      this.modules = [];
      this.host = null;
      this.shadow = null;
      this.widgetEl = null;
      this.menuWrapperEl = null;
      this.searchQuery = '';
      this.currentView = 'extensions';
      this.isExpanded = false;
      this.isDragging = false;
      this.dragMoved = false;
      this.startX = 0;
      this.startY = 0;
      this.initialLeft = 0;
      this.initialTop = 0;
      this.updateAvailable = null;
      this.lastFoldSide = null;
    }

    async init() {
      await this.storage.init();

      // Initialize pre-bundled modules (All default to OFF)
      this.modules = BUILTIN_MODULES.map(m => ({
        ...m,
        enabled: this.storage.isScriptEnabled(m.id, false)
      }));

      // Run any modules that were previously enabled by user
      this.modules.forEach(m => {
        if (m.enabled) {
          try { m.init(); } catch (err) {
            console.error(`[BESing] Error initializing ${m.id}:`, err);
          }
        }
      });

      // Throttled Daily Update Check
      const lastCheck = await BESAdapter.get('last_update_check_time', 0);
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - (lastCheck || 0) > ONE_DAY) {
        setTimeout(async () => {
          await this.updater.checkForUpdates(false).catch(() => {});
          await BESAdapter.set('last_update_check_time', Date.now());
        }, 4000);
      }

      // Hotkey: Alt + Shift + B
      window.addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }
      });

      BESAdapter.registerMenu('BESing: Script Manager', () => {
        this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
      });

      if (this.storage.isCurrentBlocked()) {
        console.log(`[BESing] Inactive on ${window.location.hostname} (Site blocked)`);
        return;
      }

      this.mount();
    }

    mount() {
      if (this.host) return;
      const host = document.createElement('besing-host');
      host.id = '__besing_root__';
      document.documentElement.appendChild(host);
      this.host = host;

      const shadow = host.attachShadow({ mode: 'open' });
      this.shadow = shadow;

      this.injectStyles(shadow);
      this.renderWidget(shadow);

      window.addEventListener('besing:redirect-blocked', () => {
        this.blinkRedirectAlert();
      });
    }

    blinkRedirectAlert() {
      if (!this.widgetEl) return;
      this.widgetEl.classList.remove('redirect-alert');
      void this.widgetEl.offsetWidth;
      this.widgetEl.classList.add('redirect-alert');
      setTimeout(() => {
        if (this.widgetEl) this.widgetEl.classList.remove('redirect-alert');
      }, 1200);
    }

    teardown() {
      this.modules.forEach(m => {
        try { m.destroy(); } catch (e) {}
      });
      if (this.host) {
        this.host.remove();
        this.host = null;
        this.shadow = null;
        this.widgetEl = null;
        this.menuWrapperEl = null;
      }
    }

    renderWidget(shadow) {
      const btn = document.createElement('div');
      btn.className = 'besing-trigger';
      btn.id = 'besing-widget-btn';

      const savedPos = this.storage.getWidgetPosition();
      if (savedPos && savedPos.x !== undefined && savedPos.y !== undefined) {
        btn.style.left = `${savedPos.x}px`;
        btn.style.top = `${savedPos.y}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      } else {
        btn.style.right = '18px';
        btn.style.bottom = '90px';
      }

      this.widgetEl = btn;
      this.updatePetIcon(btn);
      this.updateBadge();
      this.setupDragging(btn);
      shadow.appendChild(btn);

      setTimeout(() => this.checkEdgeDocking(btn), 150);
    }

    updateBadge() {
      if (!this.widgetEl) return;
      let badge = this.widgetEl.querySelector('.besing-badge-count');
      const activeCount = this.modules.filter(m => this.storage.isScriptEnabled(m.id, false)).length;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'besing-badge-count';
        this.widgetEl.appendChild(badge);
      }
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'flex' : 'none';
    }

    updatePetIcon(btn) {
      const theme = this.storage.getTheme();
      let inner = '';
      if (theme === 'minimal') {
        inner = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
        `;
      } else if (theme === 'pixel-dino') {
        inner = `
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="18" rx="6" fill="#14532d" stroke="#4ade80" stroke-width="1.5"/>
            <rect x="10" y="13" width="3" height="4" fill="#86efac" class="besing-pet-eye"/>
            <rect x="19" y="13" width="3" height="4" fill="#86efac" class="besing-pet-eye"/>
            <path d="M12 21h8" stroke="#86efac" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `;
      } else if (theme === 'slime') {
        inner = `
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M7 22C7 13 10 9 16 9C22 9 25 13 25 22C25 25 21 26 16 26C11 26 7 25 7 22Z" fill="#065f46" stroke="#34d399" stroke-width="1.5"/>
            <circle cx="12" cy="17" r="2" fill="#a7f3d0" class="besing-pet-eye"/>
            <circle cx="20" cy="17" r="2" fill="#a7f3d0" class="besing-pet-eye"/>
            <path d="M14 21C15 22 17 22 18 21" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      } else {
        // Cyber Pet (Default)
        inner = `
          <svg class="besing-pet-face" width="30" height="30" viewBox="0 0 32 32" fill="none">
            <path d="M7 10L11 14V11C11 9 13 7 16 7C19 7 21 9 21 11V14L25 10C26 9 27 10 27 12V21C27 24 24 26 21 26H11C8 26 5 24 5 21V12C5 10 6 9 7 10Z" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
            <ellipse class="besing-pet-eye" cx="11.5" cy="17" rx="2" ry="3" fill="#38bdf8"/>
            <ellipse class="besing-pet-eye" cx="20.5" cy="17" rx="2" ry="3" fill="#38bdf8"/>
            <path d="M14 21.5C15 22.5 17 22.5 18 21.5" stroke="#c084fc" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      }
      btn.innerHTML = inner;
      this.updateBadge();
    }

    setupDragging(btn) {
      const onStart = (e) => {
        if (e.target.closest('.besing-bubble-wrapper')) return;
        this.isDragging = true;
        this.dragMoved = false;
        const pt = e.touches ? e.touches[0] : e;
        this.startX = pt.clientX;
        this.startY = pt.clientY;

        const rect = btn.getBoundingClientRect();
        this.initialLeft = rect.left;
        this.initialTop = rect.top;

        btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        btn.style.transition = 'none';

        window.addEventListener('mousemove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
      };

      const onMove = (e) => {
        if (!this.isDragging) return;
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - this.startX;
        const dy = pt.clientY - this.startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          this.dragMoved = true;
          if (e.cancelable) e.preventDefault();
        }

        const newL = Math.max(0, Math.min(window.innerWidth - 48, this.initialLeft + dx));
        const newT = Math.max(0, Math.min(window.innerHeight - 48, this.initialTop + dy));

        btn.style.left = `${newL}px`;
        btn.style.top = `${newT}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';

        if (this.menuWrapperEl) {
          this.positionBubble(this.menuWrapperEl, this.menuWrapperEl.querySelector('.besing-bubble-panel'), this.menuWrapperEl.querySelector('.besing-bubble-arrow'));
        }
      };

      const onEnd = () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        btn.style.transition = '';

        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);

        const rect = btn.getBoundingClientRect();
        this.storage.setWidgetPosition({ x: Math.round(rect.left), y: Math.round(rect.top) });
        this.checkEdgeDocking(btn);

        if (!this.dragMoved) {
          this.toggleModal();
        }
      };

      btn.addEventListener('mousedown', onStart);
      btn.addEventListener('touchstart', onStart, { passive: true });
    }

    checkEdgeDocking(btn) {
      const doc = document.documentElement;
      const clientW = doc ? doc.clientWidth : window.innerWidth;
      const clientH = doc ? doc.clientHeight : window.innerHeight;
      const rect = btn.getBoundingClientRect();
      const margin = 14;

      btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

      if (rect.right >= clientW - margin) {
        btn.classList.add('folded-right');
      } else if (rect.left <= margin) {
        btn.classList.add('folded-left');
      }

      if (rect.top <= margin) {
        btn.classList.add('folded-top');
      } else if (rect.bottom >= clientH - margin) {
        btn.classList.add('folded-bottom');
      }
    }

    toggleModal() {
      if (this.menuWrapperEl) {
        this.closeModal();
      } else {
        this.openModal('extensions');
      }
    }

    openModal(view = 'extensions') {
      if (this.menuWrapperEl) this.closeModal();
      this.currentView = view;

      const wrapper = document.createElement('div');
      wrapper.className = 'besing-bubble-wrapper';

      const arrow = document.createElement('div');
      arrow.className = 'besing-bubble-arrow';
      wrapper.appendChild(arrow);

      const panel = document.createElement('div');
      panel.className = 'besing-bubble-panel';
      wrapper.appendChild(panel);

      panel.innerHTML = `
        <div class="besing-header">
          <div class="besing-logo-group">
            <div class="besing-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <div>
              <span class="besing-title">BESing</span>
              <span class="besing-tag">v${BESUpdater.CURRENT_VERSION}</span>
            </div>
          </div>
          <div class="besing-header-actions">
            <button class="besing-btn-icon" id="besing-btn-settings" title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button class="besing-btn-icon" id="besing-btn-expand" title="Toggle Size">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
              </svg>
            </button>
            <button class="besing-btn-icon" id="besing-btn-close" title="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="besing-body" id="besing-body"></div>
      `;

      this.shadow.appendChild(wrapper);
      this.menuWrapperEl = wrapper;

      this.positionBubble(wrapper, panel, arrow);

      panel.querySelector('#besing-btn-close').onclick = () => this.closeModal();
      panel.querySelector('#besing-btn-expand').onclick = () => {
        this.isExpanded = !this.isExpanded;
        panel.classList.toggle('is-expanded', this.isExpanded);
        this.positionBubble(wrapper, panel, arrow);
      };

      const settingsBtn = panel.querySelector('#besing-btn-settings');
      settingsBtn.onclick = () => {
        this.currentView = this.currentView === 'settings' ? 'extensions' : 'settings';
        settingsBtn.classList.toggle('active', this.currentView === 'settings');
        this.renderBody();
      };

      setTimeout(() => {
        const outsideHandler = (e) => {
          if (!this.menuWrapperEl) return;
          const path = e.composedPath ? e.composedPath() : [];
          if (!path.includes(wrapper) && (!this.widgetEl || !path.includes(this.widgetEl))) {
            this.closeModal();
            document.removeEventListener('click', outsideHandler);
          }
        };
        document.addEventListener('click', outsideHandler);
      }, 50);

      this.renderBody();
    }

    positionBubble(wrapper, panel, arrow) {
      if (this.isExpanded) {
        wrapper.style.left = '50%';
        wrapper.style.top = '50%';
        wrapper.style.bottom = 'auto';
        wrapper.style.right = 'auto';
        wrapper.style.transform = 'translate(-50%, -50%)';
        arrow.style.display = 'none';
        return;
      }

      arrow.style.display = 'block';
      const bubbleW = 390;
      const margin = 14;

      if (this.widgetEl) {
        const doc = document.documentElement;
        const clientW = doc ? doc.clientWidth : window.innerWidth;
        const clientH = doc ? doc.clientHeight : window.innerHeight;
        const rect = this.widgetEl.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const left = Math.max(margin, Math.min(clientW - bubbleW - margin, center - bubbleW / 2));
        const isBottom = rect.top > clientH / 2;

        if (isBottom) {
          wrapper.style.bottom = `${clientH - rect.top + 10}px`;
          wrapper.style.top = 'auto';
          arrow.className = 'besing-bubble-arrow arrow-bottom';
        } else {
          wrapper.style.top = `${rect.bottom + 10}px`;
          wrapper.style.bottom = 'auto';
          arrow.className = 'besing-bubble-arrow arrow-top';
        }

        wrapper.style.left = `${left}px`;
        wrapper.style.right = 'auto';
        wrapper.style.transform = 'none';

        const arrowX = Math.max(16, Math.min(bubbleW - 24, center - left - 7));
        arrow.style.left = `${arrowX}px`;
      } else {
        wrapper.style.right = '20px';
        wrapper.style.bottom = '80px';
        arrow.style.display = 'none';
      }
    }

    renderBody() {
      const body = this.menuWrapperEl.querySelector('#besing-body');
      body.innerHTML = '';

      if (this.currentView === 'settings') {
        const currentHost = window.location.hostname || 'localhost';
        const blocked = this.storage.getBlockedSites();
        const curTheme = this.storage.getTheme();

        body.innerHTML = `
          <div class="besing-settings-section">
            <div class="besing-theme-picker">
              <div class="besing-section-title">Display Pattern & Desktop Pet</div>
              <div class="besing-theme-grid">
                <button class="besing-theme-btn ${curTheme==='cyber-pet'?'active':''}" data-t="cyber-pet">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="5" y="8" width="22" height="18" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/><ellipse cx="11.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/><ellipse cx="20.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/></svg>
                  <span>Cyber Pet</span>
                </button>
                <button class="besing-theme-btn ${curTheme==='slime'?'active':''}" data-t="slime">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><path d="M7 22C7 13 10 9 16 9C22 9 25 13 25 22C25 25 21 26 16 26C11 26 7 25 7 22Z" fill="#065f46" stroke="#34d399" stroke-width="2"/></svg>
                  <span>Cozy Slime</span>
                </button>
                <button class="besing-theme-btn ${curTheme==='pixel-dino'?'active':''}" data-t="pixel-dino">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="6" y="8" width="20" height="18" rx="6" fill="#14532d" stroke="#4ade80" stroke-width="2"/></svg>
                  <span>Pixel Dino</span>
                </button>
                <button class="besing-theme-btn ${curTheme==='minimal'?'active':''}" data-t="minimal">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
                  <span>Minimal</span>
                </button>
              </div>
            </div>

            <div class="besing-update-card">
              <div class="besing-update-header">
                <span class="besing-section-title">Update Channel</span>
                <span class="besing-status-pill connected" id="besing-update-pill">
                  <span id="besing-update-pill-text">v${BESUpdater.CURRENT_VERSION}</span>
                </span>
              </div>
              <div class="besing-update-actions">
                <button class="besing-btn-sync" id="besing-btn-check-update" style="flex:1;">Check Updates Now (Force)</button>
              </div>
              <div class="besing-update-msg" id="besing-update-msg">Updates check automatically at launch and once every 24 hours.</div>
            </div>

            <div class="besing-site-card">
              <div class="besing-site-card-header">
                <div>
                  <div class="besing-section-title" style="color:#f87171;">Disable on Current Site</div>
                  <div class="besing-current-domain">${currentHost}</div>
                </div>
                <button class="besing-btn-danger" id="besing-btn-turn-off-site">Disable</button>
              </div>
            </div>

            <div class="besing-blocked-list-wrap">
              <div class="besing-blocklist-header">
                <span class="besing-blocklist-title">Disabled Sites</span>
                <span class="besing-blocklist-count">${blocked.length}</span>
              </div>
              <div class="besing-blocked-list" id="besing-blocked-container"></div>
            </div>
          </div>
        `;

        body.querySelectorAll('.besing-theme-btn').forEach(btn => {
          btn.onclick = async () => {
            const t = btn.getAttribute('data-t');
            await this.storage.setTheme(t);
            this.updatePetIcon(this.widgetEl);
            body.querySelectorAll('.besing-theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          };
        });

        const checkBtn = body.querySelector('#besing-btn-check-update');
        const updateMsg = body.querySelector('#besing-update-msg');
        checkBtn.onclick = async () => {
          checkBtn.disabled = true;
          updateMsg.textContent = 'Checking for updates...';
          try {
            const res = await this.updater.checkForUpdates(true);
            if (res.ok) {
              if (res.hasUpdate) {
                updateMsg.innerHTML = `<span style="color:#a78bfa;font-weight:700;">Update found!</span> v${res.remoteVersion} available. <a href="${res.downloadUrl}" target="_blank" style="color:#38bdf8;text-decoration:underline;">Click here to install update</a>.`;
              } else {
                updateMsg.textContent = `✅ BESing is up to date (v${res.currentVersion}).`;
              }
            } else {
              updateMsg.textContent = `Check failed: ${res.error}`;
            }
          } catch (err) {
            updateMsg.textContent = `Error: ${err.message}`;
          } finally {
            checkBtn.disabled = false;
          }
        };

        body.querySelector('#besing-btn-turn-off-site').onclick = async () => {
          if (confirm(`Disable BESing on ${currentHost}?`)) {
            await this.storage.blockSite(currentHost);
            this.teardown();
          }
        };

        const renderBlockedRows = () => {
          const container = body.querySelector('#besing-blocked-container');
          if (!container) return;
          const list = this.storage.getBlockedSites();
          container.innerHTML = '';
          if (!list.length) {
            container.innerHTML = '<div class="besing-empty-state">No sites disabled.</div>';
            return;
          }
          list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'besing-blocked-item';
            row.innerHTML = `
              <div>
                <span class="besing-blocked-domain">${item.host}</span>
                <span class="besing-blocked-date">${new Date(item.addedAt).toLocaleDateString()}</span>
              </div>
              <button class="besing-btn-unblock">Re-enable</button>
            `;
            row.querySelector('.besing-btn-unblock').onclick = async () => {
              await this.storage.unblockSite(item.host);
              renderBlockedRows();
              const cnt = body.querySelector('.besing-blocklist-count');
              if (cnt) cnt.textContent = this.storage.getBlockedSites().length;
            };
            container.appendChild(row);
          });
        };
        renderBlockedRows();

      } else {
        // Extensions View: All scripts pre-installed, off by default, toggleable!
        body.innerHTML = `
          <div class="besing-search-wrap">
            <svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="besing-search-input" placeholder="Search installed scripts..." value="${this.searchQuery}">
          </div>
          <div class="besing-ext-list" id="besing-ext-container"></div>
        `;

        const searchInput = body.querySelector('.besing-search-input');
        const extContainer = body.querySelector('#besing-ext-container');

        const renderCards = () => {
          extContainer.innerHTML = '';
          const q = this.searchQuery;
          const filtered = this.modules.filter(m => {
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
          });

          const header = document.createElement('div');
          header.className = 'besing-section-heading';
          header.innerHTML = `
            <span>Installed Scripts</span>
            <span class="besing-pill-count">${filtered.length}</span>
          `;
          extContainer.appendChild(header);

          if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'besing-empty-state';
            empty.textContent = q ? 'No scripts match your search.' : 'No scripts found.';
            extContainer.appendChild(empty);
            return;
          }

          filtered.forEach(m => {
            const card = document.createElement('div');
            card.className = 'besing-ext-card';
            const isEnabled = this.storage.isScriptEnabled(m.id, false);

            card.innerHTML = `
              <div class="besing-ext-info-group">
                <div class="besing-ext-icon">${m.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}</div>
                <div class="besing-ext-meta">
                  <div class="besing-ext-title-row">
                    <span class="besing-ext-name">${m.name}</span>
                    <span class="besing-ext-ver">v${m.version || '1.0.0'}</span>
                    ${m.category ? `<span class="besing-cat-badge">${m.category}</span>` : ''}
                  </div>
                  <p class="besing-ext-desc">${m.description || ''}</p>
                </div>
              </div>
              <div class="besing-ext-actions">
                <label class="besing-switch" title="Toggle ${m.name}">
                  <input type="checkbox" ${isEnabled ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>
            `;

            card.querySelector('input').onchange = async (e) => {
              const val = e.target.checked;
              await this.storage.setScriptEnabled(m.id, val);
              m.enabled = val;
              if (val) {
                try { m.init(); } catch (err) {
                  console.error(`[BESing] Failed to start ${m.id}:`, err);
                }
              } else {
                try { m.destroy(); } catch (err) {
                  console.error(`[BESing] Failed to stop ${m.id}:`, err);
                }
              }
              this.updateBadge();
            };

            extContainer.appendChild(card);
          });
        };

        searchInput.oninput = (e) => {
          this.searchQuery = e.target.value.toLowerCase().trim();
          renderCards();
        };

        renderCards();
      }
    }

    closeModal() {
      if (this.menuWrapperEl) {
        this.menuWrapperEl.remove();
        this.menuWrapperEl = null;
      }
      if (this.storage.isCurrentBlocked()) {
        this.teardown();
      }
    }

    injectStyles(shadow) {
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .besing-trigger { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483640; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }
        .besing-trigger:hover { transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); }
        .besing-trigger:active { cursor: grabbing; transform: scale(0.95); }
        .besing-trigger.folded-left { transform: translateX(-65%); opacity: 0.82; }
        .besing-trigger.folded-right { transform: translateX(32px); clip-path: inset(-12px 32px -12px -12px); opacity: 0.82; }
        .besing-trigger.folded-top { transform: translateY(-65%); opacity: 0.82; }
        .besing-trigger.folded-bottom { transform: translateY(65%); opacity: 0.82; }
        .besing-trigger.folded-top.folded-left { transform: translate(-55%, -55%); }
        .besing-trigger.folded-top.folded-right { transform: translate(32px, -55%); clip-path: inset(-12px 32px -12px -12px); }
        .besing-trigger.folded-bottom.folded-left { transform: translate(-55%, 55%); }
        .besing-trigger.folded-bottom.folded-right { transform: translate(32px, 55%); clip-path: inset(-12px 32px -12px -12px); }
        .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover { transform: translate(0, 0) scale(1.08); clip-path: none; opacity: 1; }
        .besing-trigger.folded-right::before { content: ""; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-left::after { content: ""; position: absolute; right: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-top:not(.folded-right)::before, .besing-trigger.folded-top.folded-right::after { content: ""; position: absolute; bottom: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-bottom:not(.folded-left)::after, .besing-trigger.folded-bottom.folded-left::before { content: ""; position: absolute; top: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.redirect-alert { border-color: #ef4444 !important; box-shadow: 0 0 20px rgba(239, 68, 68, 0.9), 0 0 35px rgba(239, 68, 68, 0.6) !important; }
        .besing-trigger.redirect-alert::before, .besing-trigger.redirect-alert::after { background: #ef4444 !important; box-shadow: 0 0 16px #ef4444, 0 0 26px #ef4444 !important; animation: besingBarBlink 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite !important; }
        @keyframes besingBarBlink { 0%, 100% { opacity: 1; transform: scale(1.15); } 50% { opacity: 0.15; transform: scale(0.85); } }
        .besing-badge-count { position: absolute; top: -2px; right: -2px; background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; font-size: 10px; font-weight: 700; height: 18px; min-width: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 2px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
        .besing-pet-eye { transform-origin: center; animation: petBlink 4.5s infinite; }
        .besing-pet-face:hover .besing-pet-eye { animation: none; transform: scaleY(0.2) translateY(1px); }
        @keyframes petBlink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
        .besing-bubble-wrapper { position: fixed; z-index: 2147483642; pointer-events: auto; animation: besingBubblePop 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-arrow { position: absolute; width: 14px; height: 14px; background: #0d1322; border: 1px solid rgba(255, 255, 255, 0.14); transform: rotate(45deg); z-index: 2; }
        .besing-bubble-arrow.arrow-bottom { bottom: -7px; border-top: none; border-left: none; }
        .besing-bubble-arrow.arrow-top { top: -7px; border-bottom: none; border-right: none; }
        .besing-bubble-panel { width: 390px; max-width: calc(100vw - 28px); max-height: 520px; background: linear-gradient(180deg, rgba(16, 23, 38, 0.98) 0%, rgba(9, 13, 22, 0.99) 100%); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 18px; box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.75), 0 0 30px rgba(99, 102, 241, 0.16); display: flex; flex-direction: column; overflow: hidden; color: #e2e8f0; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-panel.is-expanded { width: 540px; max-height: 80vh; }
        .besing-header { padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02); }
        .besing-logo-group { display: flex; align-items: center; gap: 10px; }
        .besing-logo-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #3b82f6); display: flex; align-items: center; justify-content: center; color: #ffffff; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4); }
        .besing-title { font-size: 14px; font-weight: 700; color: #f8fafc; }
        .besing-tag { font-size: 10px; font-weight: 600; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.3); }
        .besing-header-actions { display: flex; align-items: center; gap: 6px; }
        .besing-btn-icon { background: transparent; border: none; color: #94a3b8; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-icon:hover { background: rgba(255, 255, 255, 0.08); color: #f8fafc; }
        .besing-btn-icon.active { background: rgba(99, 102, 241, 0.25); color: #818cf8; }
        .besing-body { padding: 14px 18px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px; }
        .besing-search-wrap { position: relative; display: flex; align-items: center; }
        .besing-search-icon { position: absolute; left: 12px; color: #64748b; pointer-events: none; }
        .besing-search-input { width: 100%; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 8px 12px 8px 34px; color: #f1f5f9; font-size: 13px; outline: none; transition: border-color 0.2s, background 0.2s; }
        .besing-search-input:focus { border-color: #6366f1; background: rgba(15, 23, 42, 0.9); box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25); }
        .besing-search-input::placeholder { color: #64748b; }
        .besing-ext-list { display: flex; flex-direction: column; gap: 8px; }
        .besing-ext-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; transition: all 0.2s ease; }
        .besing-ext-card:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.13); transform: translateY(-1px); }
        .besing-ext-info-group { display: flex; gap: 10px; align-items: flex-start; flex: 1; }
        .besing-ext-icon { width: 32px; height: 32px; border-radius: 8px; background: rgba(99, 102, 241, 0.12); color: #818cf8; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid rgba(99, 102, 241, 0.2); }
        .besing-ext-meta { display: flex; flex-direction: column; gap: 2px; }
        .besing-ext-title-row { display: flex; align-items: center; gap: 6px; }
        .besing-ext-name { font-size: 13px; font-weight: 600; color: #f1f5f9; }
        .besing-ext-ver { font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; }
        .besing-ext-desc { font-size: 11px; color: #94a3b8; line-height: 1.35; }
        .besing-switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }
        .besing-switch input { opacity: 0; width: 0; height: 0; }
        .besing-slider { position: absolute; cursor: pointer; inset: 0; background-color: #334155; transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 22px; }
        .besing-slider::before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: #ffffff; transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 50%; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
        .besing-switch input:checked + .besing-slider { background-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35); }
        .besing-switch input:checked + .besing-slider::before { transform: translateX(18px); }
        .besing-settings-section { display: flex; flex-direction: column; gap: 14px; }
        .besing-theme-picker { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
        .besing-theme-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .besing-theme-btn { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #cbd5e1; font-size: 11px; cursor: pointer; transition: all 0.15s ease; }
        .besing-theme-btn:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(99, 102, 241, 0.4); }
        .besing-theme-btn.active { background: rgba(99, 102, 241, 0.2); border-color: #818cf8; color: #f8fafc; box-shadow: 0 0 10px rgba(99, 102, 241, 0.25); }
        .besing-site-card { background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-site-card-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-current-domain { font-size: 12px; font-weight: 600; color: #fca5a5; font-family: monospace; }
        .besing-btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); color: #ffffff; border: none; border-radius: 8px; padding: 7px 12px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease; }
        .besing-btn-danger:hover { background: linear-gradient(135deg, #f87171, #ef4444); transform: translateY(-1px); }
        .besing-blocklist-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-blocklist-title { font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; }
        .besing-blocklist-count { font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.05); padding: 2px 6px; border-radius: 10px; }
        .besing-blocked-list { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }
        .besing-blocked-item { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 7px 10px; display: flex; align-items: center; justify-content: space-between; }
        .besing-blocked-domain { font-family: monospace; font-size: 11px; color: #e2e8f0; }
        .besing-blocked-date { font-size: 10px; color: #64748b; margin-left: 6px; }
        .besing-btn-unblock { background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 5px; padding: 3px 8px; font-size: 10px; font-weight: 600; cursor: pointer; }
        .besing-btn-unblock:hover { background: rgba(56, 189, 248, 0.25); color: #7dd3fc; }
        .besing-empty-state { text-align: center; padding: 18px 10px; color: #64748b; font-size: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed rgba(255, 255, 255, 0.08); }
        .besing-update-card { background: rgba(167, 139, 250, 0.06); border: 1px solid rgba(167, 139, 250, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-update-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-update-actions { display: flex; gap: 8px; }
        .besing-btn-sync { background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.15s ease; }
        .besing-btn-sync:hover { background: rgba(56, 189, 248, 0.25); color: #e0f2fe; }
        .besing-update-msg { font-size: 10px; color: #cbd5e1; min-height: 14px; line-height: 1.35; }
        @keyframes besingBubblePop { 0% { opacity: 0; transform: scale(0.92) translateY(6px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .besing-section-heading { display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin: 4px 0 2px 0; }
        .besing-pill-count { background: rgba(255, 255, 255, 0.08); color: #cbd5e1; font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600; }
        .besing-cat-badge { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); color: #a5b4fc; margin-left: 4px; }
        .besing-ext-actions { display: flex; align-items: center; gap: 8px; }
      `;
      shadow.appendChild(style);
    }
  }

  const app = new BESManagerApp();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
  } else {
    app.init();
  }
})();
