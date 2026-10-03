// ==UserScript==
// @name         BESing Packed
// @namespace    https://github.com/CoronRing/BESing
// @version      1.6.9
// @description  Universal Browser Extension & Greasy Fork Script Manager (Packed Standalone) with 4-way edge folding, desktop pet themes, non-blocking anchored bubble menu, and bundled productivity tools.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      update.greasyfork.org
// @connect      greasyfork.org
// @connect      cdn.jsdelivr.net
// @updateURL    https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js
// @downloadURL  https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js
// @run-at       document-start
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
          let resolved = false;
          // Mobile Edge / WebKit timeout guard: 350ms race
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                const item = window.localStorage.getItem('besing_' + key);
                resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
              } catch (e) {
                resolve(defaultValue);
              }
            }
          }, 350);

          try {
            chrome.storage.local.get([key], res => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {
                  try {
                    const item = window.localStorage.getItem('besing_' + key);
                    resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
                  } catch (e) {
                    resolve(defaultValue);
                  }
                } else {
                  const val = (res && res[key] !== undefined) ? res[key] : defaultValue;
                  try {
                    window.localStorage.setItem('besing_' + key, JSON.stringify(val));
                  } catch (e) {}
                  resolve(val);
                }
              }
            });
          } catch (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try {
                const item = window.localStorage.getItem('besing_' + key);
                resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
              } catch (e) {
                resolve(defaultValue);
              }
            }
          }
        });
      }
      try {
        const item = window.localStorage.getItem('besing_' + key);
        return (item !== null && item !== undefined) ? JSON.parse(item) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },

    async getAll(defaults = {}) {
      const keys = Object.keys(defaults);
      const result = { ...defaults };

      // Pre-fill from localStorage synchronously
      for (const k of keys) {
        try {
          const item = window.localStorage.getItem('besing_' + k);
          if (item !== null && item !== undefined) {
            result[k] = JSON.parse(item);
          }
        } catch (e) {}
      }

      if (this.isGM) {
        for (const k of keys) {
          try {
            const val = GM_getValue(k, undefined);
            if (val !== undefined) result[k] = val;
          } catch (e) {}
        }
        return result;
      }

      if (this.isExt) {
        return new Promise(resolve => {
          let resolved = false;
          // Mobile Edge / WebKit timeout guard: 350ms race
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          }, 350);

          try {
            chrome.storage.local.get(keys, res => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {
                  resolve(result);
                } else if (res && typeof res === 'object') {
                  for (const k of keys) {
                    if (res[k] !== undefined) {
                      result[k] = res[k];
                      try {
                        window.localStorage.setItem('besing_' + k, JSON.stringify(res[k]));
                      } catch (e) {}
                    }
                  }
                  resolve(result);
                } else {
                  resolve(result);
                }
              }
            });
          } catch (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(result);
            }
          }
        });
      }

      return result;
    },

    async set(key, value) {
      if (this.isGM) {
        try { GM_setValue(key, value); return true; } catch (e) { return false; }
      }
      if (this.isExt) {
        try {
          window.localStorage.setItem('besing_' + key, JSON.stringify(value));
        } catch (e) {}
        return new Promise(resolve => {
          try {
            chrome.storage.local.set({ [key]: value }, () => resolve(!chrome.runtime?.lastError));
          } catch (e) {
            resolve(false);
          }
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
      const readLocal = (k, def) => {
        try {
          const item = window.localStorage.getItem('besing_' + k);
          return (item !== null && item !== undefined) ? JSON.parse(item) : def;
        } catch (e) {
          return def;
        }
      };

      this.siteRules = readLocal('site_rules', {});
      this.enabledScripts = readLocal('enabled_scripts', { 'prevent-redirect': true });
      if (this.enabledScripts['prevent-redirect'] === undefined) {
        this.enabledScripts['prevent-redirect'] = true;
      }
      this.scriptConfigs = readLocal('script_configs', {});
      this.widgetPos = readLocal('widget_position', null);
      this.settings = {
        theme: 'cyber-pet',
        agentUrl: 'http://127.0.0.1:8765/api/sync',
        authToken: '',
        updateChannel: 'github',
        autoCheckUpdates: true,
        ...readLocal('global_settings', {})
      };
    }

    async init() {
      const data = await BESAdapter.getAll({
        site_rules: this.siteRules || {},
        blocked_sites: [],
        enabled_scripts: this.enabledScripts || {},
        script_configs: this.scriptConfigs || {},
        widget_position: this.widgetPos,
        global_settings: this.settings || {}
      });

      this.siteRules = (data.site_rules && typeof data.site_rules === 'object') ? data.site_rules : {};

      // Migrate legacy blocked_sites array if present
      if (Array.isArray(data.blocked_sites)) {
        for (const item of data.blocked_sites) {
          const host = (item.host || '').toLowerCase().trim();
          if (host) {
            if (!this.siteRules[host]) this.siteRules[host] = { disableAll: true, scripts: {}, configs: {} };
            else this.siteRules[host].disableAll = true;
          }
        }
      }

      this.enabledScripts = (data.enabled_scripts && typeof data.enabled_scripts === 'object') ? data.enabled_scripts : {};
      if (this.enabledScripts['prevent-redirect'] === undefined) {
        this.enabledScripts['prevent-redirect'] = true;
      }

      this.scriptConfigs = (data.script_configs && typeof data.script_configs === 'object') ? data.script_configs : {};
      if (data.widget_position) {
        this.widgetPos = data.widget_position;
      }
      this.settings = { ...this.settings, ...(data.global_settings || {}) };
    }

    getCurrentHost() {
      return (window.location.hostname || 'localhost').toLowerCase().trim();
    }

    isCurrentBlocked() {
      return this.isSiteDisabledAll(this.getCurrentHost());
    }

    isSiteDisabledAll(host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      return !!(this.siteRules[h] && this.siteRules[h].disableAll);
    }

    async setSiteDisabledAll(host, disabled) {
      const h = (host || this.getCurrentHost()).toLowerCase().trim();
      if (!h) return;
      if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
      this.siteRules[h].disableAll = !!disabled;
      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    // Mode: 'off' | 'site' | 'site-off' | 'on'
    getScriptMode(scriptId, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      const siteConfig = this.siteRules[h];

      if (siteConfig && siteConfig.scripts && siteConfig.scripts[scriptId] !== undefined) {
        return siteConfig.scripts[scriptId] ? 'site' : 'site-off';
      }

      if (this.enabledScripts[scriptId] !== undefined) {
        return this.enabledScripts[scriptId] ? 'on' : 'off';
      }
      if (scriptId === 'prevent-redirect') return 'on';
      return 'off';
    }

    isScriptActiveOnSite(scriptId, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      if (this.isSiteDisabledAll(h)) return false;

      const siteConfig = this.siteRules[h];
      if (siteConfig && siteConfig.scripts && siteConfig.scripts[scriptId] !== undefined) {
        return !!siteConfig.scripts[scriptId];
      }

      if (this.enabledScripts[scriptId] !== undefined) {
        return !!this.enabledScripts[scriptId];
      }
      if (scriptId === 'prevent-redirect') return true;

      return false;
    }

    async setScriptMode(scriptId, mode, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {};

      if (mode === 'on') {
        // Global ON: active across all sites by default; remove any site override for this host
        this.enabledScripts[scriptId] = true;
        delete this.siteRules[h].scripts[scriptId];
      } else if (mode === 'site') {
        // Active on this site only; globally OFF elsewhere
        this.siteRules[h].scripts[scriptId] = true;
        this.enabledScripts[scriptId] = false;
      } else if (mode === 'site-off') {
        // Explicitly disabled on this site only (e.g. RBC), global stays enabled
        this.siteRules[h].scripts[scriptId] = false;
        if (this.siteRules[h].configs && this.siteRules[h].configs[scriptId]) {
          delete this.siteRules[h].configs[scriptId];
        }
      } else {
        // OFF: Remove site override if present, and disable globally
        if (this.siteRules[h].scripts[scriptId] !== undefined) {
          delete this.siteRules[h].scripts[scriptId];
          if (this.siteRules[h].configs && this.siteRules[h].configs[scriptId]) {
            delete this.siteRules[h].configs[scriptId];
          }
        }
        this.enabledScripts[scriptId] = false;
      }

      this.cleanupSiteRule(h);
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    getScriptSiteOverrides(scriptId) {
      const list = [];
      Object.keys(this.siteRules || {}).forEach(h => {
        const rule = this.siteRules[h];
        if (rule && rule.scripts && rule.scripts[scriptId] !== undefined) {
          list.push({
            host: h,
            mode: rule.scripts[scriptId] ? 'site' : 'site-off',
            enabled: !!rule.scripts[scriptId],
            hasConfig: !!(rule.configs && rule.configs[scriptId])
          });
        }
      });
      return list;
    }

    async setSiteOverride(scriptId, host, mode) {
      const h = (host || '').toLowerCase().trim();
      if (!h) return;
      if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {};

      if (mode === 'site' || mode === true) {
        this.siteRules[h].scripts[scriptId] = true;
      } else if (mode === 'site-off' || mode === false) {
        this.siteRules[h].scripts[scriptId] = false;
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      } else {
        delete this.siteRules[h].scripts[scriptId];
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      }

      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    async removeSiteOverride(scriptId, host) {
      const h = (host || '').toLowerCase().trim();
      if (!h || !this.siteRules[h]) return;
      if (this.siteRules[h].scripts) delete this.siteRules[h].scripts[scriptId];
      if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    // Script Configs: Site-Isolated vs Global
    getScriptConfig(scriptId, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      const mode = this.getScriptMode(scriptId, h);

      if (mode === 'site') {
        if (this.siteRules[h] && this.siteRules[h].configs && this.siteRules[h].configs[scriptId] !== undefined) {
          return { ...(this.scriptConfigs[scriptId] || {}), ...this.siteRules[h].configs[scriptId] };
        }
        return { ...(this.scriptConfigs[scriptId] || {}) };
      }

      return { ...(this.scriptConfigs[scriptId] || {}) };
    }

    async setScriptConfig(scriptId, patch, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      const mode = this.getScriptMode(scriptId, h);

      if (mode === 'site') {
        if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
        if (!this.siteRules[h].configs) this.siteRules[h].configs = {};
        this.siteRules[h].configs[scriptId] = { ...(this.siteRules[h].configs[scriptId] || {}), ...patch };
        await BESAdapter.set('site_rules', this.siteRules);
      } else {
        this.scriptConfigs[scriptId] = { ...(this.scriptConfigs[scriptId] || {}), ...patch };
        await BESAdapter.set('script_configs', this.scriptConfigs);
      }
    }

    async toggleSiteRule(host, ruleKey, val) {
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {};

      if (ruleKey === 'disableAll') {
        this.siteRules[h].disableAll = !!val;
      } else {
        this.siteRules[h].scripts[ruleKey] = !!val;
      }

      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    cleanupSiteRule(host) {
      const rule = this.siteRules[host];
      if (!rule) return;
      const hasScripts = rule.scripts && Object.keys(rule.scripts).length > 0;
      const hasConfigs = rule.configs && Object.keys(rule.configs).length > 0;
      if (!rule.disableAll && !hasScripts && !hasConfigs) {
        delete this.siteRules[host];
      }
    }

    async removeSiteRule(host, ruleKey = null) {
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) return;

      if (!ruleKey || ruleKey === 'all') {
        delete this.siteRules[h];
      } else if (ruleKey === 'disableAll') {
        this.siteRules[h].disableAll = false;
        this.cleanupSiteRule(h);
      } else if (this.siteRules[h].scripts) {
        delete this.siteRules[h].scripts[ruleKey];
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[ruleKey];
        this.cleanupSiteRule(h);
      }

      await BESAdapter.set('site_rules', this.siteRules);
    }

    getAllSiteRules() {
      return this.siteRules || {};
    }

    getBlockedSites() {
      return Object.keys(this.siteRules)
        .filter(h => this.siteRules[h] && this.siteRules[h].disableAll)
        .map(h => ({ host: h, addedAt: Date.now() }));
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
        this._popover = popover;
        const closeDoc = () => { if (popover) { popover.remove(); popover = null; } this._popover = null; document.removeEventListener('click', closeDoc); };
        setTimeout(() => document.addEventListener('click', closeDoc), 50);
      };

      document.body.appendChild(badge);
      this._dom = badge;
    },

    destroy() {
      if (this._popover) { this._popover.remove(); this._popover = null; }
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

    // Module: Text Size Enhancer
    (() => {
      const mod = {
    id: 'text-size-control',
    name: 'Text Size Enhancer',
    version: '1.1.0',
    description: 'Enlarges text and page zoom (125%, 150%, 200%+) so small website fonts and novel paragraphs become easily readable.',
    category: 'Accessibility',
    _styleNode: null,
    _config: {
      fontSizePercent: 125,
      mode: 'hybrid' // 'hybrid' | 'text-only' | 'zoom'
    },

    init(cfg) {
      this.destroy();
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applySize();
    },

    onConfigChange(cfg) {
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applySize();
    },

    applySize() {
      const percent = Math.max(70, Math.min(400, Number(this._config.fontSizePercent) || 125));
      const scale = percent / 100;
      const mode = this._config.mode || 'hybrid';

      if (!this._styleNode) {
        const style = document.createElement('style');
        style.id = 'besing-text-size-style';
        (document.head || document.documentElement).appendChild(style);
        this._styleNode = style;
      }

      const counterScale = (1 / scale).toFixed(4);

      if (percent === 100) {
        document.documentElement.style.zoom = '';
        this._styleNode.textContent = '';
        return;
      }

      if (mode === 'text-only') {
        // Mode 1: Text-Only - keeps page layout width intact, enlarges all reading text & paragraphs
        document.documentElement.style.zoom = '';
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          p, li, dt, dd, blockquote,
          #content, #content p, #txtContent, #txtContent p,
          .chaptercontent, .chaptercontent p, .showtxt, .showtxt p,
          .read-content, .read-content p, article, article p,
          .entry-content, .entry-content p, .post-content, .post-content p,
          .article-content, .article-content p, .novel-content, .novel-content p {
            font-size: calc(max(1.05rem, 16px) * ${scale}) !important;
            line-height: 1.7 !important;
          }
          h1 { font-size: calc(max(1.75rem, 24px) * ${scale}) !important; }
          h2 { font-size: calc(max(1.4rem, 20px) * ${scale}) !important; }
          h3 { font-size: calc(max(1.2rem, 18px) * ${scale}) !important; }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `;
      } else if (mode === 'zoom') {
        // Mode 2: Standard Page Zoom
        document.documentElement.style.zoom = scale;
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            zoom: ${counterScale} !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `;
      } else {
        // Mode 3: Smart Hybrid (Default) - Page zoom + guaranteed paragraph scaling
        document.documentElement.style.zoom = scale;
        this._styleNode.textContent = `
          html, body {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          /* Ensure novel reading containers and paragraphs expand even when mobile browsers clamp them */
          #content, #content p, #txtContent, #txtContent p,
          .chaptercontent, .chaptercontent p, .showtxt, .showtxt p,
          .read-content, .read-content p, article p, .novel-content,
          .entry-content p, .post-content p, .article-content p, p {
            -webkit-text-size-adjust: ${percent}% !important;
            text-size-adjust: ${percent}% !important;
          }
          #__besing_root__, #besing-zapper-hud, #pagestream-status-toast {
            zoom: ${counterScale} !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        `;
      }
    },

    destroy() {
      document.documentElement.style.zoom = '';
      if (this._styleNode) {
        this._styleNode.remove();
        this._styleNode = null;
      }
      const s = document.getElementById('besing-text-size-style');
      if (s) s.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 7V4h16v3M9 20h6M12 4v16\"/></svg>";
      mod.author = "BESing Team";
      mod.category = "Accessibility";
      return mod;
    })(),

    // Module: Force Allow Copy & Paste
    (() => {
      const mod = {
    id: 'force-copy',
    name: 'Force Allow Copy & Paste',
    version: '1.0.0',
    description: 'Enables text selection, copy, cut, paste, and right-click on sites that attempt to disable them.',
    category: 'Tools',
    _styleNode: null,
    _listeners: [],
    _interval: null,
    _config: {
      allowSelect: true,
      allowCopy: true,
      allowPaste: true,
      allowContextMenu: true
    },

    init(cfg) {
      this.destroy();
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }

      // 1. Force enable CSS user-select
      this._injectStyle();

      // 2. Attach capture listeners to block website event prevention
      this._attachCaptureInterceptors();

      // 3. Clear legacy inline event handlers
      this._clearInlineHandlers();

      // 4. Periodic check to neutralize dynamic re-binding
      this._interval = setInterval(() => this._clearInlineHandlers(), 2000);
    },

    _injectStyle() {
      if (!this._styleNode) {
        const style = document.createElement('style');
        style.id = 'besing-force-copy-style';
        style.textContent = `
          *, *::before, *::after {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
          }
          input, textarea, [contenteditable="true"] {
            -webkit-user-select: auto !important;
            user-select: auto !important;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
        this._styleNode = style;
      }
    },

    _attachCaptureInterceptors() {
      const handleCapture = (e) => {
        const type = e.type;
        if (type === 'copy' || type === 'cut') {
          if (this._config.allowCopy) e.stopImmediatePropagation();
        } else if (type === 'paste') {
          if (this._config.allowPaste) e.stopImmediatePropagation();
        } else if (type === 'contextmenu') {
          if (this._config.allowContextMenu) e.stopImmediatePropagation();
        } else if (type === 'selectstart' || type === 'selectionchange' || type === 'dragstart') {
          if (this._config.allowSelect) e.stopImmediatePropagation();
        }
      };

      const handleKeydown = (e) => {
        const key = (e.key || '').toLowerCase();
        if (e.ctrlKey || e.metaKey) {
          if (['c', 'x', 'a'].includes(key) && this._config.allowCopy) {
            e.stopImmediatePropagation();
          } else if (key === 'v' && this._config.allowPaste) {
            e.stopImmediatePropagation();
          }
        }
      };

      const events = ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'];
      events.forEach(evt => {
        window.addEventListener(evt, handleCapture, { capture: true, passive: false });
        document.addEventListener(evt, handleCapture, { capture: true, passive: false });
        this._listeners.push({ target: window, event: evt, fn: handleCapture });
        this._listeners.push({ target: document, event: evt, fn: handleCapture });
      });

      window.addEventListener('keydown', handleKeydown, { capture: true, passive: false });
      this._listeners.push({ target: window, event: 'keydown', fn: handleKeydown });
    },

    _clearInlineHandlers() {
      const events = ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart', 'ondragstart', 'onmousedown', 'onmouseup'];
      events.forEach(evt => {
        try {
          if (document[evt]) document[evt] = null;
          if (document.body && document.body[evt]) document.body[evt] = null;
        } catch (e) {}
      });
    },

    onConfigChange(cfg) {
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
    },

    destroy() {
      if (this._interval) {
        clearInterval(this._interval);
        this._interval = null;
      }
      this._listeners.forEach(l => {
        try { l.target.removeEventListener(l.event, l.fn, { capture: true }); } catch (e) {}
      });
      this._listeners = [];

      if (this._styleNode) {
        this._styleNode.remove();
        this._styleNode = null;
      }
      const s = document.getElementById('besing-force-copy-style');
      if (s) s.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\"></path><rect x=\"8\" y=\"2\" width=\"8\" height=\"4\" rx=\"1\" ry=\"1\"></rect><path d=\"M9 14h6M9 18h4\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Tools";
      return mod;
    })(),

    // Module: Page Color & Brightness
    (() => {
      const mod = {
    id: 'color-change',
    name: 'Page Color & Brightness',
    version: '1.2.0',
    description: 'Adjusts background color presets (Eye Protect, Old Paper, Dark), site background brightness, and high-contrast text colors.',
    category: 'Visual',
    _prevBodyBg: null,
    _prevHtmlBg: null,
    _presetOverlay: null,
    _brightnessOverlay: null,
    _textColorStyle: null,
    _config: {
      brightness: 0, // -100 (lighten) to +100 (deepen / darken)
      preset: 'eye-protect', // 'none' | 'eye-protect' | 'old-paper' | 'dark' | 'soft-sepia' | 'cool-mint' | 'custom'
      customColor: '#cce8cf',
      textColor: 'default', // 'default' | 'white' | 'black' | 'charcoal' | 'gray' | 'amber' | 'custom'
      customTextColor: '#ffffff'
    },

    PRESETS: {
      'none': { name: 'Original', color: 'transparent', overlay: 'transparent' },
      'eye-protect': { name: 'Eye Protect', color: '#cce8cf', overlay: 'rgba(204, 232, 207, 0.45)' },
      'old-paper': { name: 'Old Paper', color: '#f4ecd8', overlay: 'rgba(244, 236, 216, 0.48)' },
      'dark': { name: 'Dark Mode', color: '#18181b', overlay: 'rgba(24, 24, 27, 0.65)' },
      'soft-sepia': { name: 'Soft Sepia', color: '#eee4cd', overlay: 'rgba(238, 228, 205, 0.42)' },
      'cool-mint': { name: 'Cool Mint', color: '#e0f2fe', overlay: 'rgba(224, 242, 254, 0.42)' }
    },

    TEXT_COLORS: {
      'default': { name: 'Original', color: 'transparent', text: null, border: '#475569' },
      'white': { name: 'Pure White', color: '#ffffff', text: '#ffffff', border: '#f8fafc' },
      'black': { name: 'Deep Black', color: '#0f172a', text: '#0f172a', border: '#0f172a' },
      'charcoal': { name: 'Charcoal', color: '#334155', text: '#334155', border: '#64748b' },
      'gray': { name: 'Soft Gray', color: '#94a3b8', text: '#94a3b8', border: '#94a3b8' },
      'amber': { name: 'Warm Cream', color: '#fef3c7', text: '#fef3c7', border: '#fde68a' }
    },

    init(cfg) {
      this.destroy();
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }

      this._prevBodyBg = document.body ? document.body.style.backgroundColor : null;
      this._prevHtmlBg = document.documentElement ? document.documentElement.style.backgroundColor : null;

      this._createOverlays();
      this.applyConfig();
    },

    _createOverlays() {
      // 1. Preset tint overlay (z-index 2147483625)
      if (!this._presetOverlay) {
        const pLayer = document.createElement('div');
        pLayer.id = 'besing-bg-preset-overlay';
        pLayer.style.cssText = `
          position: fixed !important;
          inset: 0 !important;
          pointer-events: none !important;
          z-index: 2147483625 !important;
          transition: background-color 0.2s ease, opacity 0.2s ease !important;
        `;
        (document.body || document.documentElement).appendChild(pLayer);
        this._presetOverlay = pLayer;
      }

      // 2. Brightness dragger overlay (z-index 2147483630, above preset tint but below BESing root 2147483642)
      if (!this._brightnessOverlay) {
        const bLayer = document.createElement('div');
        bLayer.id = 'besing-bg-brightness-overlay';
        bLayer.style.cssText = `
          position: fixed !important;
          inset: 0 !important;
          pointer-events: none !important;
          z-index: 2147483630 !important;
          transition: background-color 0.15s ease, opacity 0.15s ease !important;
        `;
        (document.body || document.documentElement).appendChild(bLayer);
        this._brightnessOverlay = bLayer;
      }
    },

    onConfigChange(cfg) {
      if (cfg && typeof cfg === 'object') {
        this._config = { ...this._config, ...cfg };
      }
      this.applyConfig();
    },

    applyConfig() {
      this._createOverlays();

      const presetKey = this._config.preset || 'none';
      let presetColor = 'transparent';
      let presetOverlayColor = 'transparent';

      if (presetKey === 'custom') {
        presetColor = this._config.customColor || '#cce8cf';
        presetOverlayColor = presetColor;
      } else if (this.PRESETS[presetKey]) {
        presetColor = this.PRESETS[presetKey].color;
        presetOverlayColor = this.PRESETS[presetKey].overlay;
      }

      // Apply Background Preset
      if (presetKey !== 'none') {
        if (document.documentElement) document.documentElement.style.backgroundColor = presetColor;
        if (document.body) document.body.style.backgroundColor = presetColor;
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = presetOverlayColor;
          this._presetOverlay.style.mixBlendMode = presetKey === 'dark' ? 'multiply' : 'multiply';
        }
      } else {
        if (document.documentElement) document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
        if (document.body) document.body.style.backgroundColor = this._prevBodyBg || '';
        if (this._presetOverlay) {
          this._presetOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Apply Brightness Dragger
      const bVal = Math.max(-100, Math.min(100, Number(this._config.brightness) || 0));
      if (this._brightnessOverlay) {
        if (bVal < 0) {
          const factor = Math.min(0.88, (Math.abs(bVal) / 100) * 0.95).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(255, 255, 255, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'screen';
        } else if (bVal > 0) {
          const factor = Math.min(0.92, (bVal / 100) * 0.96).toFixed(3);
          this._brightnessOverlay.style.backgroundColor = `rgba(0, 0, 0, ${factor})`;
          this._brightnessOverlay.style.mixBlendMode = 'multiply';
        } else {
          this._brightnessOverlay.style.backgroundColor = 'transparent';
        }
      }

      // Apply Text Color Adjust
      const tKey = this._config.textColor || 'default';
      let resolvedTextColor = null;
      if (tKey === 'custom') {
        resolvedTextColor = this._config.customTextColor || '#ffffff';
      } else if (this.TEXT_COLORS[tKey] && tKey !== 'default') {
        resolvedTextColor = this.TEXT_COLORS[tKey].text;
      }

      if (resolvedTextColor) {
        if (!this._textColorStyle) {
          const s = document.createElement('style');
          s.id = 'besing-text-color-style';
          (document.head || document.documentElement).appendChild(s);
          this._textColorStyle = s;
        }
        this._textColorStyle.textContent = `
          /* Apply high-contrast text color while strictly protecting BESing UI components and form fields */
          body *:not(#__besing_root__):not(#__besing_root__ *):not([id^="besing"]):not([class*="besing"]):not(input):not(textarea):not(select):not(button),
          p:not(#__besing_root__ *), span:not(#__besing_root__ *),
          a:not(#__besing_root__ *), li:not(#__besing_root__ *),
          h1:not(#__besing_root__ *), h2:not(#__besing_root__ *), h3:not(#__besing_root__ *),
          h4:not(#__besing_root__ *), h5:not(#__besing_root__ *), h6:not(#__besing_root__ *),
          article:not(#__besing_root__ *), section:not(#__besing_root__ *), blockquote:not(#__besing_root__ *),
          #content:not(#__besing_root__ *), #content *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          #txtContent:not(#__besing_root__ *), #txtContent *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .chaptercontent:not(#__besing_root__ *), .chaptercontent *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .showtxt:not(#__besing_root__ *), .showtxt *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .read-content:not(#__besing_root__ *), .read-content *:not(#__besing_root__ *):not(input):not(textarea):not(button),
          .entry-content:not(#__besing_root__ *), .entry-content *:not(#__besing_root__ *):not(input):not(textarea):not(button) {
            color: ${resolvedTextColor} !important;
          }
        `;
      } else {
        if (this._textColorStyle) {
          this._textColorStyle.remove();
          this._textColorStyle = null;
        }
        const s = document.getElementById('besing-text-color-style');
        if (s) s.remove();
      }
    },

    destroy() {
      if (document.documentElement) {
        document.documentElement.style.backgroundColor = this._prevHtmlBg || '';
      }
      if (document.body) {
        document.body.style.backgroundColor = this._prevBodyBg || '';
      }
      if (this._presetOverlay) {
        this._presetOverlay.remove();
        this._presetOverlay = null;
      }
      if (this._brightnessOverlay) {
        this._brightnessOverlay.remove();
        this._brightnessOverlay = null;
      }
      if (this._textColorStyle) {
        this._textColorStyle.remove();
        this._textColorStyle = null;
      }
      const p1 = document.getElementById('besing-bg-preset-overlay');
      if (p1) p1.remove();
      const p2 = document.getElementById('besing-bg-brightness-overlay');
      if (p2) p2.remove();
      const p3 = document.getElementById('besing-text-color-style');
      if (p3) p3.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><path d=\"M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42\"/></svg>";
      mod.author = "BESing Team";
      mod.category = "Visual";
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
      const cleanTitle = String(title || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      t.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Copied Markdown: "${cleanTitle.slice(0, 25)}..."</span>`;
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

    // Module: Ad Cleaner & Element Zapper
    (() => {
      const mod = {
    id: 'ad-cleaner',
    name: 'Ad Cleaner & Element Zapper',
    version: '1.3.0',
    description: 'Hides intrusive overlays, cookie popups, and provides an interactive point-and-click / mobile touch Element Zapper to block any element permanently.',
    category: 'Privacy',
    _styleEl: null,
    _config: null,
    _zapperActive: false,
    _zapperHud: null,
    _highlightEl: null,
    _currentHoveredTarget: null,
    _mouseMoveHandler: null,
    _touchStartHandler: null,
    _touchMoveHandler: null,
    _touchEndHandler: null,
    _clickHandler: null,
    _auxHandler: null,
    _keyDownHandler: null,
    _contextHandler: null,
    _shortcutAttached: false,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._applyStyles();
      this._setupGlobalShortcut();
    },

    onConfigChange(newConfig) {
      this._config = newConfig || {};
      this._applyStyles();
    },

    _applyStyles() {
      if (!this._styleEl) {
        const s = document.createElement('style');
        s.id = 'besing-ad-cleaner-style';
        (document.head || document.documentElement).appendChild(s);
        this._styleEl = s;
      }

      const rules = [];
      const autoClean = this._config.enableAutoClean !== false;
      if (autoClean) {
        rules.push(`
          [class*="cookie-banner"]:not(#__besing_root__ *), [id*="cookie-banner"]:not(#__besing_root__ *),
          [class*="consent-banner"]:not(#__besing_root__ *), [id*="consent-banner"]:not(#__besing_root__ *),
          [class*="popup-overlay"]:not(#__besing_root__ *),
          [class*="newsletter-popup"]:not(#__besing_root__ *), [id*="newsletter-modal"]:not(#__besing_root__ *),
          .ad-banner:not(#__besing_root__ *), .ads-placement:not(#__besing_root__ *)
        `);
      }

      const blocked = this._config.blockedSelectors || [];
      if (Array.isArray(blocked) && blocked.length > 0) {
        rules.push(blocked.join(',\n'));
      }

      if (rules.length > 0) {
        this._styleEl.textContent = `
          ${rules.join(',\n')} {
            display: none !important;
            visibility: hidden !important;
          }
        `;
      } else {
        this._styleEl.textContent = '';
      }
    },

    _setupGlobalShortcut() {
      if (this._shortcutAttached) return;
      this._shortcutAttached = true;
      window.addEventListener('keydown', (e) => {
        // Alt + Z toggles Element Zapper
        if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          if (this._zapperActive) {
            this.stopZapper();
          } else {
            this.startZapper();
          }
        }
      });
    },

    safeEscape(str) {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(str);
      }
      return String(str).replace(/([ #;&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
    },

    computeSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return '';
      if (el.id && !el.id.includes('__besing') && !/^\d/.test(el.id)) {
        return `#${this.safeEscape(el.id)}`;
      }
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).filter(c => !c.startsWith('besing-') && !c.includes(':'));
      if (classes.length > 0) {
        const clsSelector = classes.slice(0, 3).map(c => `.${this.safeEscape(c)}`).join('');
        if (document.querySelectorAll(clsSelector).length <= 4) {
          return `${tag}${clsSelector}`;
        }
      }
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        const parentSel = (parent.id && !parent.id.includes('__besing') && !/^\d/.test(parent.id)) ? `#${this.safeEscape(parent.id)}` : parent.tagName.toLowerCase();
        const index = Array.from(parent.children).indexOf(el) + 1;
        return `${parentSel} > ${tag}:nth-child(${index})`;
      }
      return tag;
    },

    _updateHighlightBox(el) {
      if (!this._highlightEl || !el) return;
      const rect = el.getBoundingClientRect();
      this._highlightEl.style.display = 'block';
      this._highlightEl.style.left = `${rect.left}px`;
      this._highlightEl.style.top = `${rect.top}px`;
      this._highlightEl.style.width = `${rect.width}px`;
      this._highlightEl.style.height = `${rect.height}px`;

      const sel = this.computeSelector(el);
      const tagBadge = this._highlightEl.querySelector('#besing-zapper-tag-badge');
      if (tagBadge) {
        tagBadge.textContent = `${sel} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
      }
    },

    _zapElement(target, onZappedCallback) {
      if (!target) return;
      const now = Date.now();
      if (this._lastZapTime && now - this._lastZapTime < 400) return;
      this._lastZapTime = now;

      const sel = this.computeSelector(target);
      if (!sel) return;

      // Immediate shrink, fade, and quarantine pointer events so underlying elements are not clicked
      target.style.pointerEvents = 'none';
      target.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      target.style.opacity = '0';
      target.style.transform = 'scale(0.88)';
      setTimeout(() => {
        target.style.display = 'none';
      }, 220);

      this._config = this._config || {};
      const currentList = this._config.blockedSelectors || [];
      if (!currentList.includes(sel)) {
        currentList.push(sel);
        this._config.blockedSelectors = currentList;
        this._applyStyles();
        if (typeof onZappedCallback === 'function') {
          onZappedCallback(sel, currentList);
        }
        const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                       (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
        if (appMgr && typeof appMgr.applyScriptConfig === 'function') {
          appMgr.applyScriptConfig(this.id, { blockedSelectors: currentList });
        }
      }

      const statusEl = this._zapperHud ? this._zapperHud.querySelector('#besing-zapper-status') : null;
      if (statusEl) {
        statusEl.textContent = `✅ Zapped: ${sel}`;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
      }
    },

    startZapper(onZappedCallback) {
      if (this._zapperActive) return;
      this._zapperActive = true;
      if (typeof window !== 'undefined') window.__BESING_ZAPPER_ACTIVE__ = true;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = true; } catch (e) {}
      }

      // Close manager modal if open
      const mgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                  (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (mgr && typeof mgr.closeModal === 'function') {
        mgr.closeModal();
      }

      // 1. Create Floating Top HUD with responsive mobile layout
      const hud = document.createElement('div');
      hud.id = 'besing-zapper-hud';
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
          <span style="background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:0.5px;flex-shrink:0;">⚡ ZAPPER</span>
          <span style="font-size:11px;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Tap or click any ad to Zap</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span id="besing-zapper-status" style="font-size:10px;color:#4ade80;font-weight:700;font-family:monospace;"></span>
          <button type="button" id="besing-zapper-exit-btn" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;cursor:pointer;">✕ Exit</button>
        </div>
      `;
      hud.setAttribute('style', 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:calc(100vw - 24px);max-width:480px;box-sizing:border-box;background:rgba(15,23,42,0.95);border:1.5px solid rgba(239,68,68,0.7);border-radius:12px;padding:8px 14px;z-index:2147483647;box-shadow:0 10px 30px rgba(0,0,0,0.7),0 0 20px rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:space-between;gap:8px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:auto;');
      (document.body || document.documentElement).appendChild(hud);
      this._zapperHud = hud;

      const exitBtn = hud.querySelector('#besing-zapper-exit-btn');
      if (exitBtn) {
        const doExit = (e) => {
          if (e) {
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (e.preventDefault) e.preventDefault();
          }
          this.stopZapper();
        };
        exitBtn.onclick = doExit;
        exitBtn.ontouchend = doExit;
        exitBtn.onpointerup = doExit;
      }

      // 2. Create Target Highlight Box
      const box = document.createElement('div');
      box.id = 'besing-zapper-highlight';
      box.setAttribute('style', 'position:fixed;pointer-events:none;border:2.5px solid #ef4444;background:rgba(239,68,68,0.22);z-index:2147483646;display:none;transition:top 0.05s ease, left 0.05s ease, width 0.05s ease, height 0.05s ease;border-radius:4px;box-shadow:0 0 16px rgba(239,68,68,0.6);');
      
      const tagBadge = document.createElement('div');
      tagBadge.id = 'besing-zapper-tag-badge';
      tagBadge.setAttribute('style', 'position:absolute;top:-24px;left:0;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:monospace;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,0.4);max-width:90vw;overflow:hidden;text-overflow:ellipsis;');
      box.appendChild(tagBadge);

      (document.body || document.documentElement).appendChild(box);
      this._highlightEl = box;

      document.body.style.cursor = 'crosshair';

      const isZapperUI = (el, e) => {
        if (e && e.composedPath && typeof e.composedPath === 'function') {
          const path = e.composedPath();
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            if (!node) continue;
            if (node.id === 'besing-zapper-hud' || node.id === 'besing-zapper-highlight' || node.id === '__besing_root__') return true;
            if (node.tagName && node.tagName.toLowerCase() === 'besing-host') return true;
          }
        }
        if (!el || !el.closest) return false;
        return !!(el.closest('#besing-zapper-hud') || el.closest('#besing-zapper-highlight') || el.closest('#__besing_root__') || el.closest('besing-host'));
      };

      const getPoint = (e) => {
        if (e.touches && e.touches.length > 0) return e.touches[0];
        if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0];
        return e;
      };

      // 3. Desktop Mouse Move
      this._mouseMoveHandler = (e) => {
        if (!this._zapperActive) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || isZapperUI(el)) {
          box.style.display = 'none';
          this._currentHoveredTarget = null;
          return;
        }
        this._currentHoveredTarget = el;
        this._updateHighlightBox(el);
      };

      // 4. Mobile Touch Start: Quarantine event, prevent ad redirect, highlight element
      this._touchStartHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        if (el && !isZapperUI(el, e)) {
          this._currentHoveredTarget = el;
          this._updateHighlightBox(el);
        }
      };

      // 5. Mobile Touch Move: Follow finger
      this._touchMoveHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        if (el && !isZapperUI(el, e)) {
          this._currentHoveredTarget = el;
          this._updateHighlightBox(el);
        }
      };

      // 6. Mobile Touch End: Zap target immediately on release
      this._touchEndHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const pt = getPoint(e);
        let target = this._currentHoveredTarget;
        if (!target && pt) {
          const el = document.elementFromPoint(pt.clientX, pt.clientY);
          if (el && !isZapperUI(el, e)) {
            target = el;
          }
        }

        if (target) {
          this._zapElement(target, onZappedCallback);
          this._currentHoveredTarget = null;
          if (this._highlightEl) this._highlightEl.style.display = 'none';
        }
      };

      // 7. Click Handler: Desktop click zap & synthetic click isolation
      this._clickHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const target = this._currentHoveredTarget || document.elementFromPoint(e.clientX, e.clientY);
        if (target && !isZapperUI(target, e)) {
          this._zapElement(target, onZappedCallback);
          this._currentHoveredTarget = null;
          if (this._highlightEl) this._highlightEl.style.display = 'none';
        }
      };

      this._auxHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      this._mouseDownHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      this._mouseUpHandler = (e) => {
        if (!this._zapperActive) return;
        if (isZapperUI(e.target, e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      this._keyDownHandler = (e) => {
        if (e.key === 'Escape') {
          this.stopZapper();
        }
      };

      this._contextHandler = (e) => {
        if (this._zapperActive) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.stopZapper();
        }
      };

      // Bind all input streams in capture phase to completely isolate page from ad redirects
      window.addEventListener('touchstart', this._touchStartHandler, { capture: true, passive: false });
      window.addEventListener('touchmove', this._touchMoveHandler, { capture: true, passive: false });
      window.addEventListener('touchend', this._touchEndHandler, { capture: true, passive: false });
      window.addEventListener('pointerdown', this._touchStartHandler, { capture: true });
      window.addEventListener('pointermove', this._touchMoveHandler, { capture: true });
      window.addEventListener('pointerup', this._touchEndHandler, { capture: true });
      window.addEventListener('mousedown', this._mouseDownHandler, { capture: true });
      window.addEventListener('mouseup', this._mouseUpHandler, { capture: true });
      window.addEventListener('mousemove', this._mouseMoveHandler, { capture: true, passive: true });
      window.addEventListener('click', this._clickHandler, { capture: true });
      window.addEventListener('auxclick', this._auxHandler, { capture: true });
      window.addEventListener('contextmenu', this._contextHandler, { capture: true });
      window.addEventListener('keydown', this._keyDownHandler);
    },

    stopZapper() {
      this._zapperActive = false;
      if (typeof window !== 'undefined') window.__BESING_ZAPPER_ACTIVE__ = false;
      if (typeof unsafeWindow !== 'undefined') {
        try { unsafeWindow.__BESING_ZAPPER_ACTIVE__ = false; } catch (e) {}
      }
      document.body.style.cursor = '';
      if (this._zapperHud) {
        this._zapperHud.remove();
        this._zapperHud = null;
      }
      if (this._highlightEl) {
        this._highlightEl.remove();
        this._highlightEl = null;
      }
      if (this._touchStartHandler) {
        window.removeEventListener('touchstart', this._touchStartHandler, { capture: true, passive: false });
        window.removeEventListener('pointerdown', this._touchStartHandler, { capture: true });
        this._touchStartHandler = null;
      }
      if (this._touchMoveHandler) {
        window.removeEventListener('touchmove', this._touchMoveHandler, { capture: true, passive: false });
        window.removeEventListener('pointermove', this._touchMoveHandler, { capture: true });
        this._touchMoveHandler = null;
      }
      if (this._touchEndHandler) {
        window.removeEventListener('touchend', this._touchEndHandler, { capture: true, passive: false });
        window.removeEventListener('pointerup', this._touchEndHandler, { capture: true });
        this._touchEndHandler = null;
      }
      if (this._mouseDownHandler) {
        window.removeEventListener('mousedown', this._mouseDownHandler, { capture: true });
        this._mouseDownHandler = null;
      }
      if (this._mouseUpHandler) {
        window.removeEventListener('mouseup', this._mouseUpHandler, { capture: true });
        this._mouseUpHandler = null;
      }
      if (this._mouseMoveHandler) {
        window.removeEventListener('mousemove', this._mouseMoveHandler, { capture: true, passive: true });
        this._mouseMoveHandler = null;
      }
      if (this._clickHandler) {
        window.removeEventListener('click', this._clickHandler, { capture: true });
        this._clickHandler = null;
      }
      if (this._auxHandler) {
        window.removeEventListener('auxclick', this._auxHandler, { capture: true });
        this._auxHandler = null;
      }
      if (this._keyDownHandler) {
        window.removeEventListener('keydown', this._keyDownHandler);
        this._keyDownHandler = null;
      }
      if (this._contextHandler) {
        window.removeEventListener('contextmenu', this._contextHandler, { capture: true });
        this._contextHandler = null;
      }
    },

    destroy() {
      this.stopZapper();
      if (this._styleEl) {
        this._styleEl.remove();
        this._styleEl = null;
      }
      const el = document.getElementById('besing-ad-cleaner-style');
      if (el) el.remove();
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polygon points=\"13 2 3 14 12 14 11 22 21 10 12 10 13 2\"></polygon></svg>";
      mod.author = "BESing Team";
      mod.category = "Privacy";
      return mod;
    })(),

    // Module: Prevent Redirect
    (() => {
      const mod = {
    id: 'prevent-redirect',
    name: 'Prevent Redirect',
    version: '1.4.0',
    description: 'Strictly blocks automatic redirects, mobile sensor traps, new tab popups, and malicious ad network script injections while preserving legitimate site navigation.',
    category: 'Security',
    _origOpen: null,
    _origUnsafeOpen: null,
    _origWebSocket: null,
    _origUnsafeWebSocket: null,
    _origFunction: null,
    _origUnsafeFunction: null,
    _origSetTimeout: null,
    _origUnsafeSetTimeout: null,
    _origSetInterval: null,
    _origUnsafeSetInterval: null,
    _origAnchorClick: null,
    _origElementClick: null,
    _origAssign: null,
    _origReplace: null,
    _origScriptSrcDesc: null,
    _origIframeSrcDesc: null,
    _origAppendChild: null,
    _origInsertBefore: null,
    _origInsertAdjacentHTML: null,
    _origAEL: null,
    _origDocAEL: null,
    _origDocWrite: null,
    _origDocWriteln: null,
    _scriptObserver: null,
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

      // 1. Relative or absolute script paths commonly used for mobile redirect and malicious tracking
      if (/(?:^|\/)(?:config\/)?(?:v\d+|tj|fumeiti|ads?|union|pop|float|jump|tongji|statistics)\.js(?:$|\?)/i.test(u)) {
        return true;
      }

      // 2. Non-standard ports commonly used by evasive ad/redirect servers
      if (/:(8001|8002|8003|8080|8081|8887|8888|9999|20091|20092|20093)\b/.test(u)) {
        if (!this._isSameHost(u)) return true;
      }

      // 3. Known mobile ad / redirect networks
      const adDomains = [
        'lkg6odg', 'kt6th8f', 'fumeiti', 'comprelu', 'dsygc',
        'uuysi5', 'uuysi6', '5bjoeih', 'xq04k6u', 'qq26oeg',
        'adzxdimq', 'vdxqxca', 'oybhpsij', 'popcash', 'propellerads',
        'exoclick', 'adsterra', 'clickadu', 'richpush', 'trafficjunky',
        'adservice', 'adnetwork', 'tsyndicate', 'hilltopads', 'adcash',
        'juicyads', 'yabidos', '7461c', '7461m'
      ];
      for (let i = 0; i < adDomains.length; i++) {
        if (u.includes(adDomains[i])) return true;
      }

      // 4. Known ad tracking redirect url path patterns
      if (/(\/sc\/\d+|\/cc\/\d+|\/d\/\d+|\/mj1\/\d+|\/stats\/\d+|\/push\/|\/stat\/|\/click\/)/.test(u) && !this._isSameHost(u)) {
        return true;
      }
      if ((u.includes('?n=') || u.includes('&target=1') || u.includes('is_not=1') || u.includes('ikooenpn') || u.includes('srisnadi')) && !this._isSameHost(u)) {
        return true;
      }

      return false;
    },

    _isAdCode(codeStr) {
      if (!codeStr || typeof codeStr !== 'string') return false;
      const s = codeStr.toLowerCase();
      // 1. Direct location hijacking with ad tokens or evasion params
      if (/(top\.location|window\.location|location\.href)\s*(!=|==|=)/.test(s) && (s.includes('http') || s.includes('target=1') || s.includes('purl') || s.includes('ikooenpn') || s.includes('srisnadi') || s.includes(':800') || s.includes(':888') || s.includes('7461') || s.includes('comprelu') || s.includes('kt6th8f') || s.includes('lkg6odg') || s.includes('adzxdimq') || s.includes('dsygc'))) {
        return true;
      }
      // 2. Mobile touch/sensor trap listeners that manipulate location
      if ((s.includes('touchend') || s.includes('touchstart') || s.includes('changedtouches') || s.includes('clientheight')) && (s.includes('location.href') || s.includes('top.location') || s.includes('window.location'))) {
        return true;
      }
      // 3. Mobile ad skip delay timers & evasion functions
      if (/(compel_skip_delay|seo_skip_delay|compel_click|ikooenpn_m|srisnadi_m|wsxg|adzxdimq|oybhpsij|7461c|7461m)/.test(s)) {
        return true;
      }
      // 4. Evasive websocket payload loaders
      if (s.includes('new function') && (s.includes('_tdcs') || s.includes('wvsyru') || s.includes('nnkqek') || s.includes('7461'))) {
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
      if (typeof window !== 'undefined' && window.__BESING_ZAPPER_ACTIVE__) return;
      const target = e && e.target;
      const link = target && target.closest ? target.closest('a') : null;
      if (link) {
        const href = link.getAttribute('href') || link.href;
        if (!href || typeof href !== 'string') return;
        const trimmed = href.trim();
        if (trimmed === '#' || trimmed.startsWith('#') || trimmed.startsWith('javascript:') || this._isAdOrRedirectUrl(trimmed)) {
          return;
        }
        if (this._isSameHost(trimmed)) {
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

      // 1. Intercept Function constructor (new Function) to block decrypted mobile ad payloads
      try {
        const OrigFunction = unsafeWin.Function || window.Function;
        this._origFunction = window.Function;
        const hookedFunction = function(...args) {
          const code = args[args.length - 1] || '';
          if (typeof code === 'string' && self._isAdCode(code)) {
            self.notifyBlocked('dynamic payload', 'malicious new Function redirect payload');
            return function() {};
          }
          return OrigFunction.apply(this, args);
        };
        hookedFunction.prototype = OrigFunction.prototype;
        window.Function = hookedFunction;
        if (unsafeWin && unsafeWin !== window) {
          this._origUnsafeFunction = unsafeWin.Function;
          try { unsafeWin.Function = hookedFunction; } catch (e) {}
        }
      } catch (e) {}

      // 2. Intercept EventTarget.prototype.addEventListener & drop malicious listeners
      try {
        const eventProto = (unsafeWin.EventTarget || EventTarget).prototype;
        const origAEL = eventProto.addEventListener;
        this._origAEL = origAEL;
        const hookedAEL = function(type, listener, options) {
          if (type === 'devicemotion' || type === 'deviceorientation') {
            console.warn('[BESing Prevent Redirect] Suppressed mobile sensor trap:', type);
            return;
          }
          if (typeof listener === 'function') {
            try {
              const fnStr = listener.toString();
              if (self._isAdCode(fnStr)) {
                self.notifyBlocked(type, 'malicious redirect event listener');
                return;
              }
            } catch (e) {}
          }
          return origAEL.call(this, type, listener, options);
        };
        eventProto.addEventListener = hookedAEL;
      } catch (e) {}

      // 3. Intercept setTimeout & setInterval to drop auto-redirect timers
      try {
        const origSetTimeout = window.setTimeout;
        this._origSetTimeout = origSetTimeout;
        const hookedSetTimeout = function(handler, delay, ...args) {
          if (typeof handler === 'function') {
            try {
              const fnStr = handler.toString();
              if (self._isAdCode(fnStr)) {
                self.notifyBlocked('timer', 'malicious auto-redirect setTimeout');
                return 0;
              }
            } catch (e) {}
          }
          return origSetTimeout.call(this, handler, delay, ...args);
        };
        window.setTimeout = hookedSetTimeout;
        if (unsafeWin && unsafeWin !== window) {
          this._origUnsafeSetTimeout = unsafeWin.setTimeout;
          try { unsafeWin.setTimeout = hookedSetTimeout; } catch (e) {}
        }

        const origSetInterval = window.setInterval;
        this._origSetInterval = origSetInterval;
        const hookedSetInterval = function(handler, delay, ...args) {
          if (typeof handler === 'function') {
            try {
              const fnStr = handler.toString();
              if (self._isAdCode(fnStr)) {
                self.notifyBlocked('timer', 'malicious auto-redirect setInterval');
                return 0;
              }
            } catch (e) {}
          }
          return origSetInterval.call(this, handler, delay, ...args);
        };
        window.setInterval = hookedSetInterval;
        if (unsafeWin && unsafeWin !== window) {
          this._origUnsafeSetInterval = unsafeWin.setInterval;
          try { unsafeWin.setInterval = hookedSetInterval; } catch (e) {}
        }
      } catch (e) {}

      // 4. Hook WebSocket to block ad tunnels (e.g. wss://...:20091, :20093, :8887)
      try {
        const OrigWS = unsafeWin.WebSocket || window.WebSocket;
        if (OrigWS) {
          this._origWebSocket = window.WebSocket;
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

      // 5. Hook window.open in current scope and unsafeWindow
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

      // 6. Hook HTMLScriptElement.prototype.src to intercept ad script injections
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

      // 7. Hook HTMLIFrameElement.prototype.src to intercept ad iframes
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

      // 8. Hook Node.prototype.appendChild and insertBefore
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

      // 9. Hook Element.prototype.insertAdjacentHTML to filter invisible touch overlay tiles
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

      // 10. Hook HTMLAnchorElement.prototype.click and HTMLElement.prototype.click
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

      // 11. Hook Location.prototype.assign and replace
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

      // 12. Click and touch tracking to distinguish user navigation from background hijacks
      const isZapperUIEvent = (e) => {
        if (!e) return false;
        if (e.composedPath && typeof e.composedPath === 'function') {
          const path = e.composedPath();
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            if (!node) continue;
            if (node.id === 'besing-zapper-hud' || node.id === 'besing-zapper-highlight' || node.id === '__besing_root__') return true;
            if (node.tagName && node.tagName.toLowerCase() === 'besing-host') return true;
          }
        }
        const t = e.target;
        if (t && t.closest) {
          if (t.closest('#besing-zapper-hud') || t.closest('#besing-zapper-highlight') || t.closest('besing-host') || t.closest('#__besing_root__')) {
            return true;
          }
        }
        return false;
      };

      this._clickHandler = function (e) {
        if (typeof window !== 'undefined' && window.__BESING_ZAPPER_ACTIVE__) {
          return;
        }
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

      // Intercept document.write and document.writeln to block synchronous ad script injections
      try {
        const origWrite = document.write;
        const origWriteln = document.writeln;
        this._origDocWrite = origWrite;
        this._origDocWriteln = origWriteln;
        document.write = function(...args) {
          const content = args.join('');
          if (self._isAdCode(content) || (content.includes('<script') && self._isAdOrRedirectUrl(content))) {
            self.notifyBlocked('document.write', 'malicious script injection via document.write');
            return;
          }
          return origWrite.apply(this, args);
        };
        document.writeln = function(...args) {
          const content = args.join('');
          if (self._isAdCode(content) || (content.includes('<script') && self._isAdOrRedirectUrl(content))) {
            self.notifyBlocked('document.writeln', 'malicious script injection via document.writeln');
            return;
          }
          return origWriteln.apply(this, args);
        };
      } catch (e) {}

      // Freeze malicious cookie setting (e.g. fumeiti tracking counter)
      try {
        const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(document, 'cookie');
        if (cookieDesc && cookieDesc.set) {
          const origCookieSet = cookieDesc.set;
          Object.defineProperty(document, 'cookie', {
            set: function(val) {
              if (typeof val === 'string' && val.includes('fumeiti')) {
                return;
              }
              return origCookieSet.call(this, val);
            },
            get: cookieDesc.get,
            configurable: true
          });
        }
      } catch (e) {}

      // Synchronously scan and intercept script tags and invisible overlay tiles added to DOM
      try {
        const root = document.documentElement || document;
        if (root) {
          const observer = new MutationObserver((mutations) => {
            for (let m = 0; m < mutations.length; m++) {
              const added = mutations[m].addedNodes;
              for (let i = 0; i < added.length; i++) {
                const node = added[i];
                if (!node || node.nodeType !== 1) continue;
                if (node.tagName === 'SCRIPT') {
                  const src = node.getAttribute('src') || node.src || '';
                  const text = node.textContent || '';
                  if (self._isAdOrRedirectUrl(src) || (text && self._isAdCode(text))) {
                    self.notifyBlocked(src || 'inline script', 'DOM MutationObserver blocked script');
                    node.type = 'javascript/blocked';
                    try { node.src = ''; } catch (err) {}
                    try { node.textContent = ''; } catch (err) {}
                    node.remove();
                  }
                } else if (node.tagName === 'DIV' || node.tagName === 'A') {
                  const style = node.getAttribute('style') || '';
                  if (style && (style.includes('opacity:0.01') || style.includes('opacity: 0.01') || style.includes('opacity:0;') || style.includes('opacity: 0;')) && (style.includes('position:fixed') || style.includes('position: fixed') || style.includes('position:absolute'))) {
                    self.notifyBlocked('overlay', 'DOM MutationObserver blocked invisible overlay tile');
                    node.remove();
                  }
                }
              }
            }
          });
          observer.observe(root, { childList: true, subtree: true });
          this._scriptObserver = observer;
        }
      } catch (e) {}

      this._touchHandler = function (e) {
        if (typeof window !== 'undefined' && window.__BESING_ZAPPER_ACTIVE__) {
          return;
        }
        // Neutralize touch on invisible overlays or malicious click-jack tiles
        const target = e.target;
        if (target && target.nodeType === 1) {
          const style = target.getAttribute('style') || '';
          const isTrap = (style.includes('opacity:0.01') || style.includes('opacity: 0.01') || style.includes('opacity:0;') || style.includes('opacity: 0;')) &&
                         (style.includes('position:fixed') || style.includes('position: fixed') || style.includes('position:absolute'));
          if (isTrap) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            self.notifyBlocked('touch-trap', 'quarantined touch on invisible overlay tile');
            try { target.remove(); } catch(err) {}
            return;
          }
        }
      };

      this._auxClickHandler = function (e) {
        if (typeof window !== 'undefined' && window.__BESING_ZAPPER_ACTIVE__) {
          return;
        }
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
      window.addEventListener('touchstart', this._touchHandler, true);
      document.addEventListener('touchstart', this._touchHandler, true);
      window.addEventListener('touchend', this._touchHandler, true);
      document.addEventListener('touchend', this._touchHandler, true);
      window.addEventListener('auxclick', this._auxClickHandler, true);
      document.addEventListener('auxclick', this._auxClickHandler, true);
      window.addEventListener('beforeunload', this._beforeUnloadHandler, true);

      // 13. Inject comprehensive page-context guard for page scripts in main execution world
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
              if (/(?:^|\\/)(?:config\\/)?(?:v\\d+|tj|fumeiti|ads?|union|pop|float|jump|tongji|statistics)\\.js(?:$|\\?)/i.test(s)) return true;
              if (/:(8001|8002|8003|8080|8081|8887|8888|9999|20091|20092|20093)\\b/.test(s) && !isSame(s)) return true;
              if (/(lkg6odg|kt6th8f|fumeiti|comprelu|dsygc|uuysi5|uuysi6|5bjoeih|xq04k6u|qq26oeg|adzxdimq|vdxqxca|oybhpsij|popcash|propellerads|exoclick|adsterra|clickadu|richpush|trafficjunky|adservice|adnetwork|7461c|7461m)/.test(s)) return true;
              if (/(\\/sc\\/\\d+|\\/cc\\/\\d+|\\/d\\/\\d+|\\/mj1\\/\\d+|\\/stats\\/\\d+|\\/push\\/|\\/stat\\/|\\/click\\/)/.test(s) && !isSame(s)) return true;
              if (s.indexOf('?n=') !== -1 || s.indexOf('&target=1') !== -1 || s.indexOf('is_not=1') !== -1 || s.indexOf('ikooenpn') !== -1 || s.indexOf('srisnadi') !== -1) {
                if (!isSame(s)) return true;
              }
              return false;
            }

            function isAdCode(str) {
              if (!str || typeof str !== 'string') return false;
              var s = str.toLowerCase();
              if (/(top\\.location|window\\.location|location\\.href)\\s*(!=|==|=)/.test(s) && (s.indexOf('http') !== -1 || s.indexOf('target=1') !== -1 || s.indexOf('purl') !== -1 || s.indexOf('ikooenpn') !== -1 || s.indexOf('srisnadi') !== -1 || s.indexOf(':800') !== -1 || s.indexOf(':888') !== -1 || s.indexOf('7461') !== -1 || s.indexOf('comprelu') !== -1 || s.indexOf('kt6th8f') !== -1 || s.indexOf('lkg6odg') !== -1 || s.indexOf('adzxdimq') !== -1 || s.indexOf('dsygc') !== -1)) return true;
              if ((s.indexOf('touchend') !== -1 || s.indexOf('touchstart') !== -1 || s.indexOf('changedtouches') !== -1 || s.indexOf('clientheight') !== -1) && (s.indexOf('location.href') !== -1 || s.indexOf('top.location') !== -1 || s.indexOf('window.location') !== -1)) return true;
              if (/(compel_skip_delay|seo_skip_delay|compel_click|ikooenpn_m|srisnadi_m|wsxg|adzxdimq|oybhpsij|7461c|7461m)/.test(s)) return true;
              if (s.indexOf('new function') !== -1 && (s.indexOf('_tdcs') !== -1 || s.indexOf('wvsyru') !== -1 || s.indexOf('nnkqek') !== -1 || s.indexOf('7461') !== -1)) return true;
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

            // Hook window.open in page context
            var origOpen = window.open;
            window.open = function(url, target, feat) {
              if (isAd(url) || (url && !isSame(url)) || target === '_blank' || target === '_new' || !target) {
                window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script window.open' } }));
                return fakeWin(url);
              }
              return origOpen.call(this || window, url, target, feat);
            };

            // Hook Function constructor in page context
            var OrigFunction = window.Function;
            window.Function = function(...args) {
              var code = args[args.length - 1] || '';
              if (typeof code === 'string' && isAdCode(code)) {
                window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: 'payload', reason: 'page-script new Function' } }));
                return function() {};
              }
              return OrigFunction.apply(this, args);
            };
            window.Function.prototype = OrigFunction.prototype;

            // Hook EventTarget.prototype.addEventListener in page context
            var origAEL = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function(t, l, o) {
              if (t === 'devicemotion' || t === 'deviceorientation') return;
              if (typeof l === 'function') {
                try {
                  if (isAdCode(l.toString())) {
                    window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: t, reason: 'page-script addEventListener' } }));
                    return;
                  }
                } catch(e) {}
              }
              return origAEL.call(this, t, l, o);
            };

            // Hook setTimeout & setInterval in page context
            var origSetTimeout = window.setTimeout;
            window.setTimeout = function(h, d, ...args) {
              if (typeof h === 'function') {
                try {
                  if (isAdCode(h.toString())) return 0;
                } catch(e) {}
              }
              return origSetTimeout.call(this, h, d, ...args);
            };

            var origSetInterval = window.setInterval;
            window.setInterval = function(h, d, ...args) {
              if (typeof h === 'function') {
                try {
                  if (isAdCode(h.toString())) return 0;
                } catch(e) {}
              }
              return origSetInterval.call(this, h, d, ...args);
            };

            // Hook WebSocket in page context
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

            // Hook HTMLScriptElement.prototype.src in page context
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

            // Hook insertAdjacentHTML in page context
            var oInsert = Element.prototype.insertAdjacentHTML;
            Element.prototype.insertAdjacentHTML = function(p, h) {
              if (typeof h === 'string' && h.indexOf('position:fixed') !== -1 && (h.indexOf('opacity:0.01') !== -1 || h.indexOf('opacity: 0.01') !== -1 || h.indexOf('opacity:0;') !== -1)) {
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
        } else {
          const docObs = new MutationObserver(() => {
            const r = document.head || document.documentElement;
            if (r) {
              docObs.disconnect();
              r.appendChild(guardScript);
              guardScript.remove();
            }
          });
          docObs.observe(document, { childList: true, subtree: true });
        }
        if (typeof window !== 'undefined') window.__BESING_PREVENT_REDIRECT__ = this;
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
      if (this._origFunction) {
        window.Function = this._origFunction;
        this._origFunction = null;
      }
      if (this._origUnsafeFunction && unsafeWin) {
        try { unsafeWin.Function = this._origUnsafeFunction; } catch (e) {}
        this._origUnsafeFunction = null;
      }
      if (this._origSetTimeout) {
        window.setTimeout = this._origSetTimeout;
        this._origSetTimeout = null;
      }
      if (this._origUnsafeSetTimeout && unsafeWin) {
        try { unsafeWin.setTimeout = this._origUnsafeSetTimeout; } catch (e) {}
        this._origUnsafeSetTimeout = null;
      }
      if (this._origSetInterval) {
        window.setInterval = this._origSetInterval;
        this._origSetInterval = null;
      }
      if (this._origUnsafeSetInterval && unsafeWin) {
        try { unsafeWin.setInterval = this._origUnsafeSetInterval; } catch (e) {}
        this._origUnsafeSetInterval = null;
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
        try {
          const eventProto = (unsafeWin.EventTarget || EventTarget).prototype;
          eventProto.addEventListener = this._origAEL;
        } catch (e) {}
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
        window.removeEventListener('touchstart', this._touchHandler, true);
        document.removeEventListener('touchstart', this._touchHandler, true);
        window.removeEventListener('touchend', this._touchHandler, true);
        document.removeEventListener('touchend', this._touchHandler, true);
        this._touchHandler = null;
      }
      if (this._scriptObserver) {
        try { this._scriptObserver.disconnect(); } catch (e) {}
        this._scriptObserver = null;
      }
      if (this._origDocWrite) {
        try { document.write = this._origDocWrite; } catch (e) {}
        this._origDocWrite = null;
      }
      if (this._origDocWriteln) {
        try { document.writeln = this._origDocWriteln; } catch (e) {}
        this._origDocWriteln = null;
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
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\" ry=\"2\"></rect><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"></path></svg>";
      mod.author = "BESing Team";
      mod.category = "Security";
      return mod;
    })(),

    // Module: PageStream
    (() => {
      const mod = {
    id: 'pagestream',
    name: 'PageStream',
    version: '1.1.0',
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
    _lastStreamTime: 0,
    _lastFetchTime: 0,
    _minStreamInterval: 2500, // Minimum 2.5s between page loads
    _minFetchInterval: 1500,  // Minimum 1.5s between network fetches
    _hasEnded: false,
    _consecutiveErrors: 0,
    _maxPagesPerSession: 50,  // Circuit breaker: max 50 streamed pages per session
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
      this._isPreloading = false;
      this._preloadTimer = null;
      this._lastStreamTime = 0;
      this._lastFetchTime = 0;
      this._hasEnded = false;
      this._consecutiveErrors = 0;

      this._injectStyles();
      this._matchRule();
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
        this._currentNextUrl = this._extractHref(nextEl);
      } else {
        this._currentNextElement = null;
        this._currentNextUrl = null;
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

        const title = (doc.querySelector('title') ? doc.querySelector('title').innerText : '') || `Page ${this._curPageNum + 1}`;
        const mainContent = this._findMainContentElement(doc);
        if (!mainContent) {
          console.warn('[PageStream] Could not detect main content container in remote document.');
          return null;
        }

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
      const { pageNum, url, title, contentNode, nextUrl } = pageData;
      this._curPageNum = pageNum;
      this._currentNextUrl = nextUrl;

      if (!nextUrl || this._loadedUrls.has(nextUrl) || nextUrl === window.location.href) {
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
        try {
          const preData = await this._loadRemotePage(targetUrl);
          if (preData) {
            this._loadedUrls.add(targetUrl);
            this._pageCache.push(preData);
            this._currentNextUrl = preData.nextUrl;
            console.log(`[PageStream] Background preloaded page ${preData.pageNum} ready in cache.`);
          }
        } catch (e) {
          console.warn('[PageStream] Preload failed:', e);
        } finally {
          this._isPreloading = false;
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
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polyline points=\"7 13 12 18 17 13\"></polyline><polyline points=\"7 6 12 11 17 6\"></polyline></svg>";
      mod.author = "BESing Team";
      mod.category = "Productivity";
      return mod;
    })(),

    // Module: Rest Reminder
    (() => {
      const mod = {
    id: 'rest-reminder',
    name: 'Rest Reminder',
    version: '1.0.0',
    description: 'Repeating eye & body rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.',
    category: 'Productivity',
    _config: null,
    _timer: null,
    _checkInterval: null,
    _chatBoxEl: null,
    _targetAlarmTime: 0,
    _boundReposition: null,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._scheduleNextReminder();
      this._startPeriodicChecker();
    },

    onConfigChange(newConfig) {
      const prevInterval = this._getIntervalMinutes();
      this._config = newConfig || {};
      const newInterval = this._getIntervalMinutes();
      if (prevInterval !== newInterval) {
        this._scheduleNextReminder(true);
      }
    },

    destroy() {
      this._clearTimers();
      this.dismissChatBox();
    },

    _getIntervalMinutes() {
      const cfg = this._config || {};
      const val = Number(cfg.intervalMinutes);
      if (!isNaN(val) && val >= 1 && val <= 240) {
        return val;
      }
      return 20; // Default 20 minutes
    },

    _scheduleNextReminder(forceNewCycle = false) {
      this._clearTimers();
      const intervalMinutes = this._getIntervalMinutes();
      const intervalMs = intervalMinutes * 60 * 1000;
      const now = Date.now();

      let targetTime = 0;
      if (!forceNewCycle) {
        try {
          const stored = window.localStorage.getItem('besing_rest_reminder_alarm');
          if (stored) targetTime = Number(stored);
        } catch (e) {}
      }

      // If targetTime is empty, invalid, or expired beyond 2 hours, compute fresh target
      if (!targetTime || isNaN(targetTime) || targetTime < now - (2 * 60 * 60 * 1000)) {
        targetTime = now + intervalMs;
        try {
          window.localStorage.setItem('besing_rest_reminder_alarm', String(targetTime));
        } catch (e) {}
      }

      this._targetAlarmTime = targetTime;

      if (now >= targetTime) {
        // Alarm already due! Show chat box right away
        this.showReminderChatBox();
      } else {
        const delay = Math.max(500, targetTime - now);
        this._timer = setTimeout(() => {
          this.showReminderChatBox();
        }, delay);
      }
    },

    _startPeriodicChecker() {
      if (this._checkInterval) clearInterval(this._checkInterval);
      // Periodically verify in case tab was backgrounded or clock shifted
      this._checkInterval = setInterval(() => {
        if (!this._chatBoxEl && this._targetAlarmTime && Date.now() >= this._targetAlarmTime) {
          this.showReminderChatBox();
        }
      }, 15000);
    },

    _clearTimers() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (this._checkInterval) {
        clearInterval(this._checkInterval);
        this._checkInterval = null;
      }
    },

    showReminderChatBox() {
      if (this._chatBoxEl) return; // Already visible

      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);

      if (appMgr && typeof appMgr.ensureMounted === 'function') {
        appMgr.ensureMounted();
        if (appMgr.widgetEl) {
          // Un-dock if folded so user sees the full pet icon and speech bubble
          appMgr.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        }
      }

      const interval = this._getIntervalMinutes();

      // 1. Create chat box element
      const box = document.createElement('div');
      box.className = 'besing-rest-chat-box';
      box.id = 'besing-rest-chat-box';

      box.innerHTML = `
        <div class="besing-rest-arrow" id="besing-rest-arrow"></div>
        <div class="besing-rest-header">
          <span class="besing-rest-avatar">🐾</span>
          <span class="besing-rest-title">Time to Rest!</span>
          <span class="besing-rest-badge">${interval}m</span>
        </div>
        <div class="besing-rest-msg">
          You've been active for <strong>${interval} minutes</strong>! Look away from the screen, blink, and stretch.
        </div>
        <div class="besing-rest-actions">
          <button type="button" class="besing-rest-btn-repeat" id="besing-rest-btn-repeat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            <span>Repeat (${interval}m)</span>
          </button>
          <button type="button" class="besing-rest-btn-off" id="besing-rest-btn-off">
            Off
          </button>
        </div>
      `;

      // 2. Insert into shadow DOM if available, otherwise document.body
      const targetContainer = (appMgr && appMgr.shadow) ? appMgr.shadow : (document.body || document.documentElement);
      targetContainer.appendChild(box);
      this._chatBoxEl = box;

      this._repositionChatBox();

      // 3. Highlight pet icon with alert pulse while chat box is open
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.add('besing-pulse-alert');
      }

      // 4. Bind Repeat button (Primary action)
      const btnRepeat = box.querySelector('#besing-rest-btn-repeat');
      if (btnRepeat) {
        btnRepeat.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._scheduleNextReminder(true); // force new cycle
        };
      }

      // 5. Bind Off button
      const btnOff = box.querySelector('#besing-rest-btn-off');
      if (btnOff) {
        btnOff.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._disableReminder();
        };
      }

      // 6. Track resize & reposition
      this._boundReposition = () => this._repositionChatBox();
      window.addEventListener('resize', this._boundReposition);
      window.addEventListener('scroll', this._boundReposition, { passive: true });
    },

    dismissChatBox() {
      if (this._chatBoxEl) {
        if (this._chatBoxEl.parentNode) {
          this._chatBoxEl.parentNode.removeChild(this._chatBoxEl);
        }
        this._chatBoxEl = null;
      }
      if (this._boundReposition) {
        window.removeEventListener('resize', this._boundReposition);
        window.removeEventListener('scroll', this._boundReposition);
        this._boundReposition = null;
      }
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.remove('besing-pulse-alert');
      }
    },

    _repositionChatBox() {
      if (!this._chatBoxEl) return;
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      const widget = appMgr && appMgr.widgetEl;
      const box = this._chatBoxEl;
      const arrow = box.querySelector('#besing-rest-arrow');

      const vpW = window.visualViewport?.width || window.innerWidth || 800;
      const vpH = window.visualViewport?.height || window.innerHeight || 600;
      const boxW = Math.min(270, vpW - 24);

      let targetX = vpW - boxW - 20;
      let targetY = vpH - 180;
      let isAbove = true;

      if (widget) {
        const rect = widget.getBoundingClientRect();
        const widgetCenterX = rect.left + rect.width / 2;

        targetX = Math.max(12, Math.min(vpW - boxW - 12, widgetCenterX - boxW / 2));

        if (rect.top > 160) {
          targetY = rect.top - 145;
          isAbove = true;
        } else {
          targetY = rect.bottom + 12;
          isAbove = false;
        }

        if (arrow) {
          arrow.className = isAbove ? 'besing-rest-arrow arrow-bottom' : 'besing-rest-arrow arrow-top';
          const arrowLeft = Math.max(16, Math.min(boxW - 28, widgetCenterX - targetX - 6));
          arrow.style.left = `${arrowLeft}px`;
        }
      }

      box.style.left = `${Math.round(targetX)}px`;
      box.style.top = `${Math.round(targetY)}px`;
    },

    _disableReminder() {
      this.destroy();
      try {
        window.localStorage.removeItem('besing_rest_reminder_alarm');
      } catch (e) {}
      const appMgr = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                     (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      if (appMgr && appMgr.storage && typeof appMgr.storage.setScriptMode === 'function') {
        const host = appMgr.storage.getCurrentHost();
        appMgr.storage.setScriptMode(this.id, 'off', host);
        if (typeof appMgr.refreshCurrentSiteModules === 'function') {
          appMgr.refreshCurrentSiteModules();
        }
        if (typeof appMgr.renderBody === 'function') {
          appMgr.renderBody();
        }
      }
    }
  };
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>";
      mod.author = "BESing Team";
      mod.category = "Productivity";
      return mod;
    })()
  ];

  // 4. Update Engine (Checks version, prompts native update, or auto-updates via stable bootstrapper)
  class BESUpdater {
    static CURRENT_VERSION = '1.6.9';

    static isStableLoader() {
      if (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.name) {
        if (GM_info.script.name.includes('Packed')) return false;
        if (GM_info.script.name.includes('Stable')) return true;
      }
      const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || (typeof window !== 'undefined' && window);
      return typeof win !== 'undefined' && (
        win.__BESING_ENVIRONMENT__ === 'stable-loader' ||
        typeof win.__BESING_AUTO_UPDATE__ === 'function' ||
        typeof win.__BESING_RELOAD_LATEST__ === 'function'
      );
    }

    static CHANNELS = {
      github: {
        name: 'GitHub Releases',
        metaUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js',
        userUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js'
      },
      greasyfork: {
        name: 'Greasy Fork (Public)',
        metaUrl: 'https://update.greasyfork.org/scripts/597772/BESing%20Script%20Manager.meta.js',
        userUrl: 'https://update.greasyfork.org/scripts/597772/BESing%20Script%20Manager.user.js'
      }
    };

    static async fetchText(url) {
      return new Promise((resolve, reject) => {
        const tryFetch = () => {
          const fetchUrl = url.includes('raw.githubusercontent.com')
            ? url.replace('https://raw.githubusercontent.com/CoronRing/BESing/master/', 'https://cdn.jsdelivr.net/gh/CoronRing/BESing@master/')
            : url;
          fetch(`${fetchUrl}${fetchUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-cache' })
            .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
            .then(resolve)
            .catch(reject);
        };

        if (typeof GM_xmlhttpRequest === 'function') {
          try {
            GM_xmlhttpRequest({
              method: 'GET',
              url: `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`,
              timeout: 7000,
              onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : tryFetch(),
              onerror: () => tryFetch(),
              ontimeout: () => tryFetch()
            });
            return;
          } catch (e) {
            tryFetch();
            return;
          }
        } else {
          tryFetch();
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
      const isStable = BESUpdater.isStableLoader();
      try {
        const text = await BESUpdater.fetchText(channel.metaUrl);
        const remoteVer = BESUpdater.parseVersion(text);
        if (!remoteVer) throw new Error('Could not parse remote version header');
        const hasUpdate = BESUpdater.compareVersions(remoteVer, BESUpdater.CURRENT_VERSION) > 0;

        let autoUpdated = false;
        if (hasUpdate && isStable) {
          const autoUpdateFn = (typeof window !== 'undefined' && window.__BESING_AUTO_UPDATE__) ||
                               (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_AUTO_UPDATE__);
          if (typeof autoUpdateFn === 'function') {
            try {
              const uRes = await autoUpdateFn(true);
              if (uRes && uRes.ok !== false) autoUpdated = true;
            } catch (e) {
              console.warn('[BESUpdater] Auto-update hook failed:', e);
            }
          }

          if (!autoUpdated) {
            // Direct download & update into GM cache
            try {
              const newCode = await BESUpdater.fetchText(channel.userUrl);
              if (newCode && newCode.length > 500) {
                if (typeof GM_setValue === 'function') {
                  GM_setValue('besing_cached_code', newCode);
                  GM_setValue('besing_cached_version', remoteVer);
                  GM_setValue('besing_last_check', Date.now());
                  autoUpdated = true;
                } else if (BESAdapter.isGM) {
                  await BESAdapter.set('besing_cached_code', newCode);
                  await BESAdapter.set('besing_cached_version', remoteVer);
                  await BESAdapter.set('besing_last_check', Date.now());
                  autoUpdated = true;
                }
              }
            } catch (err) {
              console.warn('[BESUpdater] Fallback download failed:', err);
            }
          }
        }

        return {
          ok: true,
          isStableLoader: isStable,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          remoteVersion: remoteVer,
          hasUpdate,
          autoUpdated,
          downloadUrl: channel.userUrl
        };
      } catch (err) {
        return {
          ok: false,
          isStableLoader: isStable,
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
      this.activeConfigScriptId = null;
      this.isExpanded = false;
      this.isDragging = false;
      this.dragMoved = false;
      this.startX = 0;
      this.startY = 0;
      this.initialLeft = 0;
      this.initialTop = 0;
      this.updateAvailable = null;
      this.lastFoldSide = null;
      this.outsideClickHandler = null;
    }

    destroy() {
      try {
        if (this.host && this.host.parentNode) {
          this.host.parentNode.removeChild(this.host);
        }
      } catch (e) {}
      this.host = null;
      this.shadow = null;
      this.widgetEl = null;
      this.menuWrapperEl = null;
    }

    initPreemptiveShields() {
      // 1. Immediately and synchronously arm the security shield (prevent-redirect)
      // so zero page scripts or ad networks can slip through during async storage loading.
      if (!this.modules || this.modules.length === 0) {
        this.modules = BUILTIN_MODULES.map(m => ({
          ...m,
          running: false
        }));
      }

      const prModule = this.modules.find(m => m.id === 'prevent-redirect');
      if (prModule && typeof prModule.init === 'function') {
        try {
          prModule.init({});
          prModule.running = true;
          console.log('[BESing] Preemptive security shield synchronously armed at document-start.');
        } catch (e) {
          console.warn('[BESing] Preemptive shield init error:', e);
        }
      }
    }

    async init() {
      await this.storage.init();
      const currentHost = this.storage.getCurrentHost();

      if (!this.modules || this.modules.length === 0) {
        this.modules = BUILTIN_MODULES.map(m => ({
          ...m,
          running: false
        }));
      }

      // Re-evaluate modules with loaded storage configuration
      this.modules.forEach(m => {
        const shouldBeActive = this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);

        if (m.id === 'prevent-redirect') {
          // If explicitly disabled on this site by user, deactivate the preemptive shield
          if (!shouldBeActive && m.running) {
            try {
              m.destroy();
              m.running = false;
              console.log('[BESing] Preemptive security shield deactivated per site rule.');
            } catch (err) {}
          } else if (shouldBeActive && !m.running) {
            try {
              m.init(cfg);
              m.running = true;
            } catch (err) {}
          } else if (shouldBeActive && m.running) {
            try {
              if (typeof m.onConfigChange === 'function') {
                m.onConfigChange(cfg);
              }
            } catch (err) {}
          }
          return;
        }

        if (shouldBeActive && !m.running) {
          try {
            m.init(cfg);
            m.running = true;
          } catch (err) {
            console.error(`[BESing] Error initializing ${m.id}:`, err);
          }
        } else if (!shouldBeActive && m.running) {
          try {
            m.destroy();
            m.running = false;
          } catch (err) {
            console.error(`[BESing] Error destroying ${m.id}:`, err);
          }
        } else if (shouldBeActive && m.running) {
          if (typeof m.onConfigChange === 'function') {
            try { m.onConfigChange(cfg); } catch (e) {}
          }
        }
      });

      // Throttled Update Check:
      // If running inside stable loader: auto-check in background and silently auto-update!
      // If running full script: check once every 24 hours
      if (BESUpdater.isStableLoader()) {
        setTimeout(async () => {
          await this.updater.checkForUpdates(false).catch(() => {});
        }, 3000);
      } else {
        setTimeout(async () => {
          try {
            const lastCheck = await BESAdapter.get('last_update_check_time', 0);
            const ONE_DAY = 24 * 60 * 60 * 1000;
            if (Date.now() - (lastCheck || 0) > ONE_DAY) {
              await this.updater.checkForUpdates(false).catch(() => {});
              await BESAdapter.set('last_update_check_time', Date.now());
            }
          } catch (e) {}
        }, 4000);
      }

      // Hotkey: Alt + Shift + B
      window.addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }
      });

      // Tampermonkey Control Panel Menu Commands
      if (!window.__BESING_MENU_REGISTERED__) {
        window.__BESING_MENU_REGISTERED__ = true;
        BESAdapter.registerMenu('✨ Show / Pull Up BESing Icon', () => {
          this.pullUpIcon();
        });
        BESAdapter.registerMenu('🔄 Reset Icon Position to Default', () => {
          this.resetWidgetPosition();
        });
        BESAdapter.registerMenu('⚙️ Open BESing Settings', () => {
          this.openModal('settings');
        });
        BESAdapter.registerMenu('📦 Open BESing Extensions', () => {
          this.openModal('extensions');
        });
      }

      // Page Navigation & bfcache Resilience
      window.addEventListener('pageshow', (e) => {
        this.ensureMounted();
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      });

      window.addEventListener('popstate', () => {
        this.ensureMounted();
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.ensureMounted();
          this.clampWidgetPosition();
        }
      });

      window.addEventListener('resize', () => {
        this.clampWidgetPosition();
        if (this.widgetEl) this.checkEdgeDocking(this.widgetEl);
      });

      // Heartbeat DOM guardian (every 2.5s) to catch any random DOM detachments
      if (!this._heartbeatInterval) {
        this._heartbeatInterval = setInterval(() => {
          this.ensureMounted();
        }, 2500);
      }

      // Direct DOM MutationObserver on document.documentElement
      try {
        const targetNode = document.documentElement || document.body;
        if (targetNode && !this._domObserver) {
          this._domObserver = new MutationObserver(() => {
            if (this.host && !this.host.isConnected && !this.storage.isCurrentBlocked()) {
              this.ensureMounted();
            }
          });
          this._domObserver.observe(targetNode, { childList: true, subtree: false });
        }
      } catch (e) {}

      if (this.storage.isCurrentBlocked()) {
        console.log(`[BESing] Inactive on ${window.location.hostname} (Site blocked)`);
        return;
      }

      this.mount();
    }

    refreshCurrentSiteModules() {
      const currentHost = this.storage.getCurrentHost();
      this.modules.forEach(m => {
        const shouldBeActive = this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);
        if (shouldBeActive && !m.running) {
          try {
            m.init(cfg);
            m.running = true;
          } catch (err) {
            console.error(`[BESing] Error initializing ${m.id}:`, err);
          }
        } else if (!shouldBeActive && m.running) {
          try {
            m.destroy();
            m.running = false;
          } catch (err) {
            console.error(`[BESing] Error destroying ${m.id}:`, err);
          }
        } else if (shouldBeActive && m.running) {
          if (typeof m.onConfigChange === 'function') {
            try { m.onConfigChange(cfg); } catch (e) {}
          }
        }
      });
      this.updateBadge();
    }

    async applyScriptConfig(scriptId, patch) {
      const currentHost = this.storage.getCurrentHost();
      await this.storage.setScriptConfig(scriptId, patch, currentHost);
      const updatedCfg = this.storage.getScriptConfig(scriptId, currentHost);
      const m = this.modules.find(mod => mod.id === scriptId);
      if (m && m.running) {
        if (typeof m.onConfigChange === 'function') {
          try { m.onConfigChange(updatedCfg); } catch (e) {}
        } else {
          try {
            m.destroy();
            m.init(updatedCfg);
          } catch (e) {}
        }
      }
    }

    openScriptConfig(scriptId) {
      this.activeConfigScriptId = scriptId;
      this.currentView = 'script-config';
      this.renderBody();
    }

    ensureMounted() {
      if (this.storage.isCurrentBlocked()) return;

      const docRoot = document.body || document.documentElement;
      if (!docRoot) return;

      // Discard stale host from old document (WebKit / iPadOS refresh or bfcache)
      if (this.host && this.host.ownerDocument !== document) {
        this.host = null;
        this.shadow = null;
        this.widgetEl = null;
      }

      // 1. Host exists in memory, belongs to current document, but got detached
      if (this.host && !this.host.isConnected) {
        docRoot.appendChild(this.host);
        this.clampWidgetPosition();
        return;
      }

      // 2. Host is null or was removed
      if (!this.host) {
        const existing = document.getElementById('__besing_root__');
        if (existing) {
          existing.remove();
        }
        this.mount();
        return;
      }

      // 3. Make sure widget element is present in shadow DOM
      if (this.shadow && (!this.widgetEl || !this.shadow.contains(this.widgetEl))) {
        this.renderWidget(this.shadow);
      }
    }

    mount() {
      const docRoot = document.body || document.documentElement;
      if (!docRoot) return;

      // Discard stale host from old document
      if (this.host && this.host.ownerDocument !== document) {
        this.host = null;
        this.shadow = null;
        this.widgetEl = null;
      }

      if (this.host && this.host.isConnected) return;

      if (this.host && !this.host.isConnected) {
        docRoot.appendChild(this.host);
        this.clampWidgetPosition();
        return;
      }

      const host = document.createElement('besing-host');
      host.id = '__besing_root__';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '0';
      host.style.height = '0';
      host.style.zIndex = '2147483647';
      host.style.overflow = 'visible';
      host.style.pointerEvents = 'none';
      host.style.display = 'block';
      docRoot.appendChild(host);
      this.host = host;

      const shadow = host.attachShadow({ mode: 'open' });
      this.shadow = shadow;

      this.injectStyles(shadow);
      this.renderWidget(shadow);

      if (!this._redirectListenerAttached) {
        window.addEventListener('besing:redirect-blocked', () => {
          this.blinkRedirectAlert();
        });
        this._redirectListenerAttached = true;
      }
    }

    clampWidgetPosition() {
      if (!this.widgetEl) return;
      const vp = window.visualViewport;
      const doc = document.documentElement;
      const vpW = vp?.width || doc?.clientWidth || window.innerWidth || 0;
      const vpH = vp?.height || doc?.clientHeight || window.innerHeight || 0;

      if (vpW < 200 || vpH < 200) return; // Layout not ready, avoid degenerate clamping

      const maxW = Math.max(300, vpW);
      const maxH = Math.max(300, vpH);

      const currentLeft = parseFloat(this.widgetEl.style.left);
      const currentTop = parseFloat(this.widgetEl.style.top);

      if (!isNaN(currentLeft) && !isNaN(currentTop)) {
        const clampedLeft = Math.max(0, Math.min(maxW - 48, currentLeft));
        const clampedTop = Math.max(0, Math.min(maxH - 48, currentTop));

        if (clampedLeft !== currentLeft || clampedTop !== currentTop) {
          this.widgetEl.style.left = `${clampedLeft}px`;
          this.widgetEl.style.top = `${clampedTop}px`;
          this.widgetEl.style.right = 'auto';
          this.widgetEl.style.bottom = 'auto';
          this.storage.setWidgetPosition({ x: Math.round(clampedLeft), y: Math.round(clampedTop) });
        }
      }
    }

    pullUpIcon() {
      if (this.storage.isCurrentBlocked()) {
        console.log('[BESing] Site was blocked. Mounting and opening settings...');
        this.mount();
        this.openModal('settings');
        return;
      }

      this.ensureMounted();

      if (!this.widgetEl) {
        if (this.shadow) this.renderWidget(this.shadow);
        else this.mount();
      }

      if (!this.widgetEl) return;

      // 1. Un-dock / un-fold
      this.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

      // 2. Position comfortably in visible viewport (bottom-right)
      const vp = window.visualViewport;
      const doc = document.documentElement;
      const clientW = Math.max(300, vp?.width || (doc ? doc.clientWidth : window.innerWidth) || 800);
      const clientH = Math.max(300, vp?.height || (doc ? doc.clientHeight : window.innerHeight) || 600);
      const targetLeft = Math.max(20, clientW - 72);
      const targetTop = Math.max(20, clientH - 120);

      this.widgetEl.style.left = `${targetLeft}px`;
      this.widgetEl.style.top = `${targetTop}px`;
      this.widgetEl.style.right = 'auto';
      this.widgetEl.style.bottom = 'auto';
      this.widgetEl.style.display = 'flex';
      this.widgetEl.style.opacity = '1';
      this.widgetEl.style.visibility = 'visible';

      this.storage.setWidgetPosition({ x: targetLeft, y: targetTop });

      // 3. Highlight with bright pulse animation
      this.widgetEl.classList.remove('besing-pulse-alert');
      void this.widgetEl.offsetWidth; // reflow
      this.widgetEl.classList.add('besing-pulse-alert');
      setTimeout(() => {
        if (this.widgetEl) this.widgetEl.classList.remove('besing-pulse-alert');
      }, 2500);

      console.log(`[BESing] Pull-up icon succeeded at (${targetLeft}, ${targetTop})`);
    }

    resetWidgetPosition() {
      if (this.widgetEl) {
        this.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        this.widgetEl.style.left = '';
        this.widgetEl.style.top = '';
        this.widgetEl.style.right = '18px';
        this.widgetEl.style.bottom = '90px';
        this.widgetEl.style.display = 'flex';
      }
      this.storage.setWidgetPosition(null);
      this.pullUpIcon();
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
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }
      if (this._domObserver) {
        this._domObserver.disconnect();
        this._domObserver = null;
      }
      if (this.outsideClickHandler) {
        document.removeEventListener('click', this.outsideClickHandler);
        this.outsideClickHandler = null;
      }
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
      const doc = document.documentElement;
      const maxW = Math.max(300, (doc ? doc.clientWidth : window.innerWidth) || 800);
      const maxH = Math.max(300, (doc ? doc.clientHeight : window.innerHeight) || 600);

      if (savedPos && savedPos.x !== undefined && savedPos.y !== undefined) {
        const clampX = Math.max(0, Math.min(maxW - 48, savedPos.x));
        const clampY = Math.max(0, Math.min(maxH - 48, savedPos.y));
        btn.style.left = `${clampX}px`;
        btn.style.top = `${clampY}px`;
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
      const currentHost = this.storage.getCurrentHost();
      const activeCount = this.modules.filter(m => this.storage.isScriptActiveOnSite(m.id, currentHost)).length;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'besing-badge-count';
        this.widgetEl.appendChild(badge);
      }
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'flex' : 'none';
    }

    safeParseHTML(htmlStr) {
      if (!htmlStr) return document.createDocumentFragment();
      const frag = document.createDocumentFragment();
      const svgNS = 'http://www.w3.org/2000/svg';

      const tokenRegex = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z0-9\-:]+)([^>]*?)(\/?>)|([^<]+)/g;
      const attrRegex = /([a-zA-Z0-9\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

      const voidElements = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
        'link', 'meta', 'param', 'source', 'track', 'wbr',
        'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'stop'
      ]);

      const stack = [{ node: frag, inSVG: false }];
      let match;

      while ((match = tokenRegex.exec(htmlStr)) !== null) {
        if (match[0].startsWith('<!--')) continue;
        if (match[5]) {
          const text = match[5];
          if (text) {
            stack[stack.length - 1].node.appendChild(document.createTextNode(text));
          }
          continue;
        }

        const isClosing = match[1] === '/';
        const rawTagName = match[2];
        const tagName = rawTagName ? rawTagName.toLowerCase() : '';
        const rawAttrs = match[3];
        const isSelfClosing = (match[4] && match[4].startsWith('/')) || voidElements.has(tagName);

        if (isClosing) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tagName) {
              stack.length = i;
              break;
            }
          }
        } else if (tagName) {
          const parent = stack[stack.length - 1];
          const isSVGTag = tagName === 'svg' || parent.inSVG;
          
          const el = isSVGTag ? document.createElementNS(svgNS, tagName) : document.createElement(tagName);

          let aMatch;
          attrRegex.lastIndex = 0;
          while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {
            const aName = aMatch[1];
            if (aName === '/' || !aName) continue;
            const aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] !== undefined ? aMatch[4] : ''));
            if (aName.startsWith('on')) continue;
            if (aName === 'class') {
              if (!isSVGTag) el.className = aVal;
              el.setAttribute('class', aVal);
            } else if (aName === 'style') {
              el.style.cssText = aVal;
              el.setAttribute('style', aVal);
            } else if (aName === 'checked') {
              el.checked = true;
            } else if (aName === 'disabled') {
              el.disabled = true;
            } else if (aName === 'selected') {
              el.selected = true;
            } else if (aName === 'value' && (tagName === 'input' || tagName === 'textarea' || tagName === 'select')) {
              el.value = aVal;
              el.setAttribute('value', aVal);
            } else {
              el.setAttribute(aName, aVal);
            }
          }

          parent.node.appendChild(el);

          if (!isSelfClosing) {
            stack.push({ node: el, inSVG: isSVGTag, tagName: tagName });
          }
        }
      }
      return frag;
    }

    createSVG(svgString) {
      if (!svgString) return null;
      const frag = this.safeParseHTML(svgString);
      return frag.querySelector('svg') || frag.firstElementChild || null;
    }

    setSafeHTML(container, htmlString) {
      if (!container) return;
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      if (!htmlString) return;
      const frag = this.safeParseHTML(htmlString);
      container.appendChild(frag);
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
      const oldSvg = btn.querySelector('svg');
      if (oldSvg) oldSvg.remove();
      const node = this.createSVG(inner);
      if (node) {
        btn.insertBefore(node, btn.firstChild);
      } else {
        this.setSafeHTML(btn, inner);
      }
      this.updateBadge();
    }

    setupDragging(btn) {
      let lastToggleTime = 0;
      let isTouch = false;
      const doToggle = () => {
        const now = Date.now();
        if (now - lastToggleTime < 350) return;
        lastToggleTime = now;
        this.toggleModal();
      };

      const onStart = (e) => {
        if (e.target.closest('.besing-bubble-wrapper')) return;
        this.isDragging = true;
        this.dragMoved = false;
        isTouch = !!e.touches;
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

        if (!this.dragMoved && isTouch) {
          this._justTouchToggled = true;
          setTimeout(() => { this._justTouchToggled = false; }, 600);
          doToggle();
        }
      };

      btn.addEventListener('mousedown', onStart);
      btn.addEventListener('touchstart', onStart, { passive: true });
      btn.addEventListener('click', (e) => {
        if (this.dragMoved || this._justTouchToggled) {
          this.dragMoved = false;
          return;
        }
        doToggle();
      });
    }

    checkEdgeDocking(btn) {
      const vp = window.visualViewport;
      const doc = document.documentElement;
      const clientW = vp?.width || doc?.clientWidth || window.innerWidth || 800;
      const clientH = vp?.height || doc?.clientHeight || window.innerHeight || 600;
      if (clientW < 200 || clientH < 200) return;

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
      if (this.outsideClickHandler) {
        document.removeEventListener('click', this.outsideClickHandler, true);
        document.removeEventListener('click', this.outsideClickHandler, false);
        this.outsideClickHandler = null;
      }
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

      const header = document.createElement('div');
      header.className = 'besing-header';

      const logoGroup = document.createElement('div');
      logoGroup.className = 'besing-logo-group';

      const logoIcon = document.createElement('div');
      logoIcon.className = 'besing-logo-icon';
      const logoSvg = this.createSVG(`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`);
      if (logoSvg) logoIcon.appendChild(logoSvg);
      logoGroup.appendChild(logoIcon);

      const titleGroup = document.createElement('div');
      const titleSpan = document.createElement('span');
      titleSpan.className = 'besing-title';
      titleSpan.textContent = BESUpdater.isStableLoader() ? 'BESing Stable' : 'BESing Packed';
      const tagSpan = document.createElement('span');
      tagSpan.className = 'besing-tag';
      tagSpan.textContent = `v${BESUpdater.CURRENT_VERSION}`;
      titleGroup.appendChild(titleSpan);
      titleGroup.appendChild(tagSpan);
      logoGroup.appendChild(titleGroup);
      header.appendChild(logoGroup);

      const headerActions = document.createElement('div');
      headerActions.className = 'besing-header-actions';

      const settingsBtn = document.createElement('button');
      settingsBtn.className = `besing-btn-icon ${this.currentView === 'settings' ? 'active' : ''}`;
      settingsBtn.id = 'besing-btn-settings';
      settingsBtn.title = 'Settings';
      const settingsSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`);
      if (settingsSvg) settingsBtn.appendChild(settingsSvg);
      headerActions.appendChild(settingsBtn);

      const expandBtn = document.createElement('button');
      expandBtn.className = 'besing-btn-icon';
      expandBtn.id = 'besing-btn-expand';
      expandBtn.title = 'Toggle Size';
      const expandSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`);
      if (expandSvg) expandBtn.appendChild(expandSvg);
      headerActions.appendChild(expandBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'besing-btn-icon';
      closeBtn.id = 'besing-btn-close';
      closeBtn.title = 'Close';
      const closeSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`);
      if (closeSvg) closeBtn.appendChild(closeSvg);
      headerActions.appendChild(closeBtn);

      header.appendChild(headerActions);
      panel.appendChild(header);

      const body = document.createElement('div');
      body.className = 'besing-body';
      body.id = 'besing-body';
      panel.appendChild(body);

      this.shadow.appendChild(wrapper);
      this.menuWrapperEl = wrapper;

      this.positionBubble(wrapper, panel, arrow);

      wrapper.addEventListener('click', (e) => e.stopPropagation());
      wrapper.addEventListener('mousedown', (e) => e.stopPropagation());

      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeModal();
      };
      expandBtn.onclick = (e) => {
        e.stopPropagation();
        this.isExpanded = !this.isExpanded;
        panel.classList.toggle('is-expanded', this.isExpanded);
        this.positionBubble(wrapper, panel, arrow);
      };
      settingsBtn.onclick = (e) => {
        e.stopPropagation();
        this.currentView = this.currentView === 'settings' ? 'extensions' : 'settings';
        settingsBtn.classList.toggle('active', this.currentView === 'settings');
        this.renderBody();
      };

      setTimeout(() => {
        if (!this.menuWrapperEl || this.menuWrapperEl !== wrapper) return;
        this.outsideClickHandler = (e) => {
          if (!this.menuWrapperEl) return;
          const path = e.composedPath ? e.composedPath() : [];
          if (!path.includes(wrapper) && (!this.widgetEl || !path.includes(this.widgetEl))) {
            this.closeModal();
          }
        };
        document.addEventListener('click', this.outsideClickHandler);
      }, 80);

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
      const body = this.menuWrapperEl ? this.menuWrapperEl.querySelector('#besing-body') : null;
      if (!body) return;
      const prevScroll = body.scrollTop;
      const isSameView = this._prevRenderedView === this.currentView;
      this._prevRenderedView = this.currentView;
      try {
        this.setSafeHTML(body, '');

      if (this.currentView === 'settings') {
        const currentHost = window.location.hostname || 'localhost';
        const curTheme = this.storage.getTheme();

        this.setSafeHTML(body, `
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
              <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">
                ${BESUpdater.isStableLoader() ? 'Mode: <strong style="color:#38bdf8;">BESing Stable (Bootstrapper)</strong> (Automatic silent updates)' : 'Mode: <strong style="color:#a78bfa;">BESing Packed (Standalone)</strong> (Updates via Userscript Manager)'}
              </div>
              ${(!BESUpdater.isStableLoader() && ((typeof window !== 'undefined' && (window.__BESING_ENVIRONMENT__ === 'stable-loader' || typeof window.__BESING_AUTO_UPDATE__ === 'function')) || (typeof unsafeWindow !== 'undefined' && (unsafeWindow.__BESING_ENVIRONMENT__ === 'stable-loader' || typeof unsafeWindow.__BESING_AUTO_UPDATE__ === 'function')))) ? `
                <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#fca5a5;line-height:1.4;">
                  ⚠️ <strong>Duplicate Active:</strong> "BESing Stable" bootstrapper is also running on this page. Please disable "BESing Stable" in your userscript manager to prevent conflicts.
                </div>
              ` : ''}
              <div class="besing-update-actions">
                <button class="besing-btn-sync" id="besing-btn-check-update" style="flex:1;">
                  ${BESUpdater.isStableLoader() ? 'Check & Auto-Update Now' : 'Check Updates Now'}
                </button>
              </div>
              <div class="besing-update-msg" id="besing-update-msg">
                ${BESUpdater.isStableLoader() ? 'Updates download and apply automatically in background.' : 'Checks against Greasy Fork / GitHub releases.'}
              </div>
            </div>

            <div class="besing-site-card">
              <div class="besing-site-card-header">
                <div>
                  <div class="besing-section-title" style="color:#38bdf8;">Current Website</div>
                  <div class="besing-current-domain">${currentHost}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="font-size:11px;color:${this.storage.isCurrentBlocked() ? '#f87171' : '#94a3b8'};">${this.storage.isCurrentBlocked() ? 'Site Disabled' : 'Disable on this site'}</span>
                  <label class="besing-switch" title="Disable all scripts on ${currentHost}">
                    <input type="checkbox" id="besing-btn-turn-off-site" ${this.storage.isCurrentBlocked() ? 'checked' : ''}>
                    <span class="besing-slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <div class="besing-site-rules-wrap">
              <div class="besing-blocklist-header">
                <span class="besing-blocklist-title">Site Specific Rules</span>
                <span class="besing-blocklist-count" id="besing-rules-count">0</span>
              </div>
              <div class="besing-site-rules-list" id="besing-site-rules-container"></div>
              <div class="besing-add-override-row" style="margin-top:10px;display:flex;gap:6px;align-items:center;">
                <input type="text" class="besing-input-sm" id="besing-settings-new-host" placeholder="domain (e.g. google.com, rbc.com)" style="flex:1;">
                <select class="besing-select-sm" id="besing-settings-new-script">
                  ${this.modules.map(mod => `<option value="${mod.id}">${mod.name}</option>`).join('')}
                </select>
                <select class="besing-select-sm" id="besing-settings-new-mode">
                  <option value="site">Site Only (ON)</option>
                  <option value="site-off">Excluded (OFF)</option>
                </select>
                <button type="button" class="besing-btn-sub-action" id="besing-settings-btn-add-rule" style="color:#38bdf8;border-color:rgba(56,189,248,0.3);font-weight:700;">+ Add</button>
              </div>
            </div>
          </div>
        `);

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
                if (res.isStableLoader && res.autoUpdated) {
                  this.setSafeHTML(updateMsg, `<span style="color:#10b981;font-weight:700;">✅ Auto-Updated to v${res.remoteVersion}!</span> The latest code is installed. <button id="besing-btn-reload-now" style="margin-left:8px;padding:3px 8px;font-size:11px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reload Page</button> to activate.`);
                  const rBtn = body.querySelector('#besing-btn-reload-now');
                  if (rBtn) rBtn.onclick = () => window.location.reload();
                } else {
                  this.setSafeHTML(updateMsg, `<span style="color:#a78bfa;font-weight:700;">Update found!</span> v${res.remoteVersion} available. <a href="${res.downloadUrl}" target="_blank" style="color:#38bdf8;text-decoration:underline;">Click here to install update via Userscript Manager</a>.`);
                }
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

        body.querySelector('#besing-btn-turn-off-site').onchange = async (e) => {
          const val = e.target.checked;
          await this.storage.setSiteDisabledAll(currentHost, val);
          this.refreshCurrentSiteModules();
          renderSiteRulesList();
        };

        const renderSiteRulesList = () => {
          const container = body.querySelector('#besing-site-rules-container');
          const countEl = body.querySelector('#besing-rules-count');
          if (!container) return;
          this.setSafeHTML(container, '');
          const allRules = this.storage.getAllSiteRules();
          const hosts = Object.keys(allRules).sort();
          if (countEl) countEl.textContent = hosts.length;

          if (!hosts.length) {
            this.setSafeHTML(container, '<div class="besing-empty-state">No site-specific rules configured.<br><span style="font-size:10px;color:#64748b;">Set a script to "SITE" in the main list to enable it for a single site.</span></div>');
            return;
          }

          hosts.forEach(host => {
            const rule = allRules[host];
            const group = document.createElement('div');
            group.className = 'besing-site-group';

            let ruleCount = 0;
            if (rule.disableAll) ruleCount++;
            if (rule.scripts) ruleCount += Object.keys(rule.scripts).length;
            if (rule.configs) {
              Object.keys(rule.configs).forEach(sid => {
                if (!rule.scripts || rule.scripts[sid] === undefined) ruleCount++;
              });
            }

            const groupHeader = document.createElement('div');
            groupHeader.className = 'besing-site-group-header';
            this.setSafeHTML(groupHeader, `
              <div class="besing-site-group-title">
                <svg class="besing-site-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span>${host}</span>
                <span class="besing-site-rule-count">${ruleCount} configured</span>
              </div>
              <button type="button" class="besing-btn-del-site" title="Remove all rules for ${host}">Remove Site</button>
            `);

            // Collapsible dropdown toggle: click header to expand/collapse rules
            groupHeader.onclick = (e) => {
              if (e.target.closest('.besing-btn-del-site')) return;
              group.classList.toggle('collapsed');
            };

            groupHeader.querySelector('.besing-btn-del-site').onclick = async (e) => {
              e.stopPropagation();
              await this.storage.removeSiteRule(host, 'all');
              renderSiteRulesList();
              this.refreshCurrentSiteModules();
            };
            group.appendChild(groupHeader);

            const rulesList = document.createElement('div');
            rulesList.className = 'besing-site-subrules';

            if (rule.disableAll) {
              const row = document.createElement('div');
              row.className = 'besing-site-rule-row';
              this.setSafeHTML(row, `
                <div class="besing-site-rule-info">
                  <span class="besing-site-rule-name" style="color:#f87171;font-weight:600;">Disable all</span>
                  <span class="besing-site-rule-tag" style="background:rgba(239,68,68,0.15);color:#fca5a5;">Site Disabled</span>
                </div>
                <div class="besing-site-rule-actions">
                  <label class="besing-switch besing-switch-sm">
                    <input type="checkbox" checked>
                    <span class="besing-slider"></span>
                  </label>
                  <button class="besing-rule-remove" title="Remove rule">✕</button>
                </div>
              `);
              row.querySelector('input').onchange = async (e) => {
                await this.storage.toggleSiteRule(host, 'disableAll', e.target.checked);
                renderSiteRulesList();
                this.refreshCurrentSiteModules();
              };
              row.querySelector('.besing-rule-remove').onclick = async (e) => {
                e.stopPropagation();
                await this.storage.removeSiteRule(host, 'disableAll');
                renderSiteRulesList();
                this.refreshCurrentSiteModules();
              };
              rulesList.appendChild(row);
            }

            if (rule.scripts) {
              Object.keys(rule.scripts).forEach(scriptId => {
                const isEnabled = !!rule.scripts[scriptId];
                const m = this.modules.find(mod => mod.id === scriptId) || { name: scriptId };
                const row = document.createElement('div');
                row.className = 'besing-site-rule-row';
                this.setSafeHTML(row, `
                  <div class="besing-site-rule-info">
                    <span class="besing-site-rule-name">${m.name}</span>
                    <span class="besing-site-rule-tag" style="${isEnabled ? 'background:rgba(56,189,248,0.15);color:#38bdf8;' : 'background:rgba(245,158,11,0.15);color:#fbbf24;'}">${isEnabled ? 'Site ON' : 'Excluded (OFF)'}</span>
                  </div>
                  <div class="besing-site-rule-actions">
                    <label class="besing-switch besing-switch-sm" title="Toggle between Site ON and Excluded (OFF)">
                      <input type="checkbox" ${isEnabled ? 'checked' : ''}>
                      <span class="besing-slider"></span>
                    </label>
                    <button class="besing-rule-remove" title="Remove rule">✕</button>
                  </div>
                `);
                row.querySelector('input').onchange = async (e) => {
                  await this.storage.setSiteOverride(scriptId, host, e.target.checked ? 'site' : 'site-off');
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                };
                row.querySelector('.besing-rule-remove').onclick = async (e) => {
                  e.stopPropagation();
                  await this.storage.removeSiteOverride(scriptId, host);
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                };
                rulesList.appendChild(row);
              });
            }

            if (rule.configs) {
              Object.keys(rule.configs).forEach(scriptId => {
                if (rule.scripts && rule.scripts[scriptId] !== undefined) return;
                const m = this.modules.find(mod => mod.id === scriptId) || { name: scriptId };
                const row = document.createElement('div');
                row.className = 'besing-site-rule-row';
                this.setSafeHTML(row, `
                  <div class="besing-site-rule-info">
                    <span class="besing-site-rule-name">${m.name}</span>
                    <span class="besing-site-rule-tag" style="background:rgba(167,139,250,0.15);color:#a78bfa;">Custom Settings</span>
                  </div>
                  <div class="besing-site-rule-actions">
                    <button class="besing-rule-remove" title="Reset site settings">✕</button>
                  </div>
                `);
                row.querySelector('.besing-rule-remove').onclick = async (e) => {
                  e.stopPropagation();
                  delete rule.configs[scriptId];
                  this.storage.cleanupSiteRule(host);
                  await BESAdapter.set('site_rules', this.storage.siteRules);
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                };
                rulesList.appendChild(row);
              });
            }

            if (ruleCount === 0) {
              const emptyRow = document.createElement('div');
              emptyRow.className = 'besing-site-rule-row';
              emptyRow.style.color = '#64748b';
              emptyRow.style.fontSize = '11px';
              emptyRow.style.padding = '6px 0';
              emptyRow.style.fontStyle = 'italic';
              emptyRow.textContent = 'No active rules configured for this site.';
              rulesList.appendChild(emptyRow);
            }

            group.appendChild(rulesList);
            container.appendChild(group);
          });
        };
        renderSiteRulesList();

        const btnAddSiteRule = body.querySelector('#besing-settings-btn-add-rule');
        if (btnAddSiteRule) {
          btnAddSiteRule.onclick = async () => {
            const inputH = body.querySelector('#besing-settings-new-host');
            const selectS = body.querySelector('#besing-settings-new-script');
            const selectM = body.querySelector('#besing-settings-new-mode');
            const rawH = (inputH ? inputH.value : '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (!rawH) return;
            const scriptId = selectS ? selectS.value : (this.modules[0] ? this.modules[0].id : '');
            const modeVal = selectM ? selectM.value : 'site';
            await this.storage.setSiteOverride(scriptId, rawH, modeVal);
            inputH.value = '';
            renderSiteRulesList();
            this.refreshCurrentSiteModules();
          };
        }

      } else if (this.currentView === 'script-config') {
        this.renderScriptConfig(body);
      } else {
        // Extensions View: 3-stage toggles (OFF / SITE / ON)
        this.setSafeHTML(body, `
          <div class="besing-search-wrap">
            <svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="besing-search-input" placeholder="Search installed scripts..." value="${this.searchQuery}">
          </div>
          <div class="besing-ext-list" id="besing-ext-container"></div>
        `);

        const searchInput = body.querySelector('.besing-search-input');
        const extContainer = body.querySelector('#besing-ext-container');

        const renderCards = () => {
          const prevScroll = body ? body.scrollTop : 0;
          this.setSafeHTML(extContainer, '');
          const q = this.searchQuery;
          const currentHost = this.storage.getCurrentHost();
          const filtered = this.modules.filter(m => {
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
          });

          const header = document.createElement('div');
          header.className = 'besing-section-heading';
          this.setSafeHTML(header, `
            <span>Installed Scripts</span>
            <span class="besing-pill-count">${filtered.length}</span>
          `);
          extContainer.appendChild(header);

          if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'besing-empty-state';
            empty.textContent = q ? 'No scripts match your search.' : 'No scripts found.';
            extContainer.appendChild(empty);
            if (body && prevScroll > 0) body.scrollTop = prevScroll;
            return;
          }

          filtered.forEach(m => {
            const card = document.createElement('div');
            card.className = 'besing-ext-card';
            card.setAttribute('data-id', m.id);
            let currentMode = this.storage.getScriptMode(m.id, currentHost); // 'off' | 'site' | 'site-off' | 'on'

            let rotatorText = 'off';
            let rotatorTitle = 'State: OFF. Click to turn ON globally';
            if (currentMode === 'on') {
              rotatorText = 'on';
              rotatorTitle = 'State: GLOBAL ON. Click to activate on THIS SITE ONLY';
            } else if (currentMode === 'site') {
              rotatorText = 'site on';
              rotatorTitle = `State: SITE ON (${currentHost}). Click to turn OFF globally`;
            } else if (currentMode === 'site-off') {
              rotatorText = 'site off';
              rotatorTitle = `State: EXCLUDED on ${currentHost}. Click to turn OFF globally`;
            }

            this.setSafeHTML(card, `
              <div class="besing-ext-info-group">
                <div class="besing-ext-icon">${m.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}</div>
                <div class="besing-ext-meta">
                  <div class="besing-ext-title-row">
                    <span class="besing-ext-name" title="${m.name} • v${m.version || '1.0.0'} • ${m.category || 'General'}">${m.name}</span>
                  </div>
                  <p class="besing-ext-desc">${m.description || ''}</p>
                </div>
              </div>
              <div class="besing-ext-actions">
                <button type="button" class="besing-btn-script-gear" data-script-id="${m.id}" title="Configure ${m.name}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button type="button" class="besing-rotator-toggle mode-${currentMode}" data-script-id="${m.id}" title="${rotatorTitle}">
                  <span class="besing-rotator-knob"></span>
                  <span class="besing-rotator-text">${rotatorText}</span>
                </button>
              </div>
            `);

            const rotatorBtn = card.querySelector('.besing-rotator-toggle');
            rotatorBtn.onclick = async (e) => {
              e.stopPropagation();
              let nextMode = 'on';
              if (currentMode === 'off') {
                nextMode = 'on';
              } else if (currentMode === 'on') {
                nextMode = 'site';
              } else if (currentMode === 'site') {
                nextMode = 'off';
              } else if (currentMode === 'site-off') {
                nextMode = 'off';
              }
              currentMode = nextMode;
              await this.storage.setScriptMode(m.id, nextMode, currentHost);

              // Update toggle state in-place to prevent resetting scroll position to top
              rotatorBtn.className = `besing-rotator-toggle mode-${nextMode}`;
              let rText = 'off';
              let rTitle = 'State: OFF. Click to turn ON globally';
              if (nextMode === 'on') {
                rText = 'on';
                rTitle = 'State: GLOBAL ON. Click to activate on THIS SITE ONLY';
              } else if (nextMode === 'site') {
                rText = 'site on';
                rTitle = `State: SITE ON (${currentHost}). Click to turn OFF globally`;
              } else if (nextMode === 'site-off') {
                rText = 'site off';
                rTitle = `State: EXCLUDED on ${currentHost}. Click to turn OFF globally`;
              }
              rotatorBtn.title = rTitle;
              const textSpan = rotatorBtn.querySelector('.besing-rotator-text');
              if (textSpan) textSpan.textContent = rText;

              this.refreshCurrentSiteModules();
            };

            const btnGear = card.querySelector('.besing-btn-script-gear');
            if (btnGear) {
              btnGear.onclick = (e) => {
                e.stopPropagation();
                this.openScriptConfig(m.id);
              };
            }

            const infoGroup = card.querySelector('.besing-ext-info-group');
            if (infoGroup) {
              infoGroup.style.cursor = 'pointer';
              infoGroup.title = 'Click to open configuration for ' + m.name;
              infoGroup.onclick = (e) => {
                e.stopPropagation();
                this.openScriptConfig(m.id);
              };
            }

            extContainer.appendChild(card);
          });

          if (body && prevScroll > 0) body.scrollTop = prevScroll;
          requestAnimationFrame(() => {
            if (body && prevScroll > 0) body.scrollTop = prevScroll;
          });
        };

        if (searchInput) {
          searchInput.oninput = (e) => {
            this.searchQuery = e.target.value.toLowerCase().trim();
            renderCards();
          };
        }

        renderCards();
      }
    } catch (err) {
      console.error('[BESing] Error rendering menu body:', err);
      this.setSafeHTML(body, `
        <div class="besing-empty-state" style="color:#fca5a5;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.05);padding:16px;">
          <div style="font-weight:700;margin-bottom:6px;">Failed to render script menu</div>
          <div style="font-size:11px;color:#94a3b8;font-family:monospace;">${err.message || err}</div>
          <button type="button" id="besing-btn-retry-render" style="margin-top:10px;padding:4px 10px;font-size:11px;background:#38bdf8;color:#0f172a;border:none;border-radius:6px;cursor:pointer;font-weight:700;">Retry</button>
        </div>
      `);
      const retryBtn = body.querySelector('#besing-btn-retry-render');
      if (retryBtn) retryBtn.onclick = () => this.renderBody();
    }
    if (isSameView && prevScroll > 0) {
      body.scrollTop = prevScroll;
    }
  }

    renderScriptConfig(body) {
      const m = this.modules.find(mod => mod.id === this.activeConfigScriptId);
      if (!m) {
        this.currentView = 'extensions';
        this.renderBody();
        return;
      }

      const currentHost = this.storage.getCurrentHost();
      const currentMode = this.storage.getScriptMode(m.id, currentHost);
      const cfg = this.storage.getScriptConfig(m.id, currentHost);

      const isGloballyOn = !!this.storage.enabledScripts[m.id];
      let scopeNotice = '';
      if (currentMode === 'site') {
        scopeNotice = `
          <div class="besing-config-scope site">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
            <div><strong>Site-Only Config (${currentHost}):</strong> Settings are saved exclusively for this site and bypass global settings. Switching to OFF wipes this site's custom settings.</div>
          </div>
        `;
      } else if (currentMode === 'site-off') {
        scopeNotice = `
          <div class="besing-config-scope site-off">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <div><strong style="color:#fbbf24;">Excluded on ${currentHost}:</strong> Disabled specifically on this website, while remaining globally active on other sites.</div>
          </div>
        `;
      } else if (currentMode === 'on') {
        scopeNotice = `
          <div class="besing-config-scope global">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>
            <div><strong>Global Config:</strong> Saved globally across all websites (unless a site-only override exists).</div>
          </div>
        `;
      } else {
        scopeNotice = `
          <div class="besing-config-scope off">
            <div>⚪ <strong>Script is currently OFF.</strong> Switch toggle to <strong>${isGloballyOn ? 'ON (GLOBAL)' : 'SITE ONLY'}</strong> to activate.</div>
          </div>
        `;
      }

      let specificControls = '';

      if (m.id === 'text-size-control') {
        const curZoom = Math.max(70, Math.min(400, Number(cfg.fontSizePercent) || 125));
        const curMode = cfg.mode || 'hybrid';
        const presets = [100, 115, 125, 150, 175, 200, 250, 300];
        const presetsHtml = presets.map(p => `
          <button type="button" class="besing-zoom-pill ${curZoom === p ? 'active' : ''}" data-zoom="${p}">${p}%</button>
        `).join('');

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-zoom-hero">
              <div class="besing-zoom-val" id="besing-zoom-val">${curZoom}%</div>
              <div class="besing-zoom-desc">Active Text & Page Scale (Supports beyond 200% system max)</div>
            </div>

            <div class="besing-zoom-slider-row">
              <button type="button" class="besing-stepper-btn" id="btn-zoom-minus" title="Decrease">−</button>
              <input type="range" class="besing-slider-range" id="zoom-range" min="80" max="350" step="5" value="${curZoom}">
              <button type="button" class="besing-stepper-btn" id="btn-zoom-plus" title="Increase">+</button>
            </div>

            <div class="besing-section-title" style="margin-top:10px;">Scale Presets</div>
            <div class="besing-preset-row">
              ${presetsHtml}
            </div>

            <div class="besing-section-title" style="margin-top:10px;">Scaling Mode</div>
            <div class="besing-segmented-group" id="group-text-size-mode" style="margin-top:4px;">
              <button type="button" class="besing-segmented-btn ${curMode === 'hybrid' ? 'active' : ''}" data-mode="hybrid" title="Page zoom with paragraph unlock (Recommended)">⚡ Smart Hybrid</button>
              <button type="button" class="besing-segmented-btn ${curMode === 'text-only' ? 'active' : ''}" data-mode="text-only" title="Scales paragraphs and headings directly without altering page width">📖 Text Only</button>
              <button type="button" class="besing-segmented-btn ${curMode === 'zoom' ? 'active' : ''}" data-mode="zoom" title="Full layout and element zoom">🔍 Page Zoom</button>
            </div>

            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
              <button type="button" class="besing-btn-sub-action" id="btn-reset-zoom">Reset to 100%</button>
              <span style="font-size:10px;color:#64748b;">Counter-zoomed widget stays crisp</span>
            </div>
          </div>
        `;
      } else if (m.id === 'color-change') {
        const curBrightness = Math.max(-100, Math.min(100, Number(cfg.brightness) || 0));
        const curPreset = cfg.preset || 'eye-protect';
        const customColor = cfg.customColor || '#cce8cf';
        const curTextColor = cfg.textColor || 'default';
        const customTextColor = cfg.customTextColor || '#ffffff';

        const presets = [
          { key: 'none', name: 'Original', color: 'transparent', border: '#475569' },
          { key: 'eye-protect', name: 'Eye Protect', color: '#cce8cf', border: '#86efac' },
          { key: 'old-paper', name: 'Old Paper', color: '#f4ecd8', border: '#fcd34d' },
          { key: 'dark', name: 'Dark Mode', color: '#18181b', border: '#38bdf8' },
          { key: 'soft-sepia', name: 'Soft Sepia', color: '#eee4cd', border: '#d97706' },
          { key: 'cool-mint', name: 'Cool Mint', color: '#e0f2fe', border: '#7dd3fc' }
        ];

        const textPresets = [
          { key: 'default', name: 'Original', color: 'transparent', border: '#475569' },
          { key: 'white', name: 'Pure White', color: '#ffffff', border: '#f8fafc' },
          { key: 'black', name: 'Deep Black', color: '#0f172a', border: '#0f172a' },
          { key: 'charcoal', name: 'Charcoal', color: '#334155', border: '#64748b' },
          { key: 'gray', name: 'Soft Gray', color: '#94a3b8', border: '#94a3b8' },
          { key: 'amber', name: 'Warm Cream', color: '#fef3c7', border: '#fde68a' }
        ];

        const presetsHtml = presets.map(p => `
          <button type="button" class="besing-preset-card besing-bg-preset-card ${curPreset === p.key ? 'active' : ''}" data-preset="${p.key}">
            <span class="besing-preset-swatch" style="background:${p.color};border-color:${p.border}"></span>
            <span class="besing-preset-label">${p.name}</span>
          </button>
        `).join('');

        const textPresetsHtml = textPresets.map(p => `
          <button type="button" class="besing-preset-card besing-text-preset-card ${curTextColor === p.key ? 'active' : ''}" data-text-color="${p.key}">
            <span class="besing-preset-swatch" style="background:${p.color};border-color:${p.border}"></span>
            <span class="besing-preset-label">${p.name}</span>
          </button>
        `).join('');

        let bLabel = '🎯 Normal (Original Site BG)';
        if (curBrightness < 0) bLabel = `☀️ Lighter (+${Math.abs(curBrightness)}%)`;
        else if (curBrightness > 0) bLabel = `🌙 Deep Dark (+${curBrightness}%)`;

        let curTextColorName = 'Original';
        if (curTextColor === 'custom') curTextColorName = `Custom (${customTextColor})`;
        else {
          const found = textPresets.find(p => p.key === curTextColor);
          if (found) curTextColorName = found.name;
        }

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Site BG Brightness Dragger</span>
              <span class="besing-brightness-badge" id="brightness-badge">${bLabel}</span>
            </div>
            <p style="font-size:10px;color:#94a3b8;line-height:1.35;margin-bottom:6px;">
              Adjusts brightness directly on top of the current website-set background (e.g. blue becomes light blue dragging left, deep navy and dark dragging right).
            </p>
            <div class="besing-brightness-labels">
              <span>☀️ Lighter (Drag Left)</span>
              <span>🌙 Deep / Dark (Drag Right)</span>
            </div>
            <input type="range" class="besing-slider-range brightness-range" id="brightness-range" min="-100" max="100" step="2" value="${curBrightness}">
            <div class="besing-range-ticks">
              <span>−100% (Light)</span>
              <span class="tick-center">0% (Normal)</span>
              <span>+100% (Dark)</span>
            </div>
          </div>

          <div class="besing-config-section" style="margin-top:10px;">
            <div class="besing-section-title">Background Tone Presets</div>
            <div class="besing-preset-grid">
              ${presetsHtml}
            </div>

            <div class="besing-custom-color-row">
              <label class="besing-custom-color-label">Custom Tone:</label>
              <input type="color" id="custom-color-picker" value="${customColor}">
              <input type="text" id="custom-color-hex" class="besing-input-sm" value="${customColor}">
              <button type="button" class="besing-btn-sub-action" id="btn-apply-custom-color">Apply Custom Tone</button>
            </div>
          </div>

          <div class="besing-config-section" style="margin-top:10px;">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Text Color Presets</span>
              <span class="besing-brightness-badge" id="text-color-badge">${curTextColorName}</span>
            </div>
            <p style="font-size:10px;color:#94a3b8;line-height:1.35;margin-bottom:6px;">
              Forces high-contrast text color across reading content, novel chapters, paragraphs, and headings to maintain clarity against custom background tones.
            </p>
            <div class="besing-preset-grid">
              ${textPresetsHtml}
            </div>

            <div class="besing-custom-color-row">
              <label class="besing-custom-color-label">Custom Text:</label>
              <input type="color" id="custom-text-color-picker" value="${customTextColor}">
              <input type="text" id="custom-text-color-hex" class="besing-input-sm" value="${customTextColor}">
              <button type="button" class="besing-btn-sub-action" id="btn-apply-custom-text">Apply Text Color</button>
            </div>

            <div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" class="besing-btn-sub-action" id="btn-reset-bg">Reset All Colors & Brightness</button>
            </div>
          </div>
        `;
      } else if (m.id === 'force-copy') {
        const allowSelect = cfg.allowSelect !== false;
        const allowCopy = cfg.allowCopy !== false;
        const allowPaste = cfg.allowPaste !== false;
        const allowContextMenu = cfg.allowContextMenu !== false;

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-unlocked-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <div>
                <div style="font-weight:700;color:#f1f5f9;font-size:12px;">Copy & Selection Shield Active</div>
                <div style="font-size:10px;color:#94a3b8;">CSS <code>user-select: none</code> restrictions and copy blocking event scripts are bypassed in capture phase.</div>
              </div>
            </div>

            <div class="besing-toggle-row-list" style="margin-top:12px;">
              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Force Allow Text Selection</div>
                  <div class="besing-toggle-desc">Overrides CSS <code>user-select: none</code> on all elements</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-select" ${allowSelect ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Force Allow Copy & Cut</div>
                  <div class="besing-toggle-desc">Bypasses Ctrl+C, Ctrl+X, and clipboard prevention listeners</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-copy" ${allowCopy ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Force Allow Paste</div>
                  <div class="besing-toggle-desc">Permits pasting into protected password & text inputs</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-paste" ${allowPaste ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Allow Right-Click Context Menu</div>
                  <div class="besing-toggle-desc">Bypasses right-click blocking event listeners</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-context" ${allowContextMenu ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>
            </div>

            <div class="besing-copy-test-box">
              <div style="font-size:11px;font-weight:600;color:#cbd5e1;margin-bottom:4px;">Selection & Copy Sandbox:</div>
              <div class="besing-test-text" id="besing-test-selection" style="user-select:text;-webkit-user-select:text;">
                ✨ Try selecting and copying this text (Ctrl+C), then paste below to verify!
              </div>
              <input type="text" class="besing-test-input" placeholder="Paste (Ctrl+V) copied text here to test...">
            </div>
          </div>
        `;
      } else if (m.id === 'ad-cleaner') {
        const enableAutoClean = cfg.enableAutoClean !== false;
        const blockedSelectors = Array.isArray(cfg.blockedSelectors) ? cfg.blockedSelectors : [];
        let blockedListHtml = '';
        if (blockedSelectors.length === 0) {
          blockedListHtml = `<div class="besing-zapped-empty">No custom elements zapped on this site yet.</div>`;
        } else {
          blockedListHtml = blockedSelectors.map((sel, idx) => `
            <div class="besing-zapped-item">
              <code class="besing-zapped-selector" title="${sel}">${sel}</code>
              <button type="button" class="besing-btn-restore-zapped" data-index="${idx}" title="Restore (unblock) this element">✕</button>
            </div>
          `).join('');
        }

        specificControls = `
          <div class="besing-config-section besing-zapper-hero-section">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;color:#f87171;display:flex;align-items:center;gap:6px;">
                <span>🎯</span> Interactive Element Zapper
              </span>
              <span class="besing-shortcut-badge" title="Global Shortcut: Press Alt + Z anywhere on the webpage">Alt + Z</span>
            </div>
            <p style="font-size:11px;color:#cbd5e1;line-height:1.4;margin:0;">
              Point and click on any annoying element, banner, or floating sidebar right on this webpage to zap and hide it permanently.
            </p>
            <button type="button" class="besing-btn-zapper-launch" id="btn-launch-zapper">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <span>Launch Element Zapper</span>
            </button>
          </div>

          <div class="besing-config-section">
            <div class="besing-toggle-row">
              <div>
                <div class="besing-toggle-title">Auto-Clean Cookie & Popup Overlays</div>
                <div class="besing-toggle-desc">Automatically blocks generic consent banners, modals, and newsletter overlays</div>
              </div>
              <label class="besing-switch besing-switch-sm">
                <input type="checkbox" id="chk-auto-clean" ${enableAutoClean ? 'checked' : ''}>
                <span class="besing-slider"></span>
              </label>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row" style="margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#cbd5e1;">Zapped Elements on this Website (${blockedSelectors.length})</span>
              ${blockedSelectors.length > 0 ? '<button type="button" class="besing-btn-sub-action" id="btn-clear-zapped" style="color:#f87171;">Clear All</button>' : ''}
            </div>
            <div class="besing-zapped-list">
              ${blockedListHtml}
            </div>
          </div>
        `;
      } else if (m.id === 'pagestream') {
        const whenToLoad = cfg.whenToLoad || 'bottom';
        const preloadPages = cfg.preloadPages !== undefined ? Number(cfg.preloadPages) : 1;
        const enableHistory = cfg.enableHistory !== false;
        const streamMode = cfg.mode || 'auto';
        const customNextSelector = cfg.customNextSelector || '';
        const customPageSelector = cfg.customPageSelector || '';

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">When to Load Next Page</span>
              <span class="besing-shortcut-badge" id="badge-when-load">${whenToLoad === 'start' ? 'Start (15%)' : (whenToLoad === 'half point' ? 'Half Point (50%)' : 'Bottom (90%)')}</span>
            </div>
            <div class="besing-segmented-group" id="group-when-load" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${whenToLoad === 'start' ? 'active' : ''}" data-when="start">Start</button>
              <button type="button" class="besing-segmented-btn ${whenToLoad === 'half point' ? 'active' : ''}" data-when="half point">Half Point (50%)</button>
              <button type="button" class="besing-segmented-btn ${whenToLoad === 'bottom' ? 'active' : ''}" data-when="bottom">Bottom (90%)</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.3;">
              Controls scroll trigger threshold. Bottom triggers at 90% mark to avoid reading stall before the page end.
            </p>
          </div>

          <div class="besing-config-section">
            <div class="besing-toggle-row">
              <div>
                <div class="besing-toggle-title">Preload Next Pages</div>
                <div class="besing-toggle-desc">Fetches upcoming page in background for zero-lag instant splicing</div>
              </div>
              <div class="besing-stepper-row">
                <button type="button" class="besing-stepper-btn" id="btn-preload-minus">−</button>
                <span class="besing-stepper-val" id="val-preload-pages">${preloadPages}</span>
                <button type="button" class="besing-stepper-btn" id="btn-preload-plus">+</button>
              </div>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-toggle-row">
              <div>
                <div class="besing-toggle-title">Browser History Sync</div>
                <div class="besing-toggle-desc">Pushes visited pages into history & updates address bar URL while scrolling</div>
              </div>
              <label class="besing-switch besing-switch-sm">
                <input type="checkbox" id="chk-stream-history" ${enableHistory ? 'checked' : ''}>
                <span class="besing-slider"></span>
              </label>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Streaming Engine Mode</span>
            </div>
            <div class="besing-segmented-group" id="group-stream-mode" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${streamMode === 'auto' ? 'active' : ''}" data-mode="auto">Smart Auto</button>
              <button type="button" class="besing-segmented-btn ${streamMode === 'splice' ? 'active' : ''}" data-mode="splice">Fetch & Splice</button>
              <button type="button" class="besing-segmented-btn ${streamMode === 'click' ? 'active' : ''}" data-mode="click">Auto Click</button>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row" style="margin-bottom:6px;">
              <span class="besing-section-title">Custom Selector Overrides</span>
              <span style="font-size:10px;color:#64748b;">Optional</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <input type="text" class="besing-test-input" id="input-custom-next" placeholder="Next link selector (e.g. a.next, #next_page)" value="${customNextSelector}">
              <input type="text" class="besing-test-input" id="input-custom-page" placeholder="Content container selector (e.g. #content, article)" value="${customPageSelector}">
              <button type="button" class="besing-btn-sub-action" id="btn-save-selectors" style="align-self:flex-end;">Save Custom Selectors</button>
            </div>
          </div>
        `;
      } else if (m.id === 'rest-reminder') {
        const intervalMinutes = cfg.intervalMinutes !== undefined ? Number(cfg.intervalMinutes) : 20;
        const activePreset = cfg.activePreset || (intervalMinutes === 20 ? '20' : (intervalMinutes === 45 ? '45' : (intervalMinutes === 60 ? '60' : 'custom')));
        const customMinutes = cfg.customMinutes !== undefined ? Number(cfg.customMinutes) : 30;

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Reminder Interval</span>
              <span class="besing-shortcut-badge" id="badge-reminder-interval">${intervalMinutes} min</span>
            </div>
            <div class="besing-segmented-group" id="group-reminder-preset" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${activePreset === '20' ? 'active' : ''}" data-preset="20">20m (Default)</button>
              <button type="button" class="besing-segmented-btn ${activePreset === '45' ? 'active' : ''}" data-preset="45">45m</button>
              <button type="button" class="besing-segmented-btn ${activePreset === '60' ? 'active' : ''}" data-preset="60">60m</button>
              <button type="button" class="besing-segmented-btn ${activePreset === 'custom' ? 'active' : ''}" data-preset="custom">Custom</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.3;">
              When the time is up, a chat bubble pops up on the icon with Repeat and Off buttons. It remains until you choose an action.
            </p>
          </div>

          <div class="besing-config-section" id="section-custom-minutes" style="${activePreset === 'custom' ? 'display:block;' : 'display:none;'}">
            <div class="besing-toggle-row">
              <div>
                <div class="besing-toggle-title">Custom Duration (Minutes)</div>
                <div class="besing-toggle-desc">Set repeating rest interval (1–240 minutes)</div>
              </div>
              <div class="besing-stepper-row">
                <button type="button" class="besing-stepper-btn" id="btn-custom-minus">−</button>
                <input type="number" class="besing-test-input" id="input-custom-min" min="1" max="240" value="${customMinutes}" style="width:58px;padding:3px 6px;text-align:center;font-weight:700;font-family:monospace;color:#38bdf8;">
                <button type="button" class="besing-stepper-btn" id="btn-custom-plus">+</button>
              </div>
            </div>
          </div>

          <div class="besing-config-section">
            <button type="button" class="besing-btn-zapper-launch" id="btn-test-reminder" style="background:linear-gradient(135deg, rgba(56,189,248,0.2), rgba(99,102,241,0.25));border-color:rgba(56,189,248,0.4);color:#38bdf8;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>Test Chat Bubble Now</span>
            </button>
          </div>
        `;
      } else {
        specificControls = `
          <div class="besing-config-section">
            <p style="font-size:11px;color:#94a3b8;line-height:1.4;">${m.description || 'No additional custom options for this script.'}</p>
            <div style="margin-top:12px;font-size:10px;color:#64748b;">
              Author: ${m.author || 'BESing Team'} | Category: ${m.category || 'General'}
            </div>
          </div>
        `;
      }

      let triButtonsHtml = '';
      if (isGloballyOn) {
        triButtonsHtml = `
          <button type="button" class="besing-tri-btn ${currentMode === 'off' ? 'active active-off' : ''}" data-mode="off" title="Turn OFF globally on all sites">OFF (ALL)</button>
          <button type="button" class="besing-tri-btn ${currentMode === 'site-off' ? 'active active-site-off' : ''}" data-mode="site-off" title="Disable only on ${currentHost}">OFF (SITE)</button>
          <button type="button" class="besing-tri-btn ${currentMode === 'on' ? 'active active-on' : ''}" data-mode="on" title="Active on all sites">ON (GLOBAL)</button>
        `;
      } else {
        triButtonsHtml = `
          <button type="button" class="besing-tri-btn ${currentMode === 'off' ? 'active active-off' : ''}" data-mode="off" title="Turn OFF completely">OFF</button>
          <button type="button" class="besing-tri-btn ${currentMode === 'site' ? 'active active-site' : ''}" data-mode="site" title="Active only on ${currentHost}">SITE ONLY</button>
          <button type="button" class="besing-tri-btn ${currentMode === 'on' ? 'active active-on' : ''}" data-mode="on" title="Turn ON globally across all sites">ON (GLOBAL)</button>
        `;
      }

      this.setSafeHTML(body, `
        <div class="besing-secondary-header">
          <div class="besing-secondary-top-bar">
            <button type="button" class="besing-btn-back" id="besing-btn-back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              <span>All Scripts</span>
            </button>
            <div class="besing-tri-toggle" title="Status on ${currentHost}">
              ${triButtonsHtml}
            </div>
          </div>
          <div class="besing-secondary-title-group">
            <div class="besing-ext-icon sm">${m.icon || ''}</div>
            <div class="besing-secondary-meta">
              <span class="besing-secondary-title">${m.name}</span>
              <span class="besing-ext-ver" style="font-size:10px;color:#94a3b8;">v${m.version || '1.0.0'} • ${m.category || 'General'}</span>
            </div>
          </div>
        </div>

        ${scopeNotice}

        <div class="besing-secondary-content" style="display:flex;flex-direction:column;gap:10px;">
          ${specificControls}
        </div>
      `);

      // Bind Back Button
      const btnBack = body.querySelector('#besing-btn-back');
      if (btnBack) {
        btnBack.onclick = () => {
          this.currentView = 'extensions';
          this.renderBody();
        };
      }

      // Bind Tri-Toggle in Secondary Menu
      const btnOff = body.querySelector('[data-mode="off"]');
      const btnSite = body.querySelector('[data-mode="site"]');
      const btnSiteOff = body.querySelector('[data-mode="site-off"]');
      const btnOn = body.querySelector('[data-mode="on"]');

      const handleModeChange = async (newMode) => {
        await this.storage.setScriptMode(m.id, newMode, currentHost);
        this.refreshCurrentSiteModules();
        this.renderBody();
      };

      if (btnOff) btnOff.onclick = (e) => { e.stopPropagation(); handleModeChange('off'); };
      if (btnSite) btnSite.onclick = (e) => { e.stopPropagation(); handleModeChange('site'); };
      if (btnSiteOff) btnSiteOff.onclick = (e) => { e.stopPropagation(); handleModeChange('site-off'); };
      if (btnOn) btnOn.onclick = (e) => { e.stopPropagation(); handleModeChange('on'); };

      // Bind Handlers
      if (m.id === 'text-size-control') {
        const zoomVal = body.querySelector('#besing-zoom-val');
        const zoomRange = body.querySelector('#zoom-range');
        const btnMinus = body.querySelector('#btn-zoom-minus');
        const btnPlus = body.querySelector('#btn-zoom-plus');
        const btnReset = body.querySelector('#btn-reset-zoom');

        const updateZoom = async (val) => {
          const clamped = Math.max(80, Math.min(350, Math.round(val)));
          if (zoomVal) zoomVal.textContent = `${clamped}%`;
          if (zoomRange) zoomRange.value = clamped;
          body.querySelectorAll('.besing-zoom-pill').forEach(btn => {
            btn.classList.toggle('active', Number(btn.getAttribute('data-zoom')) === clamped);
          });
          await this.applyScriptConfig(m.id, { fontSizePercent: clamped });
        };

        if (zoomRange) {
          zoomRange.oninput = (e) => updateZoom(e.target.value);
        }
        if (btnMinus) {
          btnMinus.onclick = () => updateZoom(Number(zoomRange.value) - 10);
        }
        if (btnPlus) {
          btnPlus.onclick = () => updateZoom(Number(zoomRange.value) + 10);
        }
        if (btnReset) {
          btnReset.onclick = () => updateZoom(100);
        }
        body.querySelectorAll('.besing-zoom-pill').forEach(btn => {
          btn.onclick = () => updateZoom(Number(btn.getAttribute('data-zoom')));
        });

        const groupTextMode = body.querySelector('#group-text-size-mode');
        if (groupTextMode) {
          groupTextMode.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              const modeVal = btn.getAttribute('data-mode');
              groupTextMode.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              await this.applyScriptConfig(m.id, { mode: modeVal });
            };
          });
        }
      } else if (m.id === 'color-change') {
        const bRange = body.querySelector('#brightness-range');
        const bBadge = body.querySelector('#brightness-badge');
        const customPicker = body.querySelector('#custom-color-picker');
        const customHex = body.querySelector('#custom-color-hex');
        const btnApplyCustom = body.querySelector('#btn-apply-custom-color');
        const tBadge = body.querySelector('#text-color-badge');
        const customTextPicker = body.querySelector('#custom-text-color-picker');
        const customTextHex = body.querySelector('#custom-text-color-hex');
        const btnApplyCustomText = body.querySelector('#btn-apply-custom-text');
        const btnResetBg = body.querySelector('#btn-reset-bg');

        const updateBrightness = async (val) => {
          const b = Number(val);
          if (bBadge) {
            if (b < 0) bBadge.textContent = `☀️ Lighter (+${Math.abs(b)}%)`;
            else if (b > 0) bBadge.textContent = `🌙 Deep Dark (+${b}%)`;
            else bBadge.textContent = '🎯 Normal (Original BG)';
          }
          await this.applyScriptConfig(m.id, { brightness: b });
        };

        if (bRange) {
          bRange.oninput = (e) => updateBrightness(e.target.value);
        }

        body.querySelectorAll('.besing-bg-preset-card').forEach(card => {
          card.onclick = async () => {
            const pKey = card.getAttribute('data-preset');
            body.querySelectorAll('.besing-bg-preset-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            await this.applyScriptConfig(m.id, { preset: pKey });
          };
        });

        if (customPicker && customHex) {
          customPicker.oninput = (e) => {
            customHex.value = e.target.value;
          };
          if (btnApplyCustom) {
            btnApplyCustom.onclick = async () => {
              const col = customHex.value.trim() || '#cce8cf';
              body.querySelectorAll('.besing-bg-preset-card').forEach(c => c.classList.remove('active'));
              await this.applyScriptConfig(m.id, { preset: 'custom', customColor: col });
            };
          }
        }

        body.querySelectorAll('.besing-text-preset-card').forEach(card => {
          card.onclick = async () => {
            const tKey = card.getAttribute('data-text-color');
            body.querySelectorAll('.besing-text-preset-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            if (tBadge) {
              const names = { default: 'Original', white: 'Pure White', black: 'Deep Black', charcoal: 'Charcoal', gray: 'Soft Gray', amber: 'Warm Cream' };
              tBadge.textContent = names[tKey] || tKey;
            }
            await this.applyScriptConfig(m.id, { textColor: tKey });
          };
        });

        if (customTextPicker && customTextHex) {
          customTextPicker.oninput = (e) => {
            customTextHex.value = e.target.value;
          };
          if (btnApplyCustomText) {
            btnApplyCustomText.onclick = async () => {
              const col = customTextHex.value.trim() || '#ffffff';
              body.querySelectorAll('.besing-text-preset-card').forEach(c => c.classList.remove('active'));
              if (tBadge) tBadge.textContent = `Custom (${col})`;
              await this.applyScriptConfig(m.id, { textColor: 'custom', customTextColor: col });
            };
          }
        }

        if (btnResetBg) {
          btnResetBg.onclick = async () => {
            if (bRange) bRange.value = 0;
            updateBrightness(0);
            body.querySelectorAll('.besing-bg-preset-card').forEach(c => {
              c.classList.toggle('active', c.getAttribute('data-preset') === 'none');
            });
            body.querySelectorAll('.besing-text-preset-card').forEach(c => {
              c.classList.toggle('active', c.getAttribute('data-text-color') === 'default');
            });
            if (tBadge) tBadge.textContent = 'Original';
            await this.applyScriptConfig(m.id, { brightness: 0, preset: 'none', textColor: 'default' });
          };
        }
      } else if (m.id === 'force-copy') {
        const chkSelect = body.querySelector('#chk-allow-select');
        const chkCopy = body.querySelector('#chk-allow-copy');
        const chkPaste = body.querySelector('#chk-allow-paste');
        const chkContext = body.querySelector('#chk-allow-context');

        const saveForceCopy = async () => {
          await this.applyScriptConfig(m.id, {
            allowSelect: !!(chkSelect && chkSelect.checked),
            allowCopy: !!(chkCopy && chkCopy.checked),
            allowPaste: !!(chkPaste && chkPaste.checked),
            allowContextMenu: !!(chkContext && chkContext.checked)
          });
        };

        if (chkSelect) chkSelect.onchange = saveForceCopy;
        if (chkCopy) chkCopy.onchange = saveForceCopy;
        if (chkPaste) chkPaste.onchange = saveForceCopy;
        if (chkContext) chkContext.onchange = saveForceCopy;
      } else if (m.id === 'ad-cleaner') {
        const btnLaunch = body.querySelector('#btn-launch-zapper');
        const chkAutoClean = body.querySelector('#chk-auto-clean');
        const btnClearAll = body.querySelector('#btn-clear-zapped');

        if (btnLaunch) {
          btnLaunch.onclick = () => {
            this.closeModal();
            const currentHost = this.storage.getCurrentHost();
            const currentCfg = this.storage.getScriptConfig(m.id, currentHost);
            if (typeof m.init === 'function' && !m.running) {
              m.init(currentCfg);
              m.running = true;
            }
            if (typeof m.startZapper === 'function') {
              m.startZapper(async (sel, currentList) => {
                await this.applyScriptConfig(m.id, { blockedSelectors: currentList });
              });
            }
          };
        }

        if (chkAutoClean) {
          chkAutoClean.onchange = async () => {
            await this.applyScriptConfig(m.id, { enableAutoClean: chkAutoClean.checked });
          };
        }

        if (btnClearAll) {
          btnClearAll.onclick = async () => {
            await this.applyScriptConfig(m.id, { blockedSelectors: [] });
            this.renderBody();
          };
        }

        body.querySelectorAll('.besing-btn-restore-zapped').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-index'));
            const currentHost = this.storage.getCurrentHost();
            const currentCfg = this.storage.getScriptConfig(m.id, currentHost);
            const list = Array.isArray(currentCfg.blockedSelectors) ? [...currentCfg.blockedSelectors] : [];
            if (idx >= 0 && idx < list.length) {
              list.splice(idx, 1);
              await this.applyScriptConfig(m.id, { blockedSelectors: list });
              this.renderBody();
            }
          };
        });
      } else if (m.id === 'pagestream') {
        // "When to load" 3-state buttons
        const groupWhen = body.querySelector('#group-when-load');
        const badgeWhen = body.querySelector('#badge-when-load');
        if (groupWhen) {
          groupWhen.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              const whenVal = btn.getAttribute('data-when');
              groupWhen.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (badgeWhen) {
                badgeWhen.textContent = whenVal === 'start' ? 'Start (15%)' : (whenVal === 'half point' ? 'Half Point (50%)' : 'Bottom (90%)');
              }
              await this.applyScriptConfig(m.id, { whenToLoad: whenVal });
            };
          });
        }

        // Preload stepper
        const btnPreMinus = body.querySelector('#btn-preload-minus');
        const btnPrePlus = body.querySelector('#btn-preload-plus');
        const valPreload = body.querySelector('#val-preload-pages');
        const updatePreload = async (newVal) => {
          const clamped = Math.max(0, Math.min(5, newVal));
          if (valPreload) valPreload.textContent = clamped;
          await this.applyScriptConfig(m.id, { preloadPages: clamped });
        };
        if (btnPreMinus && valPreload) {
          btnPreMinus.onclick = () => updatePreload(Number(valPreload.textContent) - 1);
        }
        if (btnPrePlus && valPreload) {
          btnPrePlus.onclick = () => updatePreload(Number(valPreload.textContent) + 1);
        }

        // History sync checkbox
        const chkHistory = body.querySelector('#chk-stream-history');
        if (chkHistory) {
          chkHistory.onchange = async () => {
            await this.applyScriptConfig(m.id, { enableHistory: chkHistory.checked });
          };
        }

        // Streaming mode buttons
        const groupMode = body.querySelector('#group-stream-mode');
        if (groupMode) {
          groupMode.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              const modeVal = btn.getAttribute('data-mode');
              groupMode.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              await this.applyScriptConfig(m.id, { mode: modeVal });
            };
          });
        }

        // Custom selectors
        const btnSaveSelectors = body.querySelector('#btn-save-selectors');
        const inNext = body.querySelector('#input-custom-next');
        const inPage = body.querySelector('#input-custom-page');
        if (btnSaveSelectors && inNext && inPage) {
          btnSaveSelectors.onclick = async () => {
            await this.applyScriptConfig(m.id, {
              customNextSelector: inNext.value.trim(),
              customPageSelector: inPage.value.trim()
            });
            btnSaveSelectors.textContent = 'Saved!';
            setTimeout(() => { btnSaveSelectors.textContent = 'Save Custom Selectors'; }, 1500);
          };
        }
      } else if (m.id === 'rest-reminder') {
        const groupPreset = body.querySelector('#group-reminder-preset');
        const badgeInterval = body.querySelector('#badge-reminder-interval');
        const secCustom = body.querySelector('#section-custom-minutes');
        const inCustomMin = body.querySelector('#input-custom-min');
        const btnMinus = body.querySelector('#btn-custom-minus');
        const btnPlus = body.querySelector('#btn-custom-plus');
        const btnTest = body.querySelector('#btn-test-reminder');

        const updateInterval = async (preset, minutes) => {
          const clamped = Math.max(1, Math.min(240, Number(minutes) || 20));
          if (badgeInterval) badgeInterval.textContent = `${clamped} min`;
          if (inCustomMin && preset === 'custom') inCustomMin.value = clamped;
          if (secCustom) secCustom.style.display = preset === 'custom' ? 'block' : 'none';

          await this.applyScriptConfig(m.id, {
            activePreset: preset,
            intervalMinutes: clamped,
            customMinutes: preset === 'custom' ? clamped : (Number(inCustomMin?.value) || 30)
          });
        };

        if (groupPreset) {
          groupPreset.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              const pVal = btn.getAttribute('data-preset');
              groupPreset.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (pVal === 'custom') {
                const custVal = Number(inCustomMin?.value) || 30;
                await updateInterval('custom', custVal);
              } else {
                await updateInterval(pVal, Number(pVal));
              }
            };
          });
        }

        if (btnMinus && inCustomMin) {
          btnMinus.onclick = async () => {
            const nextVal = Math.max(1, (Number(inCustomMin.value) || 30) - 5);
            inCustomMin.value = nextVal;
            await updateInterval('custom', nextVal);
          };
        }

        if (btnPlus && inCustomMin) {
          btnPlus.onclick = async () => {
            const nextVal = Math.min(240, (Number(inCustomMin.value) || 30) + 5);
            inCustomMin.value = nextVal;
            await updateInterval('custom', nextVal);
          };
        }

        if (inCustomMin) {
          inCustomMin.onchange = async () => {
            const val = Math.max(1, Math.min(240, Number(inCustomMin.value) || 20));
            inCustomMin.value = val;
            await updateInterval('custom', val);
          };
        }

        if (btnTest) {
          btnTest.onclick = () => {
            this.closeModal();
            if (typeof m.showReminderChatBox === 'function') {
              m.showReminderChatBox();
            }
          };
        }
      }
    }

    closeModal() {
      if (this.outsideClickHandler) {
        document.removeEventListener('click', this.outsideClickHandler, true);
        document.removeEventListener('click', this.outsideClickHandler, false);
        this.outsideClickHandler = null;
      }
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
        :host { all: initial; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; overflow: visible !important; display: block !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }
        *, *::before, *::after { box-sizing: border-box !important; margin: 0; padding: 0; }
        svg { display: block !important; overflow: visible !important; flex-shrink: 0 !important; }
        svg:not(:root) { overflow: visible !important; }
        .besing-trigger { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483647; pointer-events: auto; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }
        .besing-trigger:hover { transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); }
        .besing-trigger:active { cursor: grabbing; transform: scale(0.95); }
        .besing-trigger.folded-left { transform: translateX(-24px) !important; opacity: 0.88; }
        .besing-trigger.folded-right { transform: translateX(24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top { transform: translateY(-24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom { transform: translateY(24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top.folded-left { transform: translate(-24px, -24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top.folded-right { transform: translate(24px, -24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom.folded-left { transform: translate(-24px, 24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom.folded-right { transform: translate(24px, 24px) !important; opacity: 0.88; }
        .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover { transform: translate(0, 0) scale(1.08) !important; opacity: 1 !important; }
        .besing-trigger.folded-right::before { content: ""; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-left::after { content: ""; position: absolute; right: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-top:not(.folded-right)::before, .besing-trigger.folded-top.folded-right::after { content: ""; position: absolute; bottom: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.folded-bottom:not(.folded-left)::after, .besing-trigger.folded-bottom.folded-left::before { content: ""; position: absolute; top: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }
        .besing-trigger.redirect-alert { border-color: #ef4444 !important; box-shadow: 0 0 20px rgba(239, 68, 68, 0.9), 0 0 35px rgba(239, 68, 68, 0.6) !important; }
        .besing-trigger.redirect-alert::before, .besing-trigger.redirect-alert::after { background: #ef4444 !important; box-shadow: 0 0 16px #ef4444, 0 0 26px #ef4444 !important; animation: besingBarBlink 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite !important; }
        @keyframes besingBarBlink { 0%, 100% { opacity: 1; transform: scale(1.15); } 50% { opacity: 0.15; transform: scale(0.85); } }
        .besing-trigger.besing-pulse-alert { border-color: #38bdf8 !important; box-shadow: 0 0 25px rgba(56, 189, 248, 1), 0 0 50px rgba(99, 102, 241, 0.8) !important; animation: besingPulsePop 0.6s cubic-bezier(0.16, 1, 0.3, 1) 3 !important; }
        @keyframes besingPulsePop { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.35); } }
        .besing-badge-count { position: absolute; top: -2px; right: -2px; background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; font-size: 10px; font-weight: 700; height: 18px; min-width: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 2px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
        .besing-pet-eye { transform-origin: center; animation: petBlink 4.5s infinite; }
        .besing-pet-face:hover .besing-pet-eye { animation: none; transform: scaleY(0.2) translateY(1px); }
        @keyframes petBlink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
        .besing-bubble-wrapper { position: fixed; z-index: 2147483647; pointer-events: auto; animation: besingBubblePop 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-arrow { position: absolute; width: 14px; height: 14px; background: #0d1322; border: 1px solid rgba(255, 255, 255, 0.14); transform: rotate(45deg); z-index: 2; }
        .besing-bubble-arrow.arrow-bottom { bottom: -7px; border-top: none; border-left: none; }
        .besing-bubble-arrow.arrow-top { top: -7px; border-bottom: none; border-right: none; }
        .besing-bubble-panel { width: 390px !important; min-width: 360px !important; max-width: calc(100vw - 28px) !important; min-height: 380px !important; max-height: 520px !important; background: linear-gradient(180deg, rgba(16, 23, 38, 0.98) 0%, rgba(9, 13, 22, 0.99) 100%) !important; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.13) !important; border-radius: 18px !important; box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.75), 0 0 30px rgba(99, 102, 241, 0.16) !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; color: #e2e8f0 !important; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-panel.is-expanded { width: 540px !important; min-height: 500px !important; max-height: 80vh !important; }
        .besing-header { min-height: 54px !important; height: 54px !important; padding: 14px 18px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important; background: rgba(255, 255, 255, 0.02) !important; flex-shrink: 0 !important; }
        .besing-logo-group { display: flex !important; align-items: center !important; gap: 10px !important; flex-shrink: 0 !important; }
        .besing-logo-icon { width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; border-radius: 8px !important; background: linear-gradient(135deg, #6366f1, #3b82f6) !important; display: flex !important; align-items: center !important; justify-content: center !important; color: #ffffff !important; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4) !important; flex-shrink: 0 !important; }
        .besing-title { font-size: 14px; font-weight: 700; color: #f8fafc; }
        .besing-tag { font-size: 10px; font-weight: 600; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.3); }
        .besing-header-actions { display: flex !important; align-items: center !important; gap: 6px !important; flex-shrink: 0 !important; }
        .besing-btn-icon { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-icon:hover { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.2); color: #ffffff; transform: translateY(-1px); }
        .besing-btn-icon.active { background: rgba(99, 102, 241, 0.35); border-color: rgba(129, 140, 248, 0.5); color: #c7d2fe; }
        .besing-body { padding: 14px 18px !important; overflow-y: auto !important; flex: 1 1 auto !important; min-height: 280px !important; display: flex !important; flex-direction: column !important; gap: 12px !important; }
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
        .besing-rotator-toggle { position: relative; width: 62px; height: 24px; border-radius: 12px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; outline: none; transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); flex-shrink: 0; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4); }
        .besing-rotator-toggle:hover { filter: brightness(1.1); transform: scale(1.02); }
        .besing-rotator-toggle.mode-off { background-color: #334155; }
        .besing-rotator-toggle.mode-off .besing-rotator-knob { position: absolute; left: 3px; width: 18px; height: 18px; border-radius: 50%; background-color: #ffffff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-rotator-toggle.mode-off .besing-rotator-text { display: none; }
        .besing-rotator-toggle.mode-on { background-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35), inset 0 1px 2px rgba(0, 0, 0, 0.2); }
        .besing-rotator-toggle.mode-on .besing-rotator-knob { position: absolute; left: 3px; transform: translateX(38px); width: 18px; height: 18px; border-radius: 50%; background-color: #ffffff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-rotator-toggle.mode-on .besing-rotator-text { display: none; }
        .besing-rotator-toggle.mode-site { background: linear-gradient(135deg, #0284c7, #2563eb); box-shadow: 0 0 10px rgba(56, 189, 248, 0.35), inset 0 1px 2px rgba(0, 0, 0, 0.2); }
        .besing-rotator-toggle.mode-site .besing-rotator-knob { display: none; }
        .besing-rotator-toggle.mode-site .besing-rotator-text { display: block; color: #ffffff; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; user-select: none; pointer-events: none; }
        .besing-site-card { background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-site-card-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-current-domain { font-size: 12px; font-weight: 600; color: #38bdf8; font-family: monospace; }
        .besing-site-rules-wrap { display: flex; flex-direction: column; gap: 8px; }
        .besing-site-rules-list { display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; }
        .besing-site-group { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; overflow: hidden; }
        .besing-site-group-header { padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; transition: background 0.15s ease; }
        .besing-site-group-header:hover { background: rgba(255, 255, 255, 0.06); }
        .besing-site-chevron { transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); color: #94a3b8; flex-shrink: 0; }
        .besing-site-group.collapsed .besing-site-chevron { transform: rotate(-90deg); }
        .besing-site-group.collapsed .besing-site-subrules { display: none; }
        .besing-site-group.collapsed .besing-site-group-header { border-bottom: none; }
        .besing-site-rule-count { font-size: 10px; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 6px; border-radius: 999px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .besing-site-group-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #f1f5f9; font-family: monospace; }
        .besing-btn-del-site { background: transparent; border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 5px; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-del-site:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }
        .besing-site-subrules { display: flex; flex-direction: column; padding: 4px 10px; }
        .besing-site-rule-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
        .besing-site-rule-row:last-child { border-bottom: none; }
        .besing-site-rule-info { display: flex; align-items: center; gap: 6px; }
        .besing-site-rule-name { font-size: 11px; font-weight: 500; color: #e2e8f0; }
        .besing-site-rule-tag { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px; }
        .besing-site-rule-actions { display: flex; align-items: center; gap: 6px; }
        .besing-switch-sm { width: 32px; height: 18px; }
        .besing-switch-sm .besing-slider::before { height: 12px; width: 12px; left: 3px; bottom: 3px; }
        .besing-switch-sm input:checked + .besing-slider::before { transform: translateX(14px); }
        .besing-rule-remove { background: transparent; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 2px 5px; border-radius: 4px; transition: all 0.15s ease; }
        .besing-rule-remove:hover { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        .besing-blocklist-header { display: flex; align-items: center; justify-content: space-between; }
        .besing-blocklist-title { font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; }
        .besing-blocklist-count { font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.05); padding: 2px 6px; border-radius: 10px; }
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
        .besing-btn-script-gear { background: transparent; border: none; color: #64748b; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-script-gear:hover { background: rgba(255, 255, 255, 0.08); color: #cbd5e1; transform: rotate(30deg); }
        .besing-secondary-header { display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
        .besing-secondary-top-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
        .besing-btn-back { display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #cbd5e1; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-back:hover { background: rgba(99, 102, 241, 0.2); border-color: #818cf8; color: #fff; }
        .besing-tri-toggle { display: inline-flex; align-items: center; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 2px; gap: 2px; }
        .besing-tri-btn { background: transparent; border: 1px solid transparent; color: #94a3b8; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; line-height: 1.2; }
        .besing-tri-btn:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.06); }
        .besing-tri-btn.active.active-off { background: rgba(100, 116, 139, 0.35); color: #f1f5f9; font-weight: 700; border-color: rgba(148, 163, 184, 0.3); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
        .besing-tri-btn.active.active-site { background: rgba(56, 189, 248, 0.22); color: #38bdf8; border-color: rgba(56, 189, 248, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(56, 189, 248, 0.25); }
        .besing-tri-btn.active.active-site-off { background: rgba(245, 158, 11, 0.22); color: #fbbf24; border-color: rgba(245, 158, 11, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(245, 158, 11, 0.25); }
        .besing-tri-btn.active.active-on { background: rgba(16, 185, 129, 0.22); color: #34d399; border-color: rgba(16, 185, 129, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(16, 185, 129, 0.25); }
        .besing-secondary-title-group { display: flex; align-items: center; gap: 10px; width: 100%; }
        .besing-ext-icon.sm { width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }
        .besing-secondary-meta { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
        .besing-secondary-title { font-size: 13px; font-weight: 700; color: #f8fafc; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
        .besing-config-scope { font-size: 11px; line-height: 1.4; padding: 8px 10px; border-radius: 8px; display: flex; align-items: flex-start; gap: 8px; }
        .besing-config-scope.site { background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); color: #7dd3fc; }
        .besing-config-scope.global { background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); color: #6ee7b7; }
        .besing-config-scope.off { background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.1); color: #94a3b8; }
        .besing-config-section { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .besing-section-header-row { display: flex; align-items: center; justify-content: space-between; }
        .besing-brightness-badge { font-size: 10px; font-weight: 700; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 2px 7px; border-radius: 10px; border: 1px solid rgba(99, 102, 241, 0.3); }
        .besing-zoom-hero { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 10px; background: rgba(15, 23, 42, 0.55); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06); }
        .besing-zoom-val { font-size: 32px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; text-shadow: 0 0 16px rgba(56, 189, 248, 0.4); }
        .besing-zoom-desc { font-size: 10px; color: #64748b; }
        .besing-zoom-slider-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .besing-stepper-btn { width: 28px; height: 28px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #f1f5f9; font-size: 16px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
        .besing-stepper-btn:hover { background: rgba(99, 102, 241, 0.3); border-color: #818cf8; }
        .besing-slider-range { flex: 1; accent-color: #38bdf8; cursor: pointer; height: 6px; border-radius: 3px; }
        .besing-slider-range.brightness-range { accent-color: #a78bfa; }
        .besing-preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .besing-zoom-pill { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; }
        .besing-zoom-pill:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
        .besing-zoom-pill.active { background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; box-shadow: 0 0 8px rgba(56, 189, 248, 0.3); }
        .besing-brightness-labels { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
        .besing-range-ticks { display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-top: -2px; }
        .besing-preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .besing-preset-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 6px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.15s ease; color: #cbd5e1; }
        .besing-preset-card:hover { background: rgba(255, 255, 255, 0.07); }
        .besing-preset-card.active { background: rgba(99, 102, 241, 0.18); border-color: #818cf8; color: #fff; }
        .besing-preset-swatch { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid rgba(255, 255, 255, 0.2); flex-shrink: 0; }
        .besing-preset-label { font-size: 10px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .besing-custom-color-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
        .besing-custom-color-label { font-size: 10px; color: #94a3b8; }
        .besing-input-sm { background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; border-radius: 6px; padding: 3px 6px; font-size: 11px; font-family: monospace; width: 65px; }
        .besing-btn-sub-action { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-sub-action:hover { background: rgba(255, 255, 255, 0.09); color: #f1f5f9; }
        .besing-unlocked-banner { display: flex; align-items: center; gap: 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 10px; }
        .besing-toggle-row-list { display: flex; flex-direction: column; gap: 8px; }
        .besing-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
        .besing-toggle-row:last-child { border-bottom: none; }
        .besing-toggle-title { font-size: 11px; font-weight: 600; color: #f1f5f9; }
        .besing-toggle-desc { font-size: 10px; color: #64748b; }
        .besing-copy-test-box { margin-top: 10px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px; }
        .besing-test-text { background: rgba(255, 255, 255, 0.04); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #38bdf8; margin-bottom: 6px; }
        .besing-test-input { width: 100%; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #f1f5f9; outline: none; }
        .besing-test-input:focus { border-color: #10b981; }
        .besing-site-override-pill { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 6px; border-radius: 9999px; cursor: pointer; transition: all 0.15s ease; }
        .besing-site-override-pill:hover { background: rgba(56, 189, 248, 0.22); border-color: #38bdf8; color: #fff; }
        .besing-rotator-toggle.mode-site-off { background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24; }
        .besing-rotator-toggle.mode-site-off .besing-rotator-knob { left: 20px; background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }
        .besing-rotator-toggle.mode-site-off:hover { border-color: #f59e0b; }
        .besing-config-scope.site-off { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); color: #fcd34d; }
        .besing-tri-btn.active.active-site-off { background: rgba(245, 158, 11, 0.25); color: #fbbf24; border-color: rgba(245, 158, 11, 0.5); box-shadow: 0 0 8px rgba(245, 158, 11, 0.3); }
        .besing-override-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; margin-bottom: 5px; }
        .besing-override-host-group { display: flex; align-items: center; gap: 6px; overflow: hidden; }
        .besing-override-host { font-size: 11px; font-weight: 600; color: #f1f5f9; font-family: monospace; }
        .besing-override-tag { font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 4px; }
        .besing-override-tag.tag-site { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
        .besing-override-tag.tag-site-off { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
        .besing-override-actions { display: flex; align-items: center; gap: 6px; }
        .besing-select-sm { background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); color: #f1f5f9; border-radius: 6px; padding: 3px 6px; font-size: 10px; outline: none; }
        .besing-zapper-hero-section { background: linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(15, 23, 42, 0.65)); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .besing-btn-zapper-launch { display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; border-radius: 8px; color: #fff; font-size: 12px; font-weight: 700; padding: 9px 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35); transition: all 0.18s ease; }
        .besing-btn-zapper-launch:hover { background: linear-gradient(135deg, #f87171, #ef4444); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45); }
        .besing-shortcut-badge { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #fca5a5; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; font-family: monospace; }
        .besing-zapped-list { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; padding-right: 4px; }
        .besing-zapped-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 6px 8px; }
        .besing-zapped-selector { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #fca5a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .besing-btn-restore-zapped { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 11px; font-weight: 700; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; flex-shrink: 0; }
        .besing-btn-restore-zapped:hover { background: #ef4444; color: #fff; }
        .besing-zapped-empty { font-size: 11px; color: #64748b; text-align: center; padding: 12px 6px; font-style: italic; }
        .besing-segmented-group { display: flex; gap: 4px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 3px; }
        .besing-segmented-btn { flex: 1; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; text-align: center; }
        .besing-segmented-btn:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.04); }
        .besing-segmented-btn.active { background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.35); }
        .besing-stepper-row { display: flex; align-items: center; gap: 6px; }
        .besing-stepper-val { font-size: 13px; font-weight: 700; color: #38bdf8; min-width: 22px; text-align: center; font-family: monospace; }

        /* Rest Reminder Chat Box */
        .besing-rest-chat-box { position: fixed; z-index: 2147483647; width: 270px; background: linear-gradient(145deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 27, 75, 0.98) 100%); border: 1.5px solid rgba(129, 140, 248, 0.5); border-radius: 16px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 25px rgba(99, 102, 241, 0.35); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 14px 16px; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: auto !important; animation: besingRestPop 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275); user-select: none; }
        @keyframes besingRestPop { 0% { opacity: 0; transform: scale(0.85) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .besing-rest-arrow { position: absolute; width: 12px; height: 12px; background: #121829; border: 1.5px solid rgba(129, 140, 248, 0.5); transform: rotate(45deg); z-index: -1; }
        .besing-rest-arrow.arrow-bottom { bottom: -7px; border-top: none; border-left: none; }
        .besing-rest-arrow.arrow-top { top: -7px; border-bottom: none; border-right: none; }
        .besing-rest-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .besing-rest-avatar { font-size: 16px; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: rgba(99, 102, 241, 0.2); border-radius: 50%; border: 1px solid rgba(129, 140, 248, 0.4); }
        .besing-rest-title { font-size: 13px; font-weight: 700; color: #c7d2fe; flex: 1; }
        .besing-rest-badge { font-size: 10px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 1px 6px; border-radius: 8px; }
        .besing-rest-msg { font-size: 12px; color: #cbd5e1; line-height: 1.45; margin-bottom: 12px; }
        .besing-rest-msg strong { color: #38bdf8; font-weight: 700; }
        .besing-rest-actions { display: flex; align-items: center; gap: 8px; }
        .besing-rest-btn-repeat { flex: 1; background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .besing-rest-btn-repeat:hover { background: linear-gradient(135deg, #0369a1, #1d4ed8); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45); }
        .besing-rest-btn-repeat:active { transform: scale(0.97); }
        .besing-rest-btn-off { background: rgba(239, 68, 68, 0.12); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
        .besing-rest-btn-off:hover { background: rgba(239, 68, 68, 0.22); border-color: rgba(239, 68, 68, 0.55); transform: translateY(-1px); }
        .besing-rest-btn-off:active { transform: scale(0.97); }
      `;
      shadow.appendChild(style);
    }
  }

  // Prevent duplicate mounts if another instance is already initialized and alive in CURRENT document
  const existingApp = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                      (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
  if (existingApp && existingApp.host && existingApp.host.isConnected && existingApp.host.ownerDocument === document) {
    console.warn('[BESing] An instance is already mounted in current document. Skipping duplicate initialization.');
    return;
  }
  if (existingApp && typeof existingApp.destroy === 'function') {
    try { existingApp.destroy(); } catch (e) {}
  }

  const app = new BESManagerApp();
  app.isPacked = !BESUpdater.isStableLoader();
  try {
    window.__BESING_INSTANCE__ = app;
    if (typeof unsafeWindow !== 'undefined') unsafeWindow.__BESING_INSTANCE__ = app;
  } catch (e) {}

  // 1. Synchronously arm security shields at document-start before yielding to event loop
  app.initPreemptiveShields();

  // 2. Initialize storage and load remaining active modules with resilient fallback
  app.init().catch(err => {
    console.error('[BESing] Storage init error:', err);
  }).finally(() => {
    app.ensureMounted();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      app.ensureMounted();
    });
  } else {
    app.ensureMounted();
  }

  window.addEventListener('load', () => {
    app.ensureMounted();
  });

  // Mobile iPad / WebKit tab suspension and bfcache lifecycle recovery
  window.addEventListener('pageshow', () => {
    app.ensureMounted();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      app.ensureMounted();
    }
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      app.clampWidgetPosition();
      app.ensureMounted();
    }, 200);
  });

  // Emergency 3-finger tap on mobile/tablet to pull up icon if lost
  window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 3) {
      console.log('[BESing] 3-finger tap detected: pulling up widget icon');
      app.pullUpIcon();
    }
  }, { passive: true });

  setTimeout(() => {
    app.ensureMounted();
  }, 1000);
})();
