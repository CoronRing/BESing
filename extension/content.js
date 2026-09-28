/**
 * BESing - Chrome Extension Manifest V3 Content Script
 * Version 1.1.0: Corner Folding, Desktop Pet Patterns, Non-blocking Anchored Bubble Menu, & Agent Sync
 */

(function () {
  'use strict';

  const BESAdapter = {
    isExt: typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local,

    async get(key, defaultValue = null) {
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
    }
  };

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
      return [...this.blockedSites].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    isScriptEnabled(id, def = true) {
      return this.enabledScripts[id] !== undefined ? Boolean(this.enabledScripts[id]) : def;
    }

    async setScriptEnabled(id, val) {
      this.enabledScripts[id] = Boolean(val);
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
    }

    async setWidgetPos(pos) {
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

    async updateSettings(partial) {
      this.settings = { ...this.settings, ...partial };
      await BESAdapter.set('global_settings', this.settings);
    }

    async getCustomModules() {
      return await BESAdapter.get('custom_modules_list', null);
    }

    async saveCustomModules(modules) {
      const serializable = modules.map(m => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        category: m.category,
        author: m.author || 'BESing Team',
        icon: m.icon,
        code: m.init ? m.init.toString() : '',
        destroyCode: m.destroy ? m.destroy.toString() : ''
      }));
      await BESAdapter.set('custom_modules_list', serializable);
    }
  }

  const Modules = [
    {
      id: 'reading-assistant',
      name: 'Reading Assistant',
      version: '1.0.0',
      description: 'Calculates word count, reading duration, and provides a quick jump heading outline.',
      category: 'Productivity',
      enabled: true,
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`,
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
    },
    {
      id: 'dark-dimmer',
      name: 'Night Comfort Dimmer',
      version: '1.0.0',
      description: 'Gentle screen dimming filter and tint to soothe eyes during late hours.',
      category: 'Accessibility',
      enabled: false,
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
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
    },
    {
      id: 'quick-copy',
      name: 'Markdown Link Copier',
      version: '1.0.0',
      description: 'Press Alt+C to copy current page title & URL formatted as Markdown [Title](URL).',
      category: 'Tools',
      enabled: true,
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`,
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
    },
    {
      id: 'color-change',
      name: 'Color Change',
      version: '1.0.0',
      description: 'Changes page background color to red.',
      category: 'Visual',
      enabled: true,
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,
      _prevBg: null,
      init() {
        this._prevBg = document.body.style.backgroundColor;
        document.body.style.backgroundColor = 'red';
      },
      destroy() {
        document.body.style.backgroundColor = this._prevBg || '';
        this._prevBg = null;
      }
    }
  ];

  // Automated Self-Update Engine
  class BESUpdater {
    constructor({ currentVersion = '1.4.0', storage = null, onUpdateFound = null }) {
      this.currentVersion = currentVersion;
      this.storage = storage;
      this.onUpdateFound = onUpdateFound;
      this.isChecking = false;
      this.lastCheckResult = null;

      this.channels = {
        github: {
          id: 'github',
          name: 'GitHub (Bleeding-Edge / Instant)',
          metaUrl: 'https://raw.githubusercontent.com/Granine/BESing/main/BESing/userscript/besing-manager.meta.js',
          scriptUrl: 'https://raw.githubusercontent.com/Granine/BESing/main/BESing/userscript/besing-manager.user.js',
          desc: 'Instant updates directly upon git push.'
        },
        greasyfork: {
          id: 'greasyfork',
          name: 'Greasy Fork (Curated Stable)',
          metaUrl: 'https://update.greasyfork.org/scripts/512345/BESing%20Script%20Manager.meta.js',
          scriptUrl: 'https://update.greasyfork.org/scripts/512345/BESing%20Script%20Manager.user.js',
          desc: 'Curated and moderated releases on Greasy Fork.'
        },
        local: {
          id: 'local',
          name: 'Local Server (Dev / Test)',
          metaUrl: 'http://127.0.0.1:8765/userscript/besing-manager.meta.js',
          scriptUrl: 'http://127.0.0.1:8765/userscript/besing-manager.user.js',
          desc: 'Connected to local BESing demo server for instant dev hot-reloads.'
        }
      };
    }

    async getConfig() {
      const settings = (this.storage && this.storage.settings) ? this.storage.settings : {};
      const channelId = settings.updateChannel || 'github';
      const channelDef = this.channels[channelId] || this.channels.github;
      return {
        channelId,
        channelName: channelDef.name,
        metaUrl: channelDef.metaUrl,
        scriptUrl: channelDef.scriptUrl,
        autoCheck: settings.autoCheckUpdates !== false
      };
    }

    static compareVersions(vA, vB) {
      if (!vA || !vB) return 0;
      const cleanA = vA.replace(/^v/i, '').trim();
      const cleanB = vB.replace(/^v/i, '').trim();
      const partsA = cleanA.split('.').map(n => parseInt(n, 10) || 0);
      const partsB = cleanB.split('.').map(n => parseInt(n, 10) || 0);
      const maxLen = Math.max(partsA.length, partsB.length);

      for (let i = 0; i < maxLen; i++) {
        const a = partsA[i] || 0;
        const b = partsB[i] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
      }
      return 0;
    }

    static parseVersion(codeText) {
      if (!codeText) return null;
      const match = codeText.match(/@version\s+([0-9A-Za-z.\-_]+)/i);
      return match ? match[1].trim() : null;
    }

    static async fetchText(url) {
      const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      const res = await fetch(targetUrl, {
        method: 'GET',
        cache: 'no-cache',
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    }

    async checkForUpdates(force = false) {
      if (this.isChecking) return this.lastCheckResult;
      this.isChecking = true;

      try {
        const config = await this.getConfig();
        const text = await BESUpdater.fetchText(config.metaUrl);
        const remoteVersion = BESUpdater.parseVersion(text);

        if (!remoteVersion) {
          throw new Error('Failed to parse remote @version from metadata');
        }

        const hasUpdate = BESUpdater.compareVersions(remoteVersion, this.currentVersion) > 0;
        const result = {
          ok: true,
          hasUpdate,
          currentVersion: this.currentVersion,
          remoteVersion,
          channel: config.channelId,
          channelName: config.channelName,
          metaUrl: config.metaUrl,
          downloadUrl: config.scriptUrl,
          checkedAt: Date.now()
        };

        this.lastCheckResult = result;

        if (hasUpdate && typeof this.onUpdateFound === 'function') {
          this.onUpdateFound(result);
        }

        return result;
      } catch (err) {
        const config = await this.getConfig().catch(() => ({ channelId: 'unknown', channelName: 'Unknown' }));
        const result = {
          ok: false,
          hasUpdate: false,
          currentVersion: this.currentVersion,
          remoteVersion: null,
          channel: config.channelId,
          channelName: config.channelName,
          error: err.message,
          checkedAt: Date.now()
        };
        this.lastCheckResult = result;
        return result;
      } finally {
        this.isChecking = false;
      }
    }

    triggerInstall(downloadUrl) {
      const url = downloadUrl || this.channels.github.scriptUrl;
      console.log('[BESing Updater] Opening update installation URL:', url);
      window.open(url, '_blank');
    }
  }

  class BESManagerApp {
    constructor() {
      this.storage = new BESStorage();
      this.updater = new BESUpdater({
        currentVersion: '1.4.0',
        storage: this.storage,
        onUpdateFound: (res) => this.onUpdateFound(res)
      });
      this.updateAvailable = null;
      this.availableCatalog = null;
      this.modules = [...Modules];
      this.host = null;
      this.shadow = null;
      this.widgetEl = null;
      this.avatarWrap = null;
      this.menuWrapperEl = null;
      this.currentView = 'extensions';
      this.isExpanded = false;
      this.searchQuery = '';
      this._idleTimer = null;
    }

    onUpdateFound(res) {
      this.updateAvailable = res;
      this.updateBadge();
      if (this.menuWrapperEl) {
        const tagEl = this.menuWrapperEl.querySelector('.besing-tag');
        if (tagEl) {
          tagEl.innerHTML = `v1.4 <span style="background:#ec4899;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:700;">UPDATE</span>`;
        }
      }
    }

    async init() {
      await this.storage.init();

      // Restore custom installed modules if any
      const saved = await this.storage.getCustomModules();
      if (Array.isArray(saved) && saved.length > 0) {
        this.modules = saved.map(s => {
          let initFn = () => {};
          let destroyFn = () => {};
          if (typeof s.code === 'string') {
            try { initFn = new Function(s.code); } catch (e) {}
          }
          if (typeof s.destroyCode === 'string') {
            try { destroyFn = new Function(s.destroyCode); } catch (e) {}
          }
          return {
            id: s.id,
            name: s.name || s.id,
            version: s.version || '1.0.0',
            description: s.description || '',
            category: s.category || 'General',
            author: s.author || 'BESing Team',
            icon: s.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
            enabled: this.storage.isScriptEnabled(s.id, true),
            init: initFn,
            destroy: destroyFn
          };
        });
      }

      // Check for updates: ONLY once a day or on launch if > 24 hours
      const lastCheck = await BESAdapter.get('last_update_check_time', 0);
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - (lastCheck || 0) > ONE_DAY) {
        setTimeout(async () => {
          await this.updater.checkForUpdates(false).catch(() => {});
          await BESAdapter.set('last_update_check_time', Date.now());
        }, 4000);
      }

      window.addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }
      });

      if (this.storage.isCurrentBlocked()) {
        console.log(`[BESing Extension] Inactive on ${window.location.hostname} (Site disabled)`);
        return;
      }

      this.mount();
    }

    async loadAvailableCatalog() {
      if (this.availableCatalog && this.availableCatalog.length) return this.availableCatalog;
      try {
        let res = await fetch('http://127.0.0.1:8765/scripts/SCRIPT_LIST.json', { cache: 'no-cache', signal: AbortSignal.timeout(2000) }).catch(() => null);
        if (!res || !res.ok) {
          res = await fetch('https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/SCRIPT_LIST.json', { cache: 'no-cache', signal: AbortSignal.timeout(4000) }).catch(() => null);
        }
        if (res && res.ok) {
          this.availableCatalog = await res.json();
          return this.availableCatalog;
        }
      } catch (e) {
        console.warn('[BESing Store] Catalog load fallback:', e);
      }

      this.availableCatalog = [
        {
          id: 'reading-assistant',
          name: 'Reading Assistant',
          version: '1.0.0',
          description: 'Calculates word count, reading duration, and provides a quick jump heading outline for any article or webpage.',
          category: 'Productivity',
          author: 'BESing Team',
          icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
          localUrl: 'http://127.0.0.1:8765/scripts/reading-assistant/reading-assistant.user.js',
          rawUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/reading-assistant/reading-assistant.user.js'
        },
        {
          id: 'dark-dimmer',
          name: 'Night Comfort Dimmer',
          version: '1.0.0',
          description: 'Gentle screen dimming filter and tint to soothe eyes during late hours.',
          category: 'Accessibility',
          author: 'BESing Team',
          icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
          localUrl: 'http://127.0.0.1:8765/scripts/dark-dimmer/dark-dimmer.user.js',
          rawUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/dark-dimmer/dark-dimmer.user.js'
        },
        {
          id: 'quick-copy',
          name: 'Markdown Link Copier',
          version: '1.0.0',
          description: 'Press Alt+C to copy current page title & URL formatted as Markdown [Title](URL).',
          category: 'Tools',
          author: 'BESing Team',
          icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
          localUrl: 'http://127.0.0.1:8765/scripts/quick-copy/quick-copy.user.js',
          rawUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/quick-copy/quick-copy.user.js'
        },
        {
          id: 'ad-cleaner',
          name: 'Ad Cleaner Lite',
          version: '1.0.0',
          description: 'Hides intrusive floating overlays, sticky marketing banners, and cookie consent popups.',
          category: 'Privacy',
          author: 'BESing Team',
          icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
          localUrl: 'http://127.0.0.1:8765/scripts/ad-cleaner/ad-cleaner.user.js',
          rawUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/ad-cleaner/ad-cleaner.user.js'
        },
        {
          id: 'color-change',
          name: 'Color Change',
          version: '1.0.0',
          description: 'Changes page background color to red for dynamic testing and visual confirmation.',
          category: 'Visual',
          author: 'BESing Team',
          icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
          localUrl: 'http://127.0.0.1:8765/scripts/color-change/color-change.user.js',
          rawUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/scripts/color-change/color-change.user.js'
        }
      ];
      return this.availableCatalog;
    }

    async installScript(item, btn) {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="besing-spinner"></span> Searching GF...`;
      }
      let code = null;
      let source = 'GitHub';

      try {
        // 1. Search Greasy Fork for same-name script
        try {
          const gfUrl = `https://greasyfork.org/scripts.json?q=${encodeURIComponent(item.name)}`;
          const gfResText = await BESUpdater.fetchText(gfUrl);
          const gfList = JSON.parse(gfResText);
          if (Array.isArray(gfList) && gfList.length > 0) {
            const match = gfList.find(s => s.name.toLowerCase() === item.name.toLowerCase()) || gfList[0];
            if (match && match.code_url) {
              if (btn) btn.innerHTML = `<span class="besing-spinner"></span> Downloading GF...`;
              code = await BESUpdater.fetchText(match.code_url);
              source = 'Greasy Fork';
            }
          }
        } catch (gfErr) {
          console.log('[BESing Store] Greasy Fork note:', gfErr.message);
        }

        // 2. Fallback to GitHub / Local Server
        if (!code) {
          if (btn) btn.innerHTML = `<span class="besing-spinner"></span> Downloading GitHub...`;
          try {
            code = await BESUpdater.fetchText(item.localUrl || item.rawUrl);
            source = item.localUrl ? 'Local Dev Server' : 'GitHub';
          } catch (ghErr) {
            code = await BESUpdater.fetchText(item.rawUrl);
            source = 'GitHub';
          }
        }

        if (!code) {
          throw new Error('Failed to retrieve script code from Greasy Fork or GitHub');
        }

        // 3. Compile & Instantiate
        window.__BESING_SCRIPTS__ = window.__BESING_SCRIPTS__ || {};
        window.__BESING_EMBEDDED__ = true;
        try {
          const exec = new Function(code);
          exec();
        } catch (compErr) {
          console.error('[BESing Store] Compile error:', compErr);
        }

        const exported = window.__BESING_SCRIPTS__[item.id];
        const newMod = {
          id: item.id,
          name: item.name,
          version: item.version,
          description: item.description,
          category: item.category,
          author: item.author,
          icon: item.icon,
          enabled: true,
          init: exported && exported.init ? exported.init.bind(exported) : (new Function(code)),
          destroy: exported && exported.destroy ? exported.destroy.bind(exported) : (() => {})
        };

        const idx = this.modules.findIndex(m => m.id === item.id);
        if (idx >= 0) {
          try { this.modules[idx].destroy(); } catch (e) {}
          this.modules[idx] = newMod;
        } else {
          this.modules.push(newMod);
        }

        await this.storage.setScriptEnabled(item.id, true);
        await this.storage.saveCustomModules(this.modules);
        try { newMod.init(); } catch (err) {}
        this.updateBadge();

        alert(`Successfully installed "${item.name}" from ${source}!`);
      } catch (err) {
        alert(`Installation failed: ${err.message}`);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Install`;
        }
      }
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
      this.startEnabledModules();

      // Start automatic two-way agent sync loop
      this.startAutoSync();
    }

    startAutoSync() {
      if (this._syncTimer) clearInterval(this._syncTimer);
      // Run initial sync after 500ms
      setTimeout(() => {
        this.syncPush(false).then(() => this.syncPull(false));
      }, 500);

      this._syncTimer = setInterval(async () => {
        try {
          await this.syncPush(false);
          await this.syncPull(false);
        } catch (e) {}
      }, 2500);
    }

    stopAutoSync() {
      if (this._syncTimer) {
        clearInterval(this._syncTimer);
        this._syncTimer = null;
      }
    }

    async syncPush(notify = false) {
      const url = (this.storage.settings.agentUrl || 'http://127.0.0.1:8765/api/sync').replace(/\/+$/, '');
      const payload = {
        site: window.location.hostname,
        url: window.location.href,
        title: document.title,
        extensions: this.modules.map(m => ({
          id: m.id,
          name: m.name,
          version: m.version,
          enabled: this.storage.isScriptEnabled(m.id, m.enabled),
          description: m.description,
          category: m.category || 'General',
          code: m.init ? m.init.toString() : '',
          destroyCode: m.destroy ? m.destroy.toString() : ''
        })),
        blockedSites: this.storage.getBlockedSites(),
        timestamp: Date.now()
      };

      try {
        const res = await fetch(`${url}/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(3500)
        });
        return res.ok;
      } catch (err) {
        return false;
      }
    }

    async syncPull(notify = false) {
      const url = (this.storage.settings.agentUrl || 'http://127.0.0.1:8765/api/sync').replace(/\/+$/, '');
      let res;
      try {
        res = await fetch(`${url}/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site: window.location.hostname, timestamp: Date.now() }),
          signal: AbortSignal.timeout(3500)
        });
      } catch (e) {
        return false;
      }
      if (!res.ok) return false;
      const data = await res.json();
      const commands = data.commands || [];

      let modified = false;
      for (const cmd of commands) {
        if (cmd.action === 'set_status') {
          const { id, enabled } = cmd;
          if (id) {
            await this.storage.setScriptEnabled(id, Boolean(enabled));
            const m = this.modules.find(x => x.id === id);
            if (m) {
              if (enabled) {
                try { m.init(); } catch (e) {}
              } else {
                try { m.destroy(); } catch (e) {}
              }
              modified = true;
            }
          }
        } else if (cmd.action === 'insert_script' || cmd.action === 'modify_script' || cmd.action === 'upsert_script') {
          const s = cmd.script || cmd;
          if (s && s.id) {
            let initFn = () => {};
            let destroyFn = () => {};
            if (typeof s.code === 'string') {
              try { initFn = new Function(s.code); } catch (e) { console.error('[Agent Sync compile error]', e); }
            }
            if (typeof s.destroyCode === 'string') {
              try { destroyFn = new Function(s.destroyCode); } catch (e) { console.error('[Agent Sync compile error]', e); }
            }
            const existingIdx = this.modules.findIndex(x => x.id === s.id);
            const modDef = {
              id: s.id,
              name: s.name || s.id,
              version: s.version || '1.0.0',
              description: s.description || 'Agent script',
              category: s.category || 'Agent Scripts',
              enabled: s.enabled !== false,
              icon: s.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="#38bdf8" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
              init: initFn,
              destroy: destroyFn
            };
            if (existingIdx >= 0) {
              try { this.modules[existingIdx].destroy(); } catch (e) {}
              this.modules[existingIdx] = modDef;
            } else {
              this.modules.push(modDef);
            }
            await this.storage.setScriptEnabled(s.id, modDef.enabled);
            if (modDef.enabled) {
              try { modDef.init(); } catch (e) {}
            }
            modified = true;
          }
        }
      }

      if (modified) {
        this.updateBadge();
        if (this.menuWrapperEl) this.renderBody();
      }
      return true;
    }

    teardown() {
      this.stopAutoSync();
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

    async startEnabledModules() {
      for (const m of this.modules) {
        if (this.storage.isScriptEnabled(m.id, m.enabled)) {
          try { m.init(); } catch (e) { console.error('[BESing] Init error in module ' + m.id, e); }
        }
      }
      this.updateBadge();
    }

    renderWidget(shadow) {
      const widget = document.createElement('div');
      widget.className = 'besing-trigger';
      widget.title = 'BESing Script Manager & Desktop Pet (Click to open, Drag to move)';

      const avatar = document.createElement('div');
      avatar.className = 'besing-avatar-wrap';
      widget.appendChild(avatar);
      this.avatarWrap = avatar;

      const badge = document.createElement('div');
      badge.className = 'besing-badge-count';
      badge.style.display = 'none';
      widget.appendChild(badge);

      this.widgetEl = widget;
      this.setTheme(this.storage.getTheme());

      const getViewport = () => {
        const doc = document.documentElement;
        return {
          clientWidth: doc ? doc.clientWidth : window.innerWidth,
          clientHeight: doc ? doc.clientHeight : window.innerHeight
        };
      };

      const saved = this.storage.widgetPos;
      const vp = getViewport();
      let left = vp.clientWidth - 64;
      let top = vp.clientHeight - 110;
      if (saved && typeof saved.x === 'number') {
        left = Math.max(0, Math.min(vp.clientWidth - 48, saved.x));
        top = Math.max(8, Math.min(vp.clientHeight - 56, saved.y));
      }
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;

      // Draggable & Edge Folding with Mobile Touch Support & Scrollbar Awareness
      let isDragging = false, hasMoved = false, startX = 0, startY = 0, initLeft = 0, initTop = 0;

      const startDrag = (cx, cy) => {
        isDragging = true;
        hasMoved = false;
        startX = cx;
        startY = cy;
        const rect = widget.getBoundingClientRect();
        initLeft = rect.left;
        initTop = rect.top;
        widget.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
      };

      const moveDrag = (cx, cy) => {
        if (!isDragging) return;
        const dx = cx - startX;
        const dy = cy - startY;
        if (!hasMoved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) hasMoved = true;
        if (hasMoved) {
          const { clientWidth, clientHeight } = getViewport();
          let nl = Math.max(0, Math.min(clientWidth - 48, initLeft + dx));
          let nt = Math.max(8, Math.min(clientHeight - 56, initTop + dy));
          widget.style.left = `${nl}px`;
          widget.style.top = `${nt}px`;
        }
      };

      const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        if (hasMoved) {
          const rect = widget.getBoundingClientRect();
          this.storage.setWidgetPos({ x: rect.left, y: rect.top });
          checkEdgeFold();
        } else {
          if (this.menuWrapperEl) {
            this.closeModal();
          } else {
            this.openModal('extensions');
          }
        }
      };

      const checkEdgeFold = () => {
        const rect = widget.getBoundingClientRect();
        const { clientWidth, clientHeight } = getViewport();
        const threshold = 40;

        const isNearLeft = rect.left <= threshold;
        const isNearRight = rect.right >= clientWidth - threshold;
        const isNearTop = rect.top <= threshold;
        const isNearBottom = rect.bottom >= clientHeight - threshold;

        widget.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

        if (isNearLeft) widget.classList.add('folded-left');
        if (isNearRight) widget.classList.add('folded-right');
        if (isNearTop) widget.classList.add('folded-top');
        if (isNearBottom) widget.classList.add('folded-bottom');
      };

      // Pointer Events
      widget.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        startDrag(e.clientX, e.clientY);
        try { widget.setPointerCapture(e.pointerId); } catch (err) {}
        const onPointerMove = (ev) => moveDrag(ev.clientX, ev.clientY);
        const onPointerUp = (ev) => {
          try { widget.releasePointerCapture(ev.pointerId); } catch (err) {}
          widget.removeEventListener('pointermove', onPointerMove);
          widget.removeEventListener('pointerup', onPointerUp);
          endDrag();
        };
        widget.addEventListener('pointermove', onPointerMove);
        widget.addEventListener('pointerup', onPointerUp);
      });

      // Mobile Touch Events (iOS Safari & Android Chrome/Edge)
      widget.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
          startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      widget.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches.length === 1) {
          e.preventDefault(); // Stop mobile page scroll while dragging pet
          moveDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });

      widget.addEventListener('touchend', endDrag);
      widget.addEventListener('touchcancel', endDrag);

      widget.addEventListener('mouseenter', () => {
        clearTimeout(this._idleTimer);
        widget.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
      });

      widget.addEventListener('mouseleave', () => {
        this._idleTimer = setTimeout(checkEdgeFold, 1200);
      });

      shadow.appendChild(widget);
      checkEdgeFold();
      this.updateBadge();
    }

    setTheme(theme) {
      if (!this.avatarWrap) return;
      if (theme === 'cyber-pet') {
        this.avatarWrap.innerHTML = `
          <svg class="besing-pet-face" width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M7 10L10 4L14 9" stroke="#818cf8" stroke-width="2" stroke-linecap="round"/>
            <path d="M25 10L22 4L18 9" stroke="#818cf8" stroke-width="2" stroke-linecap="round"/>
            <rect x="5" y="8" width="22" height="18" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
            <ellipse class="besing-pet-eye" cx="11.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/>
            <ellipse class="besing-pet-eye" cx="20.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/>
          </svg>
        `;
      } else if (theme === 'orb') {
        this.avatarWrap.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="3 3"/>
            <circle cx="12" cy="12" r="6" fill="#6366f1" opacity="0.85"/>
          </svg>
        `;
      } else if (theme === 'crystal') {
        this.avatarWrap.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.8">
            <polygon points="12 2 20 8 16 22 8 22 4 8 12 2"/>
          </svg>
        `;
      } else {
        this.avatarWrap.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5">
            <circle cx="12" cy="12" r="4" fill="#6366f1"/>
          </svg>
        `;
      }
    }

    updateBadge() {
      if (!this.widgetEl) return;
      const countEl = this.widgetEl.querySelector('.besing-badge-count');
      const activeCount = this.modules.filter(m => this.storage.isScriptEnabled(m.id, m.enabled)).length;
      if (this.updateAvailable) {
        countEl.textContent = '⚡';
        countEl.style.display = 'flex';
        countEl.style.background = '#ec4899';
        countEl.title = `Update available: v${this.updateAvailable.remoteVersion}`;
      } else if (activeCount > 0) {
        countEl.textContent = String(activeCount);
        countEl.style.display = 'flex';
        countEl.style.background = '';
        countEl.title = `${activeCount} active script${activeCount > 1 ? 's' : ''}`;
      } else {
        countEl.style.display = 'none';
      }
    }

    openModal(view = 'extensions') {
      if (!this.shadow) {
        const host = document.createElement('besing-host');
        host.id = '__besing_root__';
        document.documentElement.appendChild(host);
        this.host = host;
        this.shadow = host.attachShadow({ mode: 'open' });
        this.injectStyles(this.shadow);
      }

      if (this.menuWrapperEl) this.menuWrapperEl.remove();
      this.currentView = view;

      const wrapper = document.createElement('div');
      wrapper.className = 'besing-bubble-wrapper';

      const arrow = document.createElement('div');
      arrow.className = 'besing-bubble-arrow arrow-bottom';
      wrapper.appendChild(arrow);

      const panel = document.createElement('div');
      panel.className = 'besing-bubble-panel';
      wrapper.appendChild(panel);

      panel.innerHTML = `
        <div class="besing-header">
          <div class="besing-logo-group">
            <div class="besing-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <div>
              <span class="besing-title">BESing Hub</span>
              <span class="besing-tag">${this.updateAvailable ? 'v1.4 <span style="background:#ec4899;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:700;">UPDATE</span>' : 'v1.4'}</span>
            </div>
          </div>
          <div class="besing-header-actions">
            <button class="besing-btn-icon" id="besing-btn-expand" title="Toggle Compact / Expanded">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
            </button>
            <button class="besing-btn-icon ${this.currentView === 'settings' ? 'active' : ''}" id="besing-btn-settings" title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button class="besing-btn-icon" id="besing-btn-close" title="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
        wrapper.style.left = 'auto';
        wrapper.style.top = 'auto';
        wrapper.style.transform = 'none';
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
                <button class="besing-theme-btn ${curTheme==='orb'?'active':''}" data-t="orb">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#818cf8" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="#6366f1"/></svg>
                  <span>Neon Orb</span>
                </button>
                <button class="besing-theme-btn ${curTheme==='crystal'?'active':''}" data-t="crystal">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><polygon points="12 2 20 8 16 22 8 22 4 8 12 2"/></svg>
                  <span>Crystal</span>
                </button>
                <button class="besing-theme-btn ${curTheme==='minimal'?'active':''}" data-t="minimal">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><circle cx="12" cy="12" r="5" fill="#6366f1"/></svg>
                  <span>Minimal</span>
                </button>
              </div>
            </div>

            <!-- Automated Software Updates -->
            <div class="besing-update-card">
              <div class="besing-update-header">
                <div class="besing-section-title" style="color:#c084fc;">Automated Software Updates</div>
                <span class="besing-status-pill ${this.updateAvailable ? 'update-ready' : 'idle'}" id="besing-update-pill">
                  <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span>
                  <span id="besing-update-pill-text">${this.updateAvailable ? 'Update Ready' : 'v' + this.updater.currentVersion}</span>
                </span>
              </div>
              <div class="besing-version-row">
                <div class="besing-version-col">
                  <span class="besing-version-label">Current Version</span>
                  <span class="besing-version-val">v${this.updater.currentVersion}</span>
                </div>
                <div class="besing-version-col">
                  <span class="besing-version-label">Update Channel</span>
                  <select id="besing-channel-select" class="besing-channel-select">
                    <option value="github" ${(this.storage.settings.updateChannel || 'github') === 'github' ? 'selected' : ''}>GitHub (Bleeding-edge / Instant)</option>
                    <option value="greasyfork" ${this.storage.settings.updateChannel === 'greasyfork' ? 'selected' : ''}>Greasy Fork (Curated Stable)</option>
                    <option value="local" ${this.storage.settings.updateChannel === 'local' ? 'selected' : ''}>Local Server (Dev / Test)</option>
                  </select>
                </div>
              </div>
              <div class="besing-update-actions">
                <button class="besing-btn-sync" id="besing-btn-check-update">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                  Check Updates
                </button>
                <button class="besing-btn-update ${this.updateAvailable ? '' : 'hidden'}" id="besing-btn-install-update">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Update Now
                </button>
              </div>
              <div id="besing-update-msg" class="besing-update-msg">${this.updateAvailable ? `🚀 Update ready: v${this.updateAvailable.remoteVersion} via ${this.updateAvailable.channelName}` : 'Ready to check for latest release.'}</div>
            </div>

            <div class="besing-agent-card">
              <div class="besing-agent-status-row">
                <div class="besing-section-title" style="color:#38bdf8;">Targeted Agent Sync</div>
                <span class="besing-status-pill idle" id="besing-agent-status-pill">
                  <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span>
                  <span>Idle</span>
                </span>
              </div>
              <div style="display:flex;gap:6px;">
                <input type="text" id="besing-agent-url-input" class="besing-search-input" style="padding-left:10px;font-size:11px;" value="${this.storage.settings.agentUrl}">
                <button class="besing-btn-unblock" id="besing-btn-test">Test</button>
              </div>
              <div class="besing-sync-btn-group">
                <button class="besing-btn-sync" id="besing-btn-pull">Pull Scripts</button>
                <button class="besing-btn-sync" id="besing-btn-push">Push State</button>
              </div>
              <div id="besing-sync-status-text" style="font-size:10px;color:#94a3b8;"></div>
            </div>

            <div class="besing-site-card">
              <div class="besing-site-card-header">
                <span style="font-size:11px;font-weight:700;color:#cbd5e1;text-transform:uppercase;">Current Site Control</span>
                <span class="besing-current-domain">${currentHost}</span>
              </div>
              <p class="besing-site-warn">Turn off BESing on <strong>${currentHost}</strong>. Button and scripts will disappear.</p>
              <button class="besing-btn-danger" id="besing-btn-turn-off-site">Disable BESing on this site</button>
            </div>

            <div class="besing-blocklist-header">
              <span class="besing-blocklist-title">Blocked Sites (By Added Time)</span>
              <span class="besing-blocklist-count" id="besing-block-count">${blocked.length} blocked</span>
            </div>
            <div class="besing-blocked-list" id="besing-blocked-container"></div>
          </div>
        `;

        body.querySelectorAll('.besing-theme-btn').forEach(btn => {
          btn.onclick = async () => {
            const t = btn.getAttribute('data-t');
            await this.storage.setTheme(t);
            this.setTheme(t);
            body.querySelectorAll('.besing-theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          };
        });

        // Update actions
        const channelSelect = body.querySelector('#besing-channel-select');
        const checkUpdateBtn = body.querySelector('#besing-btn-check-update');
        const installUpdateBtn = body.querySelector('#besing-btn-install-update');
        const updatePill = body.querySelector('#besing-update-pill');
        const updatePillText = body.querySelector('#besing-update-pill-text');
        const updateMsg = body.querySelector('#besing-update-msg');

        channelSelect.onchange = async () => {
          const val = channelSelect.value;
          await this.storage.updateSettings({ updateChannel: val });
          updateMsg.textContent = `Channel switched to: ${channelSelect.options[channelSelect.selectedIndex].text}`;
        };

        checkUpdateBtn.onclick = async () => {
          checkUpdateBtn.disabled = true;
          checkUpdateBtn.style.opacity = '0.6';
          updateMsg.textContent = 'Checking for updates...';
          updatePill.className = 'besing-status-pill idle';
          updatePillText.textContent = 'Checking...';

          try {
            const res = await this.updater.checkForUpdates(true);
            if (res.ok) {
              if (res.hasUpdate) {
                this.onUpdateFound(res);
                updatePill.className = 'besing-status-pill update-ready';
                updatePillText.textContent = `v${res.remoteVersion} Available`;
                installUpdateBtn.classList.remove('hidden');
                updateMsg.innerHTML = `<span style="color:#a78bfa;font-weight:600;">Update found!</span> v${res.remoteVersion} is available via ${res.channelName}. Click <strong>Update Now</strong> to install.`;
              } else {
                updatePill.className = 'besing-status-pill connected';
                updatePillText.textContent = 'Up to date';
                installUpdateBtn.classList.add('hidden');
                updateMsg.textContent = `✅ BESing is up to date (Latest: v${res.remoteVersion} via ${res.channelName}).`;
              }
            } else {
              updatePill.className = 'besing-status-pill error';
              updatePillText.textContent = 'Check Failed';
              updateMsg.textContent = `Update check failed: ${res.error || 'Network error'}`;
            }
          } catch (e) {
            updatePill.className = 'besing-status-pill error';
            updatePillText.textContent = 'Error';
            updateMsg.textContent = `Error: ${e.message}`;
          } finally {
            checkUpdateBtn.disabled = false;
            checkUpdateBtn.style.opacity = '1';
          }
        };

        installUpdateBtn.onclick = () => {
          const downloadUrl = this.updateAvailable ? this.updateAvailable.downloadUrl : null;
          this.updater.triggerInstall(downloadUrl);
        };

        const urlInput = body.querySelector('#besing-agent-url-input');
        const statusPill = body.querySelector('#besing-agent-status-pill');
        const syncText = body.querySelector('#besing-sync-status-text');

        body.querySelector('#besing-btn-test').onclick = async () => {
          const url = urlInput.value.trim();
          await this.storage.updateSettings({ agentUrl: url });
          syncText.textContent = 'Testing connection...';
          try {
            const res = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              statusPill.className = 'besing-status-pill connected';
              statusPill.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Connected';
              syncText.textContent = 'Connected to Agent endpoint successfully.';
            } else { throw new Error('HTTP ' + res.status); }
          } catch (e) {
            statusPill.className = 'besing-status-pill error';
            statusPill.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Offline';
            syncText.textContent = 'Agent unreachable: ' + e.message;
          }
        };

        body.querySelector('#besing-btn-pull').onclick = async () => {
          const url = urlInput.value.trim();
          await this.storage.updateSettings({ agentUrl: url });
          syncText.textContent = 'Pulling from agent...';
          try {
            const res = await fetch(`${url.replace(/\/+$/, '')}/pull`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ site: window.location.hostname })
            });
            if (res.ok) {
              const data = await res.json();
              statusPill.className = 'besing-status-pill connected';
              syncText.textContent = `Pulled successfully! Agent returned ${data.scripts?.length || 0} scripts.`;
            } else { throw new Error('HTTP ' + res.status); }
          } catch (e) {
            statusPill.className = 'besing-status-pill error';
            syncText.textContent = 'Pull error: ' + e.message;
          }
        };

        body.querySelector('#besing-btn-push').onclick = async () => {
          const url = urlInput.value.trim();
          await this.storage.updateSettings({ agentUrl: url });
          syncText.textContent = 'Pushing state...';
          try {
            const res = await fetch(`${url.replace(/\/+$/, '')}/push`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ site: window.location.hostname, url: window.location.href, timestamp: Date.now() })
            });
            if (res.ok) {
              statusPill.className = 'besing-status-pill connected';
              syncText.textContent = 'Current state pushed to agent.';
            } else { throw new Error('HTTP ' + res.status); }
          } catch (e) {
            statusPill.className = 'besing-status-pill error';
            syncText.textContent = 'Push error: ' + e.message;
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
          const list = this.storage.getBlockedSites();
          body.querySelector('#besing-block-count').textContent = `${list.length} blocked`;
          container.innerHTML = '';
          if (!list.length) {
            container.innerHTML = '<div class="besing-empty-state">No sites are currently blocked.</div>';
            return;
          }
          list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'besing-blocked-item';
            const diff = Date.now() - (item.addedAt || 0);
            const m = Math.floor(diff/60000);
            const timeStr = m < 1 ? 'Just now' : (m < 60 ? `${m}m ago` : new Date(item.addedAt).toLocaleDateString());
            row.innerHTML = `
              <div>
                <span class="besing-blocked-domain">${item.host}</span>
                <span class="besing-blocked-date">${timeStr}</span>
              </div>
              <button class="besing-btn-unblock">Unblock</button>
            `;
            row.querySelector('.besing-btn-unblock').onclick = async () => {
              await this.storage.unblockSite(item.host);
              renderBlockedRows();
              if (item.host.toLowerCase() === currentHost.toLowerCase()) {
                if (!this.widgetEl) {
                  this.renderWidget(this.shadow);
                  this.startEnabledModules();
                }
              }
            };
            container.appendChild(row);
          });
        };

        renderBlockedRows();

      } else {
        // Extensions List View: Installed on Top, Available Store on Bottom
        body.innerHTML = `
          <div class="besing-search-wrap">
            <svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="besing-search-input" placeholder="Search installed or store scripts..." value="${this.searchQuery}">
          </div>
          <div class="besing-ext-list" id="besing-ext-container"></div>
        `;

        const searchInput = body.querySelector('.besing-search-input');
        const extContainer = body.querySelector('#besing-ext-container');

        if (!this.availableCatalog) {
          this.loadAvailableCatalog().then(() => renderExtCards());
        }

        const renderExtCards = () => {
          extContainer.innerHTML = '';
          const q = this.searchQuery;

          // 1. Installed Scripts
          const installed = this.modules.filter(m => {
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
          });

          // 2. Uninstalled Catalog Scripts
          const catalog = (this.availableCatalog || []).filter(c => {
            return !this.modules.some(m => m.id === c.id);
          }).filter(c => {
            if (!q) return true;
            return (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
          });

          // Section 1: Installed
          const installedHeader = document.createElement('div');
          installedHeader.className = 'besing-section-heading';
          installedHeader.innerHTML = `
            <span>Installed Scripts</span>
            <span class="besing-pill-count">${installed.length}</span>
          `;
          extContainer.appendChild(installedHeader);

          if (!installed.length) {
            const emptyInstalled = document.createElement('div');
            emptyInstalled.className = 'besing-empty-state';
            emptyInstalled.style.padding = '10px';
            emptyInstalled.textContent = q ? 'No installed scripts match your query.' : 'No scripts installed yet. Browse below to install.';
            extContainer.appendChild(emptyInstalled);
          } else {
            installed.forEach(m => {
              const card = document.createElement('div');
              card.className = 'besing-ext-card';
              const isEnabled = this.storage.isScriptEnabled(m.id, m.enabled);
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
                  <button class="besing-btn-uninstall" title="Uninstall Script">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              `;

              card.querySelector('input').onchange = async (e) => {
                const val = e.target.checked;
                await this.storage.setScriptEnabled(m.id, val);
                if (val) {
                  try { m.init(); } catch (err) {}
                } else {
                  try { m.destroy(); } catch (err) {}
                }
                this.updateBadge();
              };

              card.querySelector('.besing-btn-uninstall').onclick = async () => {
                if (confirm(`Uninstall "${m.name}"? It will move back to Available Store Scripts.`)) {
                  try { m.destroy(); } catch (err) {}
                  this.modules = this.modules.filter(x => x.id !== m.id);
                  await this.storage.setScriptEnabled(m.id, false);
                  await this.storage.saveCustomModules(this.modules);
                  this.updateBadge();
                  renderExtCards();
                }
              };

              extContainer.appendChild(card);
            });
          }

          // Section 2: Available in Store
          const storeHeader = document.createElement('div');
          storeHeader.className = 'besing-section-heading store-heading';
          storeHeader.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
              <span>Available in Store</span>
            </div>
            <span class="besing-pill-count">${catalog.length}</span>
          `;
          extContainer.appendChild(storeHeader);

          if (!catalog.length) {
            const emptyCatalog = document.createElement('div');
            emptyCatalog.className = 'besing-empty-state';
            emptyCatalog.style.padding = '10px';
            emptyCatalog.textContent = q ? 'No store scripts match your query.' : 'All available scripts are installed!';
            extContainer.appendChild(emptyCatalog);
          } else {
            catalog.forEach(item => {
              const card = document.createElement('div');
              card.className = 'besing-ext-card store-card';
              card.innerHTML = `
                <div class="besing-ext-info-group">
                  <div class="besing-ext-icon">${item.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}</div>
                  <div class="besing-ext-meta">
                    <div class="besing-ext-title-row">
                      <span class="besing-ext-name">${item.name}</span>
                      <span class="besing-ext-ver">v${item.version}</span>
                      ${item.category ? `<span class="besing-cat-badge store">${item.category}</span>` : ''}
                    </div>
                    <p class="besing-ext-desc">${item.description}</p>
                    <div class="besing-store-meta-line">
                      <span>by ${item.author || 'Community'}</span>
                      <span class="besing-source-tag">GF & GitHub</span>
                    </div>
                  </div>
                </div>
                <div class="besing-ext-actions">
                  <button class="besing-btn-install" id="install-btn-${item.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Install
                  </button>
                </div>
              `;

              const installBtn = card.querySelector(`#install-btn-${item.id}`);
              installBtn.onclick = async () => {
                await this.installScript(item, installBtn);
                renderExtCards();
              };

              extContainer.appendChild(card);
            });
          }
        };

        searchInput.oninput = (e) => {
          this.searchQuery = e.target.value.toLowerCase().trim();
          renderExtCards();
        };

        renderExtCards();
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
        .besing-agent-card { background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-agent-status-row { display: flex; align-items: center; justify-content: space-between; }
        .besing-status-pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; display: flex; align-items: center; gap: 5px; }
        .besing-status-pill.connected { background: rgba(16, 185, 129, 0.15); color: #34d399; }
        .besing-status-pill.error { background: rgba(239, 68, 68, 0.15); color: #f87171; }
        .besing-status-pill.idle { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
        .besing-sync-btn-group { display: flex; gap: 8px; }
        .besing-btn-sync { flex: 1; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.15s ease; }
        .besing-btn-sync:hover { background: rgba(56, 189, 248, 0.25); color: #e0f2fe; }
        .besing-site-card { background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-site-card-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-current-domain { font-size: 12px; font-weight: 600; color: #fca5a5; font-family: monospace; }
        .besing-site-warn { font-size: 11px; color: #94a3b8; line-height: 1.35; }
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
        .besing-version-row { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; align-items: center; }
        .besing-version-col { display: flex; flex-direction: column; gap: 3px; }
        .besing-version-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.4px; }
        .besing-version-val { font-size: 13px; font-weight: 700; color: #e2e8f0; font-family: monospace; }
        .besing-channel-select { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(167, 139, 250, 0.3); border-radius: 6px; color: #f8fafc; font-size: 11px; padding: 5px 8px; outline: none; cursor: pointer; }
        .besing-channel-select:focus { border-color: #a78bfa; }
        .besing-update-actions { display: flex; gap: 8px; }
        .besing-btn-update { flex: 1; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #ffffff; border: none; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; box-shadow: 0 0 12px rgba(236, 72, 153, 0.35); transition: all 0.15s ease; }
        .besing-btn-update:hover { transform: translateY(-1px); box-shadow: 0 0 16px rgba(236, 72, 153, 0.55); }
        .besing-btn-update.hidden { display: none !important; }
        .besing-update-msg { font-size: 10px; color: #cbd5e1; min-height: 14px; line-height: 1.35; }
        .besing-status-pill.update-ready { background: rgba(236, 72, 153, 0.2); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.4); animation: besingGlow 1.5s infinite alternate; }
        @keyframes besingGlow { 0% { box-shadow: 0 0 4px rgba(236, 72, 153, 0.3); } 100% { box-shadow: 0 0 10px rgba(236, 72, 153, 0.8); } }
        @keyframes besingBubblePop { 0% { opacity: 0; transform: scale(0.92) translateY(6px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @media (max-width: 520px) {
          .besing-bubble-panel { width: calc(100vw - 20px) !important; max-width: calc(100vw - 20px) !important; max-height: 75vh !important; border-radius: 16px; }
          .besing-trigger { width: 48px; height: 48px; }
          .besing-trigger.folded-right { transform: translateX(55%); }
          .besing-trigger.folded-left { transform: translateX(-55%); }
          .besing-body { padding: 12px 14px; gap: 10px; }
          .besing-theme-grid { grid-template-columns: repeat(2, 1fr); }
          .besing-btn-danger, .besing-btn-sync, .besing-theme-btn { min-height: 40px; }
          .besing-switch { width: 44px; height: 24px; }
          .besing-slider::before { height: 18px; width: 18px; }
          .besing-switch input:checked + .besing-slider::before { transform: translateX(20px); }
        }
        .besing-section-heading { display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin: 4px 0 2px 0; }
        .besing-section-heading.store-heading { color: #34d399; margin-top: 14px; border-top: 1px dashed rgba(255, 255, 255, 0.08); padding-top: 12px; }
        .besing-pill-count { background: rgba(255, 255, 255, 0.08); color: #cbd5e1; font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600; }
        .besing-cat-badge { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); color: #a5b4fc; margin-left: 4px; }
        .besing-cat-badge.store { background: rgba(16, 185, 129, 0.15); color: #34d399; }
        .besing-btn-install { background: linear-gradient(135deg, #10b981, #06b6d4); color: #ffffff; border: none; border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.15s ease; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); }
        .besing-btn-install:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5); }
        .besing-btn-uninstall { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; border-radius: 6px; padding: 5px 7px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
        .besing-btn-uninstall:hover { background: rgba(239, 68, 68, 0.25); color: #fca5a5; }
        .besing-store-meta-line { display: flex; align-items: center; gap: 8px; font-size: 10px; color: #64748b; margin-top: 4px; }
        .besing-source-tag { background: rgba(56, 189, 248, 0.1); color: #38bdf8; padding: 1px 5px; border-radius: 4px; font-weight: 600; }
        .besing-ext-actions { display: flex; align-items: center; gap: 8px; }
        .besing-spinner { width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #ffffff; border-radius: 50%; display: inline-block; animation: besingSpin 0.7s linear infinite; }
        @keyframes besingSpin { to { transform: rotate(360deg); } }
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
