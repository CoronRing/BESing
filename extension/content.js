/**
 * BESing - Chrome Extension Manifest V3 Content Script
 * Version 1.9.1
 */

(function () {
  'use strict';

  // Userscript managers inject into every frame. Only the top frame gets the widget and menu;
  // child frames (ads, embeds) run the modules listed here and nothing else.
  const IS_TOP_FRAME = (() => {
    try { return window.top === window.self; } catch (e) { return false; }
  })();
  const FRAME_SAFE_MODULES = new Set(['prevent-redirect', 'force-copy']);
  // Modules whose settings drive state shared by every site, so they cannot be locked to one site.
  const GLOBAL_ONLY_SETTINGS = new Set(['rest-reminder']);

  // Ownership claim shared by every JS world (userscript sandboxes, extension content scripts, page).
  // Worlds do not share globals, and <html> may not exist yet at document-start, but they do share
  // event dispatch on `document`: the owner cancels this event, and a newcomer sees it was cancelled.
  const CLAIM_EVENT = 'besing:claim-page';
  const BOOT_LOG_KEY = 'boot_log';
  const BOOT_LOG_MIRROR_KEY = 'besing_boot_log_mirror';
  const BOOT_LOG_LIMIT = 20;
  const BOOT_LOG_MAX_EVENTS = 40;
  const BOOT_LOG_MAX_ERRORS = 12;

  const getLiveInstance = () => {
    const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) ||
                 (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
    return inst && !inst.disposed ? inst : null;
  };

  // 1. Unified Adapter Layer
  const BESAdapter = {
    isGM: typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
    isExt: typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local,

    // `timeoutMs` bounds the wait for extension storage before falling back to the localStorage mirror.
    async get(key, defaultValue = null, timeoutMs = 350) {
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
          }, timeoutMs);

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

    // How the last getAll() was answered, for the boot log: `source` is the backend
    // ('gm', 'ext', 'ext-timeout', 'ext-error' or 'local'), `found` lists the keys that existed
    // there, and `local` the keys taken from this site's localStorage mirror. Keys in neither
    // fell back to defaults. `lateMs` is set when extension storage answered after the timeout.
    lastLoad: null,

    async getAll(defaults = {}) {
      const keys = Object.keys(defaults);
      const result = { ...defaults };
      const t0 = Date.now();
      const local = [];

      // Pre-fill from localStorage synchronously
      for (const k of keys) {
        try {
          const item = window.localStorage.getItem('besing_' + k);
          if (item !== null && item !== undefined) {
            result[k] = JSON.parse(item);
            local.push(k);
          }
        } catch (e) {}
      }

      if (this.isGM) {
        const found = [];
        for (const k of keys) {
          try {
            const val = GM_getValue(k, undefined);
            if (val !== undefined) {
              result[k] = val;
              found.push(k);
            }
          } catch (e) {}
        }
        this.lastLoad = { source: 'gm', ms: Date.now() - t0, found, local };
        return result;
      }

      if (this.isExt) {
        const report = { source: 'ext', ms: null, found: [], local };
        this.lastLoad = report;
        return new Promise(resolve => {
          let resolved = false;
          // Mobile Edge / WebKit timeout guard: 350ms race
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              report.source = 'ext-timeout';
              report.ms = Date.now() - t0;
              resolve(result);
            }
          }, 350);

          try {
            chrome.storage.local.get(keys, res => {
              if (resolved) {
                report.lateMs = Date.now() - t0;
                return;
              }
              resolved = true;
              clearTimeout(timer);
              report.ms = Date.now() - t0;
              if (chrome.runtime && chrome.runtime.lastError) {
                report.source = 'ext-error';
                resolve(result);
              } else if (res && typeof res === 'object') {
                for (const k of keys) {
                  if (res[k] !== undefined) {
                    result[k] = res[k];
                    report.found.push(k);
                    try {
                      window.localStorage.setItem('besing_' + k, JSON.stringify(res[k]));
                    } catch (e) {}
                  }
                }
                resolve(result);
              } else {
                resolve(result);
              }
            });
          } catch (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              report.source = 'ext-error';
              report.ms = Date.now() - t0;
              resolve(result);
            }
          }
        });
      }

      this.lastLoad = { source: 'local', ms: Date.now() - t0, found: local.slice(), local };
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
    // Reads synchronously so code that must run at document-start (Prevent Redirect's shields) sees
    // the user's real modes and settings: userscript manager storage is synchronous, and extension
    // storage is mirrored into this site's localStorage on every read and write.
    constructor() {
      const readLocal = (k, def) => {
        if (BESAdapter.isGM) {
          try {
            const val = GM_getValue(k, undefined);
            if (val !== undefined && val !== null) return val;
          } catch (e) {}
        }
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

    // Modes only decide where a script runs. Settings locked to a site (see isConfigLocked) are never
    // touched here; the only way to drop them is to switch the lock back to global.
    async setScriptMode(scriptId, mode, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) this.siteRules[h] = { disableAll: false, scripts: {}, configs: {} };
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {};

      if (mode === 'on') {
        // Global ON: active across all sites by default; remove any site override for this host
        this.enabledScripts[scriptId] = true;
        delete this.siteRules[h].scripts[scriptId];
      } else if (mode === 'site') {
        // Active on this site only; globally OFF elsewhere. Its settings follow it to this site.
        this.siteRules[h].scripts[scriptId] = true;
        this.enabledScripts[scriptId] = false;
        this.lockConfigToSite(scriptId, h);
      } else if (mode === 'site-off') {
        // Explicitly disabled on this site only (e.g. RBC), global stays enabled
        this.siteRules[h].scripts[scriptId] = false;
      } else {
        // OFF: Remove site override if present, and disable globally
        delete this.siteRules[h].scripts[scriptId];
        this.enabledScripts[scriptId] = false;
      }

      this.cleanupSiteRule(h);
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    // Settings are locked to a site when `siteRules[host].configs[scriptId]` exists. Data saved by
    // earlier versions in that place (site-only mode) is therefore already locked.
    isConfigLocked(scriptId, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      const rule = this.siteRules[h];
      return !!(rule && rule.configs && rule.configs[scriptId] && typeof rule.configs[scriptId] === 'object');
    }

    // Starts a site lock from a copy of the current global settings, so the site keeps today's values
    // when the global settings change later. Does not persist; callers save `site_rules`.
    lockConfigToSite(scriptId, host) {
      if (GLOBAL_ONLY_SETTINGS.has(scriptId) || this.isConfigLocked(scriptId, host)) return;
      if (!this.siteRules[host]) this.siteRules[host] = { disableAll: false, scripts: {}, configs: {} };
      if (!this.siteRules[host].configs) this.siteRules[host].configs = {};
      this.siteRules[host].configs[scriptId] = JSON.parse(JSON.stringify(this.scriptConfigs[scriptId] || {}));
    }

    // Locking copies the global settings to the site; unlocking discards the site's settings.
    async setConfigLock(scriptId, locked, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      if (!h) return;
      if (locked) {
        this.lockConfigToSite(scriptId, h);
      } else if (this.siteRules[h] && this.siteRules[h].configs) {
        delete this.siteRules[h].configs[scriptId];
        this.cleanupSiteRule(h);
      }
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
      } else {
        delete this.siteRules[h].scripts[scriptId];
      }

      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    async removeSiteOverride(scriptId, host) {
      const h = (host || '').toLowerCase().trim();
      if (!h || !this.siteRules[h]) return;
      if (this.siteRules[h].scripts) delete this.siteRules[h].scripts[scriptId];
      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }

    // Script settings: the site's locked copy when one exists (whatever the script's mode), else global.
    getScriptConfig(scriptId, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();
      if (this.isConfigLocked(scriptId, h)) {
        return { ...(this.scriptConfigs[scriptId] || {}), ...this.siteRules[h].configs[scriptId] };
      }
      return { ...(this.scriptConfigs[scriptId] || {}) };
    }

    async setScriptConfig(scriptId, patch, host = this.getCurrentHost()) {
      const h = (host || '').toLowerCase().trim();

      if (this.isConfigLocked(scriptId, h)) {
        this.siteRules[h].configs[scriptId] = { ...this.siteRules[h].configs[scriptId], ...patch };
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
        // Removes the mode rule only; locked settings stay until unlocked.
        delete this.siteRules[h].scripts[ruleKey];
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

  // Boot diagnostics: a history of page loads with how far each one got, when, and what failed.
  // A load missing from the list means the userscript manager never injected BESing.
  // Entries live in manager storage (shared by every site) and are mirrored to this site's
  // localStorage, so a load whose manager storage misbehaves still leaves a trace here.
  const BESBootLog = {
    entry: null,
    // ms since navigation start when this copy of BESing began running (the injection delay).
    startedAt: (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0,
    _persistTimer: 0,
    _writing: Promise.resolve(),
    // Scripts stopped by Prevent Redirect's script gate on this load, from every JS world.
    gated: 0,

    elapsed() {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      return Math.round(now - this.startedAt);
    },

    ensureEntry() {
      if (!this.entry) {
        let navType = '';
        try {
          const nav = performance.getEntriesByType('navigation')[0];
          navType = nav ? nav.type : '';
        } catch (e) {}
        this.entry = {
          id: Math.random().toString(36).slice(2, 10),
          t: Date.now(),
          u: Date.now(),
          host: (window.location.hostname || '').toLowerCase(),
          v: '1.9.1',
          nav: navType,
          injectMs: Math.round(this.startedAt),
          ready: document.readyState,
          vis: document.visibilityState,
          stages: {},
          info: {},
          events: [],
          errors: []
        };
      }
      return this.entry;
    },

    // Marks the first time a boot stage was reached (ms since BESing started) and merges `info` into the entry.
    record(stage, info) {
      if (!IS_TOP_FRAME) return;
      try {
        const e = this.ensureEntry();
        if (e.stages[stage] === undefined) e.stages[stage] = this.elapsed();
        if (info && typeof info === 'object') Object.assign(e.info, info);
        this.schedulePersist();
      } catch (err) {}
    },

    event(name) {
      if (!IS_TOP_FRAME) return;
      try {
        const e = this.ensureEntry();
        if (e.events.length >= BOOT_LOG_MAX_EVENTS) return;
        e.events.push(`+${this.elapsed()} ${name}`);
        this.schedulePersist();
      } catch (err) {}
    },

    error(where, err) {
      if (!IS_TOP_FRAME) return;
      try {
        const e = this.ensureEntry();
        if (e.errors.length >= BOOT_LOG_MAX_ERRORS) return;
        const msg = (err && err.message) ? `${err.name || 'Error'}: ${err.message}` : String(err);
        e.errors.push(`+${this.elapsed()} ${where}: ${msg.slice(0, 240)}`);
        this.schedulePersist();
      } catch (x) {}
    },

    // Snapshot of what the user should be seeing right now, logged as an event.
    check(label) {
      if (!IS_TOP_FRAME) return;
      try {
        const app = getLiveInstance();
        if (!app) {
          this.event(`${label}: no live instance`);
          return;
        }
        const parts = [];
        if (!app.host) {
          parts.push(app.storage && app.storage.isCurrentBlocked() ? 'site-disabled' : 'NO-HOST');
        } else {
          parts.push(app.host.isConnected ? 'host-in-dom' : 'HOST-DETACHED');
          try {
            const cs = getComputedStyle(app.host);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
              parts.push(`HOST-HIDDEN(${cs.display}/${cs.visibility}/${cs.opacity})`);
            }
          } catch (e) {}
          if (!app.widgetEl || !app.shadow || !app.shadow.contains(app.widgetEl)) {
            parts.push('NO-WIDGET');
          } else {
            const r = app.widgetEl.getBoundingClientRect();
            const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
              r.left < window.innerWidth && r.top < window.innerHeight;
            const folded = (app.widgetEl.className.match(/folded-\w+/) || [''])[0];
            parts.push(`widget ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ${onScreen ? 'on-screen' : 'OFF-SCREEN'}${folded ? ' ' + folded : ''}`);
          }
        }
        const running = (app.modules || []).filter(m => m.running).map(m => m.id);
        parts.push(`running[${running.join(',')}]`);
        if (running.includes('ad-cleaner')) {
          const ac = (app.modules || []).find(m => m.id === 'ad-cleaner');
          if (ac && typeof ac.debugStatus === 'function') parts.push(ac.debugStatus());
        }
        if (running.includes('prevent-redirect')) {
          const pr = (app.modules || []).find(m => m.id === 'prevent-redirect');
          // Asked over a DOM event, which also reaches a guard living in another JS world.
          const answer = pr && typeof pr._pingGuard === 'function' ? pr._pingGuard() : null;
          parts.push(`page-guard-${answer === 'on' ? 'ok' : (answer === 'off' ? 'OFF' : 'MISSING')}`);
          parts.push(pr && pr._navigateHandler ? 'nav-guard-on' : 'NAV-GUARD-OFF');
          if (pr && pr._cfg && pr._cfg.blockScripts !== 'off') parts.push(`gate=${pr._cfg.blockScripts} gated=${this.gated}`);
        }
        parts.push(`vis=${document.visibilityState}`);
        this.event(`${label}: ${parts.join(' ')}`);
      } catch (err) {
        this.error(`check ${label}`, err);
      }
    },

    schedulePersist() {
      if (this._persistTimer) return;
      this._persistTimer = setTimeout(() => {
        this._persistTimer = 0;
        this.persist();
      }, 150);
    },

    // A late-start timer purge can cancel the pending write; forget its id and schedule a new one.
    rearm() {
      this._persistTimer = 0;
      if (this.entry) this.schedulePersist();
    },

    // Writes are chained so one page never interleaves two read-modify-write cycles.
    persist() {
      if (!this.entry) return this._writing;
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = 0;
      }
      this.entry.u = Date.now();
      const snapshot = JSON.parse(JSON.stringify(this.entry));
      this._writing = this._writing.then(async () => {
        try {
          window.localStorage.setItem(BOOT_LOG_MIRROR_KEY, JSON.stringify(this.merge([snapshot], this.readMirror())));
        } catch (e) {}
        try {
          const list = await BESAdapter.get(BOOT_LOG_KEY, [], 3000);
          await BESAdapter.set(BOOT_LOG_KEY, this.merge([snapshot], list));
        } catch (e) {}
      });
      return this._writing;
    },

    readMirror() {
      try {
        const raw = window.localStorage.getItem(BOOT_LOG_MIRROR_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },

    // Combines entry lists, keeping the most recently updated copy of each load, newest load first.
    merge(...lists) {
      const byId = new Map();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const e of list) {
          if (!e || !e.id) continue;
          const prev = byId.get(e.id);
          if (!prev || (e.u || 0) > (prev.u || 0)) byId.set(e.id, e);
        }
      }
      return Array.from(byId.values()).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, BOOT_LOG_LIMIT);
    },

    async read() {
      await this.persist();
      const list = await BESAdapter.get(BOOT_LOG_KEY, [], 3000);
      return this.merge(list, this.readMirror());
    },

    async clear() {
      try { window.localStorage.removeItem(BOOT_LOG_MIRROR_KEY); } catch (e) {}
      await BESAdapter.set(BOOT_LOG_KEY, []);
    },

    // One-line status used by the Settings list and the copied report.
    statusOf(e) {
      const s = (e && e.stages) || {};
      if (s.skipped !== undefined) return 'skipped (another copy owns the page)';
      if (s.mounted !== undefined) return `shown ${s.mounted}ms`;
      if (s.blocked !== undefined) return 'site disabled';
      if (s.storage !== undefined) return 'stopped after settings load';
      return 'stopped at start';
    },

    // Plain-text report meant to be pasted into a bug report.
    async buildReport() {
      const entries = await this.read();
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (t) => {
        const d = new Date(t || 0);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      const env = describeEnvironment();
      const lines = [
        `BESing debug log (v1.9.1), copied ${fmt(Date.now())}`,
        `UA: ${navigator.userAgent}`,
        `This copy: ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')}`,
        `Times: "inject" is ms from navigation start until BESing began; stage and event times are ms after that.`,
        `${entries.length} loads, newest first:`,
        ''
      ];
      entries.forEach((e, i) => {
        const s = e.stages || {};
        const stageText = Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ');
        const here = this.entry && e.id === this.entry.id ? ' (this page)' : '';
        lines.push(`#${i + 1} ${fmt(e.t)} ${e.host || '?'} [${e.nav || '?'}] -- ${this.statusOf(e)}${here}`);
        const late = e.ready && e.ready !== 'loading' ? ' (LATE: page scripts had already run)' : '';
        const inject = e.injectMs !== undefined ? `inject ${e.injectMs}ms, ` : '';
        lines.push(`  ${inject}ready=${e.ready}${late}, vis=${e.vis || '?'}, v${e.v}`);
        lines.push(`  stages: ${stageText || 'none'}`);
        const info = e.info || {};
        if (Object.keys(info).length) {
          lines.push(`  info: ${Object.entries(info).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`);
        }
        (e.events || []).forEach(ev => lines.push(`  ${ev}`));
        (e.errors || []).forEach(er => lines.push(`  ERROR ${er}`));
        lines.push('');
      });
      return lines.join('\n');
    }
  };

  // Short description of how this copy of BESing was loaded, for the boot log.
  function describeEnvironment() {
    const env = {};
    try {
      if (typeof GM_info !== 'undefined' && GM_info) {
        env.handler = `${GM_info.scriptHandler || '?'} ${GM_info.version || ''}`.trim();
        if (GM_info.injectInto) env.injectInto = GM_info.injectInto;
        if (GM_info.script) env.script = `${GM_info.script.name || '?'} ${GM_info.script.version || ''}`.trim();
      } else if (BESAdapter.isExt) {
        env.handler = 'BESing extension';
      } else {
        env.handler = 'none';
      }
      const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const loader = (typeof window !== 'undefined' && window.__BESING_LOADER_INFO__) || (win && win.__BESING_LOADER_INFO__);
      if (loader) env.loader = `stable ${loader.version || '?'} ${loader.source || '?'}`;
      env.storage = BESAdapter.isGM ? 'gm' : (BESAdapter.isExt ? 'ext' : 'local');
      env.frame = IS_TOP_FRAME ? 'top' : 'child';
    } catch (e) {}
    return env;
  }

  // Copies text from inside a tap or click handler, and must be called before that handler awaits
  // anything: WebKit only allows clipboard writes while the tap's user activation is live.
  // Resolves to the method the browser confirmed ('clipboard' or 'command'), or '' when none did.
  // GM_setClipboard is deliberately not used: it reports nothing, and Stay on iOS Edge accepts
  // the call without copying.
  async function copyTextToClipboard(text) {
    let pending = null;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // Started synchronously so it carries the activation. It can also stay pending forever
        // when the browser withholds permission, so it is raced.
        pending = Promise.race([
          navigator.clipboard.writeText(text).then(() => true, () => false),
          new Promise(resolve => setTimeout(() => resolve(false), 1500))
        ]);
      }
    } catch (e) {
      pending = null;
    }
    if (!pending && copyViaCommand(text)) return 'command';
    if (pending && await pending) return 'clipboard';
    if (pending && copyViaCommand(text)) return 'command';
    return '';
  }

  // execCommand('copy') with the selection steps iOS needs (a range on the field plus
  // setSelectionRange). Returns the browser's answer, which is false when it refused.
  function copyViaCommand(text) {
    let ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.contentEditable = 'true';
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:2em;height:2em;padding:0;border:0;font-size:16px;';
      (document.body || document.documentElement).appendChild(ta);
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      return !!ok;
    } catch (e) {
      return false;
    } finally {
      if (ta) ta.remove();
    }
  }

  // Opens the system share sheet (iOS offers Copy, Notes, Messages). Like copying, it must be
  // called before the tap handler awaits. Resolves to 'shared', 'cancelled' or 'unavailable'.
  async function shareText(title, text) {
    if (!navigator.share) return 'unavailable';
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      return e && e.name === 'AbortError' ? 'cancelled' : 'unavailable';
    }
  }

  // Full-screen viewer for the debug log with large Copy and Share buttons, for touch devices where
  // selecting text in the small Settings panel is impractical. It is its own element with its own
  // shadow root, so it works even when the BESing icon never mounted on this load.
  function openBootLogViewer(report) {
    try {
      const old = document.getElementById('__besing_log_viewer__');
      if (old) old.remove();
      const host = document.createElement('besing-log-viewer');
      host.id = '__besing_log_viewer__';
      host.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:2147483647 !important;display:block !important;';
      (document.body || document.documentElement).appendChild(host);
      const root = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .wrap { position: fixed; inset: 0; display: flex; flex-direction: column; gap: 10px; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); background: #0b1120; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-sizing: border-box; }
        .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .title { font-size: 16px; font-weight: 700; flex: 1 1 100%; }
        button, a.btn { flex: 1 1 0; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: #1e293b; color: #e2e8f0; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0 10px; cursor: pointer; font-family: inherit; }
        button.primary { background: linear-gradient(135deg, #0284c7, #2563eb); border-color: transparent; color: #fff; }
        .msg { font-size: 13px; min-height: 18px; color: #34d399; }
        .msg.warn { color: #fbbf24; }
        textarea { flex: 1; width: 100%; box-sizing: border-box; background: #020617; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.45; resize: none; -webkit-user-select: text; user-select: text; }
      `;
      root.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = 'BESing debug log';
      bar.appendChild(title);

      const msg = document.createElement('div');
      msg.className = 'msg';
      const say = (text, warn) => {
        msg.textContent = text;
        msg.className = warn ? 'msg warn' : 'msg';
      };

      const copyBtn = document.createElement('button');
      copyBtn.className = 'primary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        const method = await copyTextToClipboard(report);
        BESBootLog.event(`log copy from viewer: ${method || 'failed'}`);
        if (method) say('Copied. Paste it into your message.');
        else say('This browser blocked copying. Use Share, or press and hold the text and choose Select All.', true);
      });
      bar.appendChild(copyBtn);

      if (navigator.share) {
        const shareBtn = document.createElement('button');
        shareBtn.textContent = 'Share';
        shareBtn.addEventListener('click', async () => {
          const result = await shareText('BESing debug log', report);
          if (result === 'unavailable') say('Sharing is not available here.', true);
        });
        bar.appendChild(shareBtn);
      }

      // Plain-text tab as a last resort; a real link, so popup guards do not treat it as a script popup.
      try {
        const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
        const tabLink = document.createElement('a');
        tabLink.className = 'btn';
        tabLink.href = url;
        tabLink.target = '_blank';
        tabLink.rel = 'noopener';
        tabLink.textContent = 'Open as Tab';
        bar.appendChild(tabLink);
      } catch (e) {}

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => host.remove());
      bar.appendChild(closeBtn);

      const ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.value = report;

      wrap.appendChild(bar);
      wrap.appendChild(msg);
      wrap.appendChild(ta);
      root.appendChild(wrap);
      return true;
    } catch (err) {
      BESBootLog.error('log viewer', err);
      return false;
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
    version: '2.1.0',
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
    // Hide reasons for page structure rather than ads or popups; these use display: none. Every other reason cloaks.
    LAYOUT_REASONS: ['sidebar', 'widget', 'comments', 'isolate', 'ad-shell', 'media'],
    // Ads and popups are cloaked instead of removed: moved far off screen, transparent and unclickable, but still
    // laid out with a size. An ad script that checks whether its slot rendered finds that it did, so it does not
    // re-insert or reload the ad, and a slot that is never on screen never triggers refresh-when-visible.
    CLOAK_STYLE: [['position', 'absolute'], ['left', '-99999px'], ['top', '-99999px'], ['right', 'auto'], ['bottom', 'auto'],
      ['opacity', '0'], ['pointer-events', 'none'], ['transition', 'none']],
    // Elements examined per MutationObserver callback before the rest is left to the next full scan.
    SYNC_BUDGET: 400,
    SYNC_ATTRIBUTE_BUDGET: 60,
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
    _protect: null,
    _joinedOk: new Map(),
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
      this._protect = null;
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
      const rules = ['[data-besing-ac]{opacity:0!important;pointer-events:none!important}'];
      const cloak = this.CLOAK_STYLE.map(([p, v]) => `${p}:${v}!important`).join(';');
      const selectors = this._zapSelectors().slice();
      if (this._at('knownAds')) selectors.push(...this.KNOWN_AD_SELECTORS);
      // One rule per selector: an invalid selector only drops its own rule. The sheet cloaks a matching ad the
      // moment it is inserted, before any script runs.
      selectors.forEach(sel => {
        if (sel && !/[{}]/.test(sel)) rules.push(`${sel}:not(html):not(body){${cloak}}`);
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
        const fresh = [];
        records.forEach(r => {
          const rec = r.type === 'attributes' ? this._styled.get(r.target) : null;
          if (!rec) {
            fresh.push(r);
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
        if (!fresh.length || !this._running) return;
        let complete = false;
        try {
          complete = this._handleNow(fresh);
        } catch (err) {
          console.warn('[BESing Ad Cleaner] mutation check failed', err);
        }
        this._schedule(complete ? 400 : 60);
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
      const rec = { reason, props: [] };
      this._hidden.set(el, rec);
      const styles = this.LAYOUT_REASONS.includes(reason) ? [['display', 'none']] : this.CLOAK_STYLE;
      styles.forEach(([prop, value]) => {
        this._setStyle(el, prop, value);
        rec.props.push(prop);
      });
      try { el.setAttribute('data-besing-ac', reason); } catch (e) {}
      // A hidden modal <dialog> or popover would still make the rest of the page inert.
      if (el.localName === 'dialog' && el.open) {
        try { el.close(); } catch (e) {}
      }
      try {
        if (el.matches(':popover-open')) el.hidePopover();
      } catch (e) {}
      this._silence(el);
      return true;
    },

    // Cloaked ads keep running, so mute and pause any media in them. Frames are left loaded: blanking one
    // makes its ad script reload it.
    _silence(el) {
      const media = el.matches('video,audio') ? [el] : Array.from(el.querySelectorAll('video,audio'));
      media.forEach(m => {
        try {
          m.muted = true;
          if (!m.paused) m.pause();
        } catch (e) {}
      });
    },

    _unhide(el) {
      const rec = this._hidden.get(el);
      if (!rec) return;
      this._hidden.delete(el);
      rec.props.forEach(prop => this._restoreStyle(el, prop));
      try { el.removeAttribute('data-besing-ac'); } catch (e) {}
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
      const protect = this._protectSet();
      this._protect = protect;
      protect.forEach(n => {
        const rec = this._hidden.get(n);
        if (rec && rec.reason !== 'zap') this._unhide(n);
      });
      const ctx = this._newCtx(protect);

      const querySafe = (sel, fn) => {
        try { document.querySelectorAll(sel).forEach(fn); } catch (e) {}
      };
      this._zapSelectors().forEach(sel => querySafe(sel, el => { if (el !== html && el !== body) ctx.hide.push([el, 'zap']); }));
      if (this._at('knownAds')) {
        this.KNOWN_AD_SELECTORS.forEach(sel => querySafe(sel, el => ctx.queue(el, 'known-ad')));
        this.CONSENT_SELECTORS.forEach(sel => querySafe(sel, el => {
          if (this._textLen(el, ctx) <= 3000) ctx.queue(el, 'consent');
        }));
      }

      // Read pass: every decision is collected first, so layout is computed once instead of after every write.
      const walker = document.createTreeWalker(html, NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => this._walkFilter(n) });
      let el;
      while ((el = walker.nextNode())) {
        if (el !== body) this._classify(el, ctx);
      }
      if (this._at('thirdParty')) this._checkAdSizes(ctx);
      if (this._at('isolate') && ctx.main && document.readyState !== 'loading') this._isolate(ctx);

      this._applyCtx(ctx);
      if (this._at('overlays')) this._unlockPage(ctx);
      // Media in cloaked ads can start again on its own.
      this._hidden.forEach((rec, hiddenEl) => { if (rec.props.length > 1) this._silence(hiddenEl); });
      if (this._at('media')) {
        document.querySelectorAll('video,audio').forEach(m => { try { if (!m.paused) m.pause(); } catch (e) {} });
      }
    },

    _protectSet() {
      const set = new Set([document.documentElement, document.body]);
      for (let n = this._main; n; n = n.parentElement) set.add(n);
      return set;
    },

    _newCtx(protect) {
      const ctx = {
        main: this._main, protect, vw: window.innerWidth, vh: window.innerHeight, now: Date.now(),
        text: new Map(), hide: [], statics: [], adLeaves: []
      };
      ctx.queue = (el, reason) => { if (el && !protect.has(el)) ctx.hide.push([el, reason]); };
      return ctx;
    },

    _walkFilter(el) {
      if (el === document.head || this._hidden.has(el) || this._isOwnUi(el)) return NodeFilter.FILTER_REJECT;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },

    // Every per-element rule; decisions go into ctx and are applied by _applyCtx.
    _classify(el, ctx) {
      const cs = window.getComputedStyle(el);
      const pos = cs.position;
      if (pos === 'fixed') this._checkFixed(el, cs, ctx, ctx.now);
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
    },

    // Selector rules for a single element; the full scan uses querySelectorAll for these instead.
    _matchSelectors(el, ctx) {
      // One joined selector per list; a list holding an invalid selector falls back to testing each one.
      const matchesAny = (list) => {
        if (!list.length) return false;
        const joined = list.join(',');
        let ok = this._joinedOk.get(joined);
        if (ok === undefined) {
          try {
            document.documentElement.matches(joined);
            ok = true;
          } catch (e) {
            ok = false;
          }
          if (this._joinedOk.size > 50) this._joinedOk.clear();
          this._joinedOk.set(joined, ok);
        }
        if (ok) return el.matches(joined);
        return list.some(sel => {
          try { return el.matches(sel); } catch (e) { return false; }
        });
      };
      if (matchesAny(this._zapSelectors())) {
        ctx.hide.push([el, 'zap']);
        return;
      }
      if (!this._at('knownAds')) return;
      if (matchesAny(this.KNOWN_AD_SELECTORS)) ctx.queue(el, 'known-ad');
      else if (matchesAny(this.CONSENT_SELECTORS) && this._textLen(el, ctx) <= 3000) ctx.queue(el, 'consent');
    },

    _applyCtx(ctx) {
      const hiddenAds = [];
      ctx.hide.forEach(([target, reason]) => {
        if ((reason === 'zap' || !ctx.protect.has(target)) && this._hide(target, reason) && this.AD_REASONS.includes(reason)) {
          hiddenAds.push(target);
        }
      });
      this._collapseShells(hiddenAds, ctx);
      ctx.statics.forEach(target => this._setStyle(target, 'position', 'static'));
    },

    // Runs inside the MutationObserver callback, which the browser runs before it paints, so an ad that is
    // inserted, re-inserted or switched to fixed is hidden before it is ever drawn. Returns false when the
    // budget ran out and the next full scan should come soon.
    _handleNow(records) {
      if (!document.body || !this._hidden) return false;
      const ctx = this._newCtx(this._protect || this._protectSet());
      const isolate = this._at('isolate') && ctx.main && document.readyState !== 'loading';
      const seen = new Set();
      let budget = this.SYNC_BUDGET;
      const visit = (root, limit) => {
        if (!root || root.nodeType !== 1 || !root.isConnected || seen.has(root)) return;
        if (this._walkFilter(root) !== NodeFilter.FILTER_ACCEPT || root.closest('[data-besing-ac]')) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => this._walkFilter(n) });
        let left = limit;
        for (let el = root; el && budget > 0 && left > 0; el = walker.nextNode()) {
          if (seen.has(el)) continue;
          seen.add(el);
          budget--;
          left--;
          if (el === document.body || el === document.documentElement) continue;
          this._matchSelectors(el, ctx);
          this._classify(el, ctx);
        }
      };
      for (const r of records) {
        if (budget <= 0) break;
        if (r.type === 'childList') {
          r.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            visit(n, this.SYNC_BUDGET);
            if (isolate && ctx.protect.has(r.target) && !ctx.protect.has(n)) this._isolateCheck(n, ctx);
          });
        } else {
          visit(r.target, this.SYNC_ATTRIBUTE_BUDGET);
        }
      }
      if (this._at('thirdParty')) this._checkAdSizes(ctx);
      this._applyCtx(ctx);
      return budget > 0;
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
      const seen = new Set();
      hiddenAds.forEach(el => {
        let cur = el.parentElement;
        for (let i = 0; i < 3 && cur && !ctx.protect.has(cur) && !seen.has(cur); i++) {
          seen.add(cur);
          if (this._hidden.has(cur) || this._isOwnUi(cur) || this._showsContent(cur)) break;
          this._hide(cur, 'ad-shell');
          cur = cur.parentElement;
        }
      });
    },

    // Whether anything inside, outside the elements this module hid, still shows text or media.
    _showsContent(root) {
      const visible = (e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.getClientRects().length > 0);
      const mediaTags = /^(img|picture|video|iframe|canvas|svg|object|embed|input|button|select|textarea)$/;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (n.nodeType === 3) {
            return n.nodeValue.trim() && n.parentElement && visible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
          if (this._hidden.has(n) || /^(script|style|noscript|template)$/.test(n.localName)) return NodeFilter.FILTER_REJECT;
          if (mediaTags.test(n.localName)) return visible(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
      });
      return !!walker.nextNode();
    },

    // Hide every sibling along the path from <body> to the main content.
    _isolate(ctx) {
      for (let n = ctx.main; n && n !== document.body && n.parentElement; n = n.parentElement) {
        Array.from(n.parentElement.children).forEach(s => {
          if (s !== n) this._isolateCheck(s, ctx);
        });
      }
    },

    _isolateCheck(s, ctx) {
      if (ctx.protect.has(s) || this._isOwnUi(s)) return;
      if (/^(script|style|link|meta|noscript|template)$/.test(s.localName)) return;
      if (!this._at('media') && (/^(header|nav)$/.test(s.localName) || /^(banner|navigation)$/.test(s.getAttribute('role') || '') ||
          this._hasToken(this._tokens(s), this.NAV_TOKENS))) return;
      if (this._isPager(s, ctx)) return;
      ctx.queue(s, 'isolate');
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
      if (this._styled) {
        this._styled.forEach((rec, el) => {
          if (rec.has('position') && rec.get('position').value === 'static' && el !== document.body) statics++;
        });
      }
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
    version: '1.7.0',
    description: 'Strictly blocks automatic redirects, mobile sensor traps, new tab popups, and malicious ad network script injections while preserving legitimate site navigation.',
    category: 'Security',
    _cfg: null,
    _gateCount: 0,
    _lateHandled: false,
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
    _navigationTarget: null,
    _navigateHandler: null,
    _sweepHandler: null,

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

    // Verdict cache: frameworks re-register the same listener and timer functions constantly,
    // and toString() plus the regex scan is the costliest part of every hooked call.
    _fnVerdicts: null,

    _isAdFunction(fn) {
      if (typeof fn !== 'function') return false;
      if (!this._fnVerdicts) this._fnVerdicts = new WeakMap();
      const cached = this._fnVerdicts.get(fn);
      if (cached !== undefined) return cached;
      let verdict = false;
      try {
        verdict = this._isAdCode(Function.prototype.toString.call(fn));
      } catch (e) {}
      this._fnVerdicts.set(fn, verdict);
      return verdict;
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

    _isTrapStyle(style) {
      if (!style) return false;
      const hidden = style.includes('opacity:0.01') || style.includes('opacity: 0.01') || style.includes('opacity:0;') || style.includes('opacity: 0;');
      const layered = style.includes('position:fixed') || style.includes('position: fixed') || style.includes('position:absolute') || style.includes('position: absolute');
      return hidden && layered;
    },

    // Removes traps that were already in the page when this module started: invisible tap overlays
    // and ad iframes. The hooks only see what is added after init, so this matters when the
    // userscript manager injected late and the page's ad scripts have already run.
    _sweepExisting() {
      let removed = 0;
      try {
        document.querySelectorAll('div[style], a[style]').forEach(el => {
          if (el.closest && el.closest('besing-host, besing-log-viewer, #besing-zapper-hud')) return;
          if (this._isTrapStyle(el.getAttribute('style') || '')) {
            el.remove();
            removed++;
          }
        });
        document.querySelectorAll('iframe[src]').forEach(el => {
          if (this._isAdOrRedirectUrl(el.getAttribute('src') || '')) {
            el.remove();
            removed++;
          }
        });
      } catch (e) {}
      if (removed) this.notifyBlocked(`${removed} element(s)`, 'traps already in the page');
      return removed;
    },

    // Navigation API guard. The `navigate` event fires when a navigation starts, however it was
    // triggered (a `location.href` assignment, a timer or a touch handler registered long before
    // this module ran), so it still protects pages where BESing was injected after the page's
    // scripts. Policy matches the rest of the module: script-driven navigation may not leave the site.
    _attachNavigationGuard(unsafeWin) {
      const nav = (unsafeWin && unsafeWin.navigation) || window.navigation;
      if (!nav || typeof nav.addEventListener !== 'function') return false;
      const self = this;
      this._navigateHandler = function (e) {
        try {
          if (e.navigationType === 'reload' || e.navigationType === 'traverse') return;
          if (e.downloadRequest !== null && e.downloadRequest !== undefined) return;
          // Form posts (logins, payment confirmations) are left alone; ad scripts do not use them.
          if (e.formData) return;
          const url = e.destination && e.destination.url;
          const isAd = self._isAdOrRedirectUrl(url);
          const isExternal = !self._isSameHost(url);
          if (!isAd && !isExternal) return;
          if (!e.cancelable) {
            // The browser does not let this one be stopped. Reported so the debug log shows it.
            if (!e.userInitiated || isAd) {
              try {
                window.dispatchEvent(new CustomEvent('besing:redirect-missed', {
                  detail: { url, reason: 'navigation not cancelable' }
                }));
              } catch (err) {}
            }
            return;
          }
          // Links the user tapped are judged by the click guard instead.
          if (e.userInitiated && !isAd) return;
          e.preventDefault();
          self.notifyBlocked(url, isAd ? 'ad redirect (navigate event)' : 'script redirect off-site (navigate event)');
        } catch (err) {}
      };
      nav.addEventListener('navigate', this._navigateHandler);
      this._navigationTarget = nav;
      return true;
    },

    // A new tab to a page on this site is allowed when the user just tapped or clicked: a real
    // http(s) URL (blank popups are later pointed at ads), not an ad URL, during a user gesture.
    // Without the User Activation API there is no way to tell, so the popup stays blocked.
    _isUserSameSiteTab(url) {
      if (!url || typeof url !== 'string') return false;
      let parsed;
      try { parsed = new URL(url.trim(), window.location.href); } catch (e) { return false; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (!this._isSameHost(parsed.href) || this._isAdOrRedirectUrl(parsed.href)) return false;
      const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
      return !!(ua && ua.isActive);
    },

    // Strict options. All are off unless the user turns them on, because each one breaks sites
    // that need their scripts. See docs/scripts/prevent-redirect.md, "Strict Protection".
    //   blockScripts:    'off' | 'third-party' | 'all'   script gate, effective when BESing starts first
    //   scriptAllowlist: hosts whose scripts the gate always allows (string, one per line or comma separated)
    //   lateStart:       'off' | 'purge-timers' | 'rebuild'   what to undo when BESing starts after the page
    _normalizeConfig(cfg) {
      const c = (cfg && typeof cfg === 'object') ? cfg : {};
      const blockScripts = (c.blockScripts === 'third-party' || c.blockScripts === 'all') ? c.blockScripts : 'off';
      const lateStart = (c.lateStart === 'purge-timers' || c.lateStart === 'rebuild') ? c.lateStart : 'off';
      const rawList = Array.isArray(c.scriptAllowlist) ? c.scriptAllowlist : String(c.scriptAllowlist || '').split(/[\s,]+/);
      const scriptAllowlist = rawList
        .map(h => String(h).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^\*\./, '').replace(/:\d+$/, ''))
        .filter(h => /^[a-z0-9.-]+$/.test(h));
      return { blockScripts, lateStart, scriptAllowlist };
    },

    // Registrable-domain approximation: `img.example.com` and `www.example.com` are the same site,
    // as are `a.example.co.uk` and `b.example.co.uk`. IP addresses compare whole.
    _siteKey(host) {
      const h = String(host || '').toLowerCase().replace(/\.$/, '');
      if (!h || /^[\d.]+$/.test(h) || h.includes(':')) return h;
      const parts = h.split('.');
      if (parts.length <= 2) return h;
      const sld = parts[parts.length - 2];
      const tld = parts[parts.length - 1];
      const keep = (tld.length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(sld)) ? 3 : 2;
      return parts.slice(-keep).join('.');
    },

    _isAllowlistedHost(host) {
      const list = (this._cfg && this._cfg.scriptAllowlist) || [];
      const h = String(host || '').toLowerCase();
      return list.some(a => h === a || h.endsWith('.' + a));
    },

    // Whether the script gate stops a script with this `src` ('' for an inline script).
    _gateBlocksScript(src) {
      const mode = this._cfg ? this._cfg.blockScripts : 'off';
      if (mode === 'off') return false;
      const raw = typeof src === 'string' ? src.trim() : '';
      if (!raw) return mode === 'all';
      let parsed;
      try { parsed = new URL(raw, window.location.href); } catch (e) { return mode === 'all'; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return mode === 'all';
      const host = parsed.hostname.toLowerCase();
      if (this._isAllowlistedHost(host)) return false;
      if (mode === 'all') return true;
      return this._siteKey(host) !== this._siteKey(window.location.hostname);
    },

    _isExecutableScript(node) {
      if (!node || node.tagName !== 'SCRIPT' || node.id === '__besing_pr_guard__') return false;
      const t = (node.getAttribute('type') || '').trim().toLowerCase();
      if (t === 'javascript/blocked') return false;
      return !t || t === 'module' || /(java|ecma)script/.test(t);
    },

    // Neutralizes a script element the gate stops. Changing `type` before the browser prepares the
    // element is what keeps it from running; parsers prepare a script only after a microtask
    // checkpoint, which is when the DOM observer runs.
    _gateScriptNode(node) {
      if (!this._isExecutableScript(node)) return false;
      const src = node.getAttribute('src') || '';
      if (!this._gateBlocksScript(src)) return false;
      try { node.type = 'javascript/blocked'; } catch (e) {}
      this._noteGated(src || 'inline script');
      return true;
    },

    // Gate blocks are counted and reported on their own event, not as redirects, so a page with many
    // third-party scripts does not flood the redirect alert.
    _noteGated(src) {
      this._gateCount++;
      console.info('[BESing Prevent Redirect] Script gate stopped:', src);
      try {
        window.dispatchEvent(new CustomEvent('besing:scripts-gated', { detail: { url: String(src), count: this._gateCount } }));
      } catch (e) {}
    },

    // Cancels every timer and interval the given window has scheduled so far. Timer ids are
    // sequential, so every id below a fresh one covers them all. Returns the highest id cleared.
    _purgeTimers(win) {
      try {
        const newest = Number(win.setTimeout(function () {}, 0)) || 0;
        const last = Math.min(newest, 500000);
        for (let id = last; id > 0; id--) {
          win.clearTimeout(id);
          win.clearInterval(id);
        }
        return last;
      } catch (e) {
        return 0;
      }
    },

    // Strips everything that can run code or hold a tap trap from a detached copy of the page.
    _sanitizeTree(root) {
      const drop = [
        'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
        'besing-host', 'besing-log-viewer', '[id^="besing-"]', '[id^="__besing"]',
        'meta[http-equiv="refresh" i]', 'link[rel="modulepreload"]', 'link[rel~="preload"][as="script"]'
      ].join(', ');
      root.querySelectorAll(drop).forEach(el => el.remove());

      const urlAttrs = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
      const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src'];
      const traps = [];
      [root, ...root.querySelectorAll('*')].forEach(el => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on') || (urlAttrs.has(name) && /^\s*javascript:/i.test(attr.value))) {
            el.removeAttribute(attr.name);
          }
        }
        // Lazy loaders are page scripts, so images they had not reached yet would stay blank.
        if (el.tagName === 'IMG') {
          const cur = el.getAttribute('src') || '';
          if (!cur || cur.startsWith('data:')) {
            const lazy = lazyAttrs.map(a => el.getAttribute(a)).find(Boolean);
            if (lazy) el.setAttribute('src', lazy);
          }
        }
        if (el !== root && this._isTrapStyle(el.getAttribute('style') || '')) traps.push(el);
      });
      traps.forEach(el => el.remove());
    },

    // Replaces the live page with a script-free copy of itself. Listeners the page attached to its
    // elements stay with the discarded originals, and the copy keeps text that scripts wrote
    // (document.write chapters, rendered content), which a re-fetch of the HTML would lose.
    _rebuildPage() {
      const oldRoot = document.documentElement;
      if (!oldRoot) return false;
      try { window.stop(); } catch (e) {}
      try {
        const copy = oldRoot.cloneNode(true);
        this._sanitizeTree(copy);
        document.replaceChild(copy, oldRoot);
        return true;
      } catch (e) {
        console.warn('[BESing Prevent Redirect] Page rebuild failed:', e);
        return false;
      }
    },

    // Called once by the manager right after the boot-time init (and by the standalone script).
    // A late start means the page's scripts already ran; the `lateStart` option decides how much of
    // their work to undo. Child frames are left alone.
    handleLateStart() {
      if (this._lateHandled) return null;
      this._lateHandled = true;
      const action = this._cfg ? this._cfg.lateStart : 'off';
      if (action === 'off' || document.readyState === 'loading') return null;
      let isTop = false;
      try { isTop = window.top === window.self; } catch (e) {}
      if (!isTop) return null;

      const unsafeWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
      let timersUpTo = this._purgeTimers(window);
      if (unsafeWin !== window) timersUpTo = Math.max(timersUpTo, this._purgeTimers(unsafeWin));
      // The page-world guard purges the page's own timers, which an isolated world cannot reach.
      try { document.dispatchEvent(new CustomEvent('besing:pr-purge')); } catch (e) {}

      const rebuilt = action === 'rebuild' ? this._rebuildPage() : false;
      const result = { action, timersUpTo, rebuilt, ready: document.readyState };
      console.warn('[BESing Prevent Redirect] Late start handled:', result);
      try { window.dispatchEvent(new CustomEvent('besing:late-start-handled', { detail: result })); } catch (e) {}
      return result;
    },

    onConfigChange(cfg) {
      this._cfg = this._normalizeConfig(cfg);
      this._sendGuardConfig(true);
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

    init(cfg) {
      this.destroy();
      this._cfg = this._normalizeConfig(cfg);
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
          if (typeof listener === 'function' && self._isAdFunction(listener)) {
            self.notifyBlocked(type, 'malicious redirect event listener');
            return;
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
          if (typeof handler === 'function' && self._isAdFunction(handler)) {
            self.notifyBlocked('timer', 'malicious auto-redirect setTimeout');
            return 0;
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
          if (typeof handler === 'function' && self._isAdFunction(handler)) {
            self.notifyBlocked('timer', 'malicious auto-redirect setInterval');
            return 0;
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

        if ((isExt || isNewTab || isAd) && !self._isUserSameSiteTab(url)) {
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
              if (this.id !== '__besing_pr_guard__' && self._gateBlocksScript(String(val || ''))) {
                self._noteGated(val);
                return origSet.call(this, 'data:text/javascript,/*besing-gated*/');
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
            if (self._gateScriptNode(node)) return node;
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
            if (self._gateScriptNode(node)) return node;
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

          if ((isExt || isNewTab || isAd) && !self._isUserSameSiteTab(href)) {
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
        // A real tap on a link to this site may open it in a new tab; synthetic clicks may not.
        const userSameSiteTab = isNewTab && e.isTrusted && !isExternal && !isAd;

        if ((isExternal || isNewTab || isAd) && !userSameSiteTab) {
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

      // Synchronously scan and intercept script tags and invisible overlay tiles added to DOM.
      // Observing the document (not <html>) keeps working after a late-start page rebuild swaps <html>.
      try {
        const root = document;
        if (root) {
          const observer = new MutationObserver((mutations) => {
            for (let m = 0; m < mutations.length; m++) {
              const added = mutations[m].addedNodes;
              for (let i = 0; i < added.length; i++) {
                const node = added[i];
                if (!node || node.nodeType !== 1) continue;
                // Our own page-world guard quotes the ad patterns it hooks, so it would match itself.
                if (node.id === '__besing_pr_guard__') continue;
                if (node.tagName === 'SCRIPT' && self._gateScriptNode(node)) {
                  node.remove();
                  continue;
                }
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
          const href = link ? (link.getAttribute('href') || link.href || '') : '';
          if (link && !(e.isTrusted && self._isSameHost(href) && !self._isAdOrRedirectUrl(href))) {
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

      // Late-start protection: the navigation guard catches redirects scheduled before this module
      // ran, and the sweep removes traps already in the page (again once parsing finishes).
      try { this._attachNavigationGuard(unsafeWin); } catch (e) {}
      this._sweepExisting();
      if (document.readyState === 'loading') {
        this._sweepHandler = () => this._sweepExisting();
        document.addEventListener('DOMContentLoaded', this._sweepHandler, { once: true });
      }

      // 13. Page-world guard. The extension ships it as a MAIN-world content script that is already
      // waiting here; the userscript injects it. Either way it is switched on with this init's settings.
      if (this._pingGuard() === null) this._injectGuard();
      if (typeof window !== 'undefined') window.__BESING_PREVENT_REDIRECT__ = this;
      this._sendGuardConfig(true);
    },

    // Injects the guard as an inline <script> so it runs in the page's own JS world. A strict site
    // CSP blocks this; the debug log then reports `page-guard-MISSING`.
    _injectGuard() {
      try {
        const guardScript = document.createElement('script');
        guardScript.id = '__besing_pr_guard__';
        guardScript.textContent = '(' + this._guardMain.toString() + ')(' + JSON.stringify(this._guardState(true)) + ');';
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
      } catch (e) {}
    },

    // 'on' or 'off' from the page-world guard, or null when no guard answered. Events on `document`
    // reach every JS world, so this works from an isolated extension world too.
    _pingGuard() {
      let answer = null;
      const onPong = (e) => { answer = typeof e.detail === 'string' ? e.detail : 'on'; };
      try {
        document.addEventListener('besing:pr-pong', onPong);
        document.dispatchEvent(new CustomEvent('besing:pr-ping'));
      } catch (e) {}
      try { document.removeEventListener('besing:pr-pong', onPong); } catch (e) {}
      return answer;
    },

    _guardState(active) {
      const c = this._cfg || this._normalizeConfig(null);
      return { active: !!active, mode: c.blockScripts, allow: c.scriptAllowlist };
    },

    _sendGuardConfig(active) {
      try {
        document.dispatchEvent(new CustomEvent('besing:pr-config', { detail: JSON.stringify(this._guardState(active)) }));
      } catch (e) {}
    },

    // Page-world guard: hooks the page's own globals, which an isolated JS world cannot reach. It is
    // serialized with toString(), so it must not use anything outside its own body. The userscript
    // injects it inline (_injectGuard); build.py copies the code between the markers below into
    // extension/pr-main.js, a MAIN-world content script, because MV3 applies the extension's own CSP
    // to inline scripts that a content script inserts. `initial` and later 'besing:pr-config' events
    // carry { active, mode, allow }; every hook passes through while `active` is false.
    // <besing-guard>
    _guardMain: function (initial) {
      if (window.__besing_pr_active__) return;
      window.__besing_pr_active__ = true;
      var curHost = (window.location.hostname || '').toLowerCase();
      var STATE = initial || { active: false, mode: 'off', allow: [] };

      document.addEventListener('besing:pr-config', function (e) {
        try {
          var next = JSON.parse(e.detail);
          if (next && typeof next === 'object') STATE = next;
        } catch (err) {}
      });
      document.addEventListener('besing:pr-ping', function () {
        document.dispatchEvent(new CustomEvent('besing:pr-pong', { detail: STATE.active ? 'on' : 'off' }));
      });
      // Late start: cancel the timers the page scheduled before BESing started.
      document.addEventListener('besing:pr-purge', function () {
        if (!STATE.active) return;
        try {
          var newest = Math.min(Number(setTimeout(function () {}, 0)) || 0, 500000);
          for (var id = newest; id > 0; id--) { clearTimeout(id); clearInterval(id); }
        } catch (err) {}
      });

      function siteKey(h) {
        h = String(h || '').toLowerCase();
        if (!h || /^[\d.]+$/.test(h) || h.indexOf(':') !== -1) return h;
        var p = h.split('.');
        if (p.length <= 2) return h;
        var sld = p[p.length - 2], tld = p[p.length - 1];
        var keep = (tld.length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(sld)) ? 3 : 2;
        return p.slice(-keep).join('.');
      }

      function gateBlocks(src) {
        if (!STATE.active || (STATE.mode !== 'third-party' && STATE.mode !== 'all')) return false;
        var raw = typeof src === 'string' ? src.trim() : '';
        if (!raw) return STATE.mode === 'all';
        var u;
        try { u = new URL(raw, window.location.href); } catch (e) { return STATE.mode === 'all'; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return STATE.mode === 'all';
        var h = u.hostname.toLowerCase();
        var allow = STATE.allow || [];
        for (var i = 0; i < allow.length; i++) {
          if (h === allow[i] || h.endsWith('.' + allow[i])) return false;
        }
        if (STATE.mode === 'all') return true;
        return siteKey(h) !== siteKey(curHost);
      }

      function isExecScript(n) {
        if (!n || n.tagName !== 'SCRIPT' || n.id === '__besing_pr_guard__') return false;
        var t = (n.getAttribute('type') || '').trim().toLowerCase();
        if (t === 'javascript/blocked') return false;
        return !t || t === 'module' || /(java|ecma)script/.test(t);
      }

      function noteGated(src) {
        window.dispatchEvent(new CustomEvent('besing:scripts-gated', { detail: { url: String(src || 'inline script') } }));
      }

      function isSame(u) {
        if (!u || typeof u !== 'string') return true;
        var t = u.trim();
        if (!t || t.indexOf('#') === 0 || t.indexOf('javascript:') === 0) return true;
        try {
          var p = new URL(t, window.location.href);
          var h = (p.hostname || '').toLowerCase();
          return h === curHost || h.endsWith('.' + curHost) || curHost.endsWith('.' + h);
        } catch (e) { return false; }
      }

      function isAd(u) {
        if (!u || typeof u !== 'string') return false;
        var s = u.toLowerCase();
        if (/(?:^|\/)(?:config\/)?(?:v\d+|tj|fumeiti|ads?|union|pop|float|jump|tongji|statistics)\.js(?:$|\?)/i.test(s)) return true;
        if (/:(8001|8002|8003|8080|8081|8887|8888|9999|20091|20092|20093)\b/.test(s) && !isSame(s)) return true;
        if (/(lkg6odg|kt6th8f|fumeiti|comprelu|dsygc|uuysi5|uuysi6|5bjoeih|xq04k6u|qq26oeg|adzxdimq|vdxqxca|oybhpsij|popcash|propellerads|exoclick|adsterra|clickadu|richpush|trafficjunky|adservice|adnetwork|7461c|7461m)/.test(s)) return true;
        if (/(\/sc\/\d+|\/cc\/\d+|\/d\/\d+|\/mj1\/\d+|\/stats\/\d+|\/push\/|\/stat\/|\/click\/)/.test(s) && !isSame(s)) return true;
        if (s.indexOf('?n=') !== -1 || s.indexOf('&target=1') !== -1 || s.indexOf('is_not=1') !== -1 || s.indexOf('ikooenpn') !== -1 || s.indexOf('srisnadi') !== -1) {
          if (!isSame(s)) return true;
        }
        return false;
      }

      function isAdCode(str) {
        if (!str || typeof str !== 'string') return false;
        var s = str.toLowerCase();
        if (/(top\.location|window\.location|location\.href)\s*(!=|==|=)/.test(s) && (s.indexOf('http') !== -1 || s.indexOf('target=1') !== -1 || s.indexOf('purl') !== -1 || s.indexOf('ikooenpn') !== -1 || s.indexOf('srisnadi') !== -1 || s.indexOf(':800') !== -1 || s.indexOf(':888') !== -1 || s.indexOf('7461') !== -1 || s.indexOf('comprelu') !== -1 || s.indexOf('kt6th8f') !== -1 || s.indexOf('lkg6odg') !== -1 || s.indexOf('adzxdimq') !== -1 || s.indexOf('dsygc') !== -1)) return true;
        if ((s.indexOf('touchend') !== -1 || s.indexOf('touchstart') !== -1 || s.indexOf('changedtouches') !== -1 || s.indexOf('clientheight') !== -1) && (s.indexOf('location.href') !== -1 || s.indexOf('top.location') !== -1 || s.indexOf('window.location') !== -1)) return true;
        if (/(compel_skip_delay|seo_skip_delay|compel_click|ikooenpn_m|srisnadi_m|wsxg|adzxdimq|oybhpsij|7461c|7461m)/.test(s)) return true;
        if (s.indexOf('new function') !== -1 && (s.indexOf('_tdcs') !== -1 || s.indexOf('wvsyru') !== -1 || s.indexOf('nnkqek') !== -1 || s.indexOf('7461') !== -1)) return true;
        return false;
      }

      function fakeWin(u) {
        var f = {
          closed: false, name: '', opener: window, parent: window, top: window, frames: [], length: 0,
          close: function () { this.closed = true; }, focus: function () {}, blur: function () {},
          postMessage: function () {}, print: function () {}, stop: function () {},
          location: { href: u || 'about:blank', assign: function () {}, replace: function () {}, reload: function () {} },
          document: { open: function () { return this; }, close: function () {}, write: function () {}, writeln: function () {} }
        };
        f.window = f;
        return f;
      }

      // Same-site new tab during a user gesture is allowed; everything else that opens a window is not.
      function userSameSiteTab(u) {
        if (!u || typeof u !== 'string') return false;
        try {
          var p = new URL(u.trim(), window.location.href);
          if (p.protocol !== 'http:' && p.protocol !== 'https:') return false;
          if (!isSame(p.href) || isAd(p.href)) return false;
        } catch (e) { return false; }
        var ua = navigator.userActivation;
        return !!(ua && ua.isActive);
      }

      var origOpen = window.open;
      window.open = function (url, target, feat) {
        if (STATE.active && (isAd(url) || (url && !isSame(url)) || target === '_blank' || target === '_new' || !target) && !userSameSiteTab(url)) {
          window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script window.open' } }));
          return fakeWin(url);
        }
        return origOpen.call(this || window, url, target, feat);
      };

      var fnVerdicts = (typeof WeakMap === 'function') ? new WeakMap() : null;
      var isAdFn = function (f) {
        if (fnVerdicts) {
          var hit = fnVerdicts.get(f);
          if (hit !== undefined) return hit;
        }
        var verdict = false;
        try { verdict = isAdCode(Function.prototype.toString.call(f)); } catch (e) {}
        if (fnVerdicts) fnVerdicts.set(f, verdict);
        return verdict;
      };

      var OrigFunction = window.Function;
      window.Function = function (...args) {
        var code = args[args.length - 1] || '';
        if (STATE.active && typeof code === 'string' && isAdCode(code)) {
          window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: 'payload', reason: 'page-script new Function' } }));
          return function () {};
        }
        return OrigFunction.apply(this, args);
      };
      window.Function.prototype = OrigFunction.prototype;

      var origAEL = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (t, l, o) {
        if (STATE.active) {
          if (t === 'devicemotion' || t === 'deviceorientation') return;
          if (typeof l === 'function' && isAdFn(l)) {
            window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: t, reason: 'page-script addEventListener' } }));
            return;
          }
        }
        return origAEL.call(this, t, l, o);
      };

      var origSetTimeout = window.setTimeout;
      window.setTimeout = function (h, d, ...args) {
        if (STATE.active && typeof h === 'function' && isAdFn(h)) return 0;
        return origSetTimeout.call(this, h, d, ...args);
      };

      var origSetInterval = window.setInterval;
      window.setInterval = function (h, d, ...args) {
        if (STATE.active && typeof h === 'function' && isAdFn(h)) return 0;
        return origSetInterval.call(this, h, d, ...args);
      };

      var OrigWS = window.WebSocket;
      if (OrigWS) {
        window.WebSocket = function (url, proto) {
          if (STATE.active && isAd(url)) {
            window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: url, reason: 'page-script WebSocket' } }));
            return { url: url, readyState: 3, send: function () {}, close: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
          }
          return proto === undefined ? new OrigWS(url) : new OrigWS(url, proto);
        };
        window.WebSocket.prototype = OrigWS.prototype;
      }

      try {
        var sDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (sDesc && sDesc.set) {
          var oSet = sDesc.set;
          Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            set: function (v) {
              if (STATE.active && isAd(v)) {
                window.dispatchEvent(new CustomEvent('besing:redirect-blocked', { detail: { url: v, reason: 'page-script script.src' } }));
                return oSet.call(this, 'data:text/javascript,/*besing-blocked*/');
              }
              if (this.id !== '__besing_pr_guard__' && gateBlocks(String(v || ''))) {
                noteGated(v);
                return oSet.call(this, 'data:text/javascript,/*besing-gated*/');
              }
              return oSet.call(this, v);
            },
            get: sDesc.get,
            configurable: true
          });
        }
      } catch (e) {}

      // Script gate for scripts that page code inserts.
      ['appendChild', 'insertBefore'].forEach(function (name) {
        var orig = Node.prototype[name];
        Node.prototype[name] = function (node) {
          if (node && node.tagName === 'SCRIPT' && isExecScript(node) && gateBlocks(node.getAttribute('src') || '')) {
            try { node.type = 'javascript/blocked'; } catch (e) {}
            noteGated(node.getAttribute('src'));
            return node;
          }
          return orig.apply(this, arguments);
        };
      });

      var oInsert = Element.prototype.insertAdjacentHTML;
      Element.prototype.insertAdjacentHTML = function (p, h) {
        if (STATE.active && typeof h === 'string' && h.indexOf('position:fixed') !== -1 && (h.indexOf('opacity:0.01') !== -1 || h.indexOf('opacity: 0.01') !== -1 || h.indexOf('opacity:0;') !== -1)) {
          return;
        }
        return oInsert.call(this, p, h);
      };
    },
    // </besing-guard>


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
      if (this._navigationTarget && this._navigateHandler) {
        try { this._navigationTarget.removeEventListener('navigate', this._navigateHandler); } catch (e) {}
      }
      this._navigationTarget = null;
      this._navigateHandler = null;
      if (this._sweepHandler) {
        document.removeEventListener('DOMContentLoaded', this._sweepHandler);
        this._sweepHandler = null;
      }
      this._userIntentionalClick = false;
      // The page-world guard stays installed for the life of the page; switch all of its hooks off.
      this._sendGuardConfig(false);
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
    version: '1.3.1',
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
    _recheckTimer: null,    // deferred scroll check after a cooldown or load
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
      this._resumeStreamedPages();
      this._setupScrollListener();
      this._setupHistoryObserver();

      // Trigger initial preload if configured (polite 2500ms delay to allow initial page to settle)
      if (this._config.preloadPages > 0) {
        this._schedulePreload(2500);
      }
      // A reader already at the bottom (e.g. turning PageStream back on there) cannot scroll further,
      // so no scroll event would ever arrive.
      this._scheduleRecheck(1000);

      console.log(`[PageStream] Initialized (When: ${this._config.whenToLoad}, Preload: ${this._config.preloadPages}, History: ${this._config.enableHistory})`);
    },

    destroy() {
      if (!this._active) return;
      this._active = false;

      if (this._preloadTimer) {
        clearTimeout(this._preloadTimer);
        this._preloadTimer = null;
      }
      if (this._recheckTimer) {
        clearTimeout(this._recheckTimer);
        this._recheckTimer = null;
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
      // Pages already streamed stay on screen, together with their dividers, styles and the footer
      // navigation (which points at the newest page), so turning PageStream off only stops further
      // loading and the reader keeps their place.
      const toast = document.getElementById('pagestream-status-toast');
      if (toast) toast.remove();

      this._pageCache = [];
      this._preloadPromise = null;
      this._loadedUrls.clear();
      this._pushedUrls.clear();
      console.log('[PageStream] Destroyed (streamed pages kept)');
    },

    // Picks up pages streamed before PageStream was turned off, so turning it back on continues
    // after the newest one instead of streaming page 2 again.
    _resumeStreamedPages() {
      const blocks = document.querySelectorAll('.pagestream-streamed-block');
      if (!blocks.length) return;
      blocks.forEach(b => {
        const u = b.getAttribute('data-pagestream-url');
        if (u) {
          this._loadedUrls.add(u);
          this._pushedUrls.add(u);
        }
        const n = parseInt(b.getAttribute('data-pagestream-page'), 10);
        if (n > this._curPageNum) this._curPageNum = n;
      });
      const last = blocks[blocks.length - 1];
      const next = last.getAttribute('data-pagestream-next') || null;
      this._currentNextUrl = next && !this._loadedUrls.has(next) && this._ruleAllows(next) ? next : null;
      this._currentNextElement = null;
      this._hasEnded = !this._currentNextUrl;
      const cont = document.getElementById('pagestream-continue');
      if (cont && this._currentNextUrl) cont.remove();
      console.log(`[PageStream] Resumed after page ${this._curPageNum}; next: ${this._currentNextUrl || 'none'}`);
    },

    onConfigChange(newConfig = {}) {
      const selectorsChanged =
        (newConfig.customNextSelector || '') !== (this._config.customNextSelector || '') ||
        (newConfig.customPageSelector || '') !== (this._config.customPageSelector || '');
      this._config = {
        ...this._config,
        ...newConfig,
        preloadPages: newConfig.preloadPages !== undefined ? Number(newConfig.preloadPages) : this._config.preloadPages,
        enableHistory: newConfig.enableHistory !== false
      };
      // Re-detect the next link only before anything was streamed; afterwards the newest page's
      // next link is already known and the live document's link would point back at page 2.
      if (selectorsChanged && this._curPageNum === 1) {
        this._setupNextLink();
      }
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

    // Re-runs the scroll check once a cooldown or load ends. A reader who reaches the bottom during
    // the cooldown and stops scrolling fires no further scroll events, so the trigger would be lost.
    _scheduleRecheck(delay) {
      if (this._recheckTimer || !this._active || this._hasEnded) return;
      this._recheckTimer = setTimeout(() => {
        this._recheckTimer = null;
        this._checkScrollTrigger();
      }, Math.max(50, delay));
    },

    _checkScrollTrigger() {
      if (!this._active || this._hasEnded) return;
      if (this._isLoading) {
        this._scheduleRecheck(500);
        return;
      }

      // Rate limit check: do not evaluate trigger if within cooldown period
      const now = Date.now();
      const cooldownLeft = this._minStreamInterval - (now - this._lastStreamTime);
      if (cooldownLeft > 0) {
        this._scheduleRecheck(cooldownLeft + 50);
        return;
      }

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
          footerNavs: this._extractFooterNavs(doc, mainContent, url),
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
      // A fetch that finishes after PageStream was turned off is discarded.
      if (!this._active) return;
      const { url, title, contentNode, nextUrl, footerNavs } = pageData;
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
      if (nextUrl) streamedWrapper.setAttribute('data-pagestream-next', nextUrl);
      streamedWrapper.appendChild(contentNode);
      // The page's own footer navigation (previous / contents / next) sits right under its text.
      (footerNavs || []).forEach(nav => streamedWrapper.appendChild(nav));

      // 3. Find insertion target: ALWAYS after the latest streamed block if one exists!
      const existingBlocks = document.querySelectorAll('.pagestream-streamed-block');
      const lastBlock = existingBlocks.length > 0 ? existingBlocks[existingBlocks.length - 1] : null;

      if (lastBlock && lastBlock.parentNode) {
        lastBlock.parentNode.insertBefore(divider, lastBlock.nextSibling);
        lastBlock.parentNode.insertBefore(streamedWrapper, divider.nextSibling);
      } else {
        const currentMain = this._findMainContentElement(document);
        if (currentMain && currentMain.parentNode) {
          // Insert after page 1's content and its footer navigation, so that bar stays with page 1
          const anchor = this._lastFooterSibling(currentMain);
          anchor.parentNode.insertBefore(divider, anchor.nextSibling);
          anchor.parentNode.insertBefore(streamedWrapper, divider.nextSibling);
        } else {
          document.body.appendChild(divider);
          document.body.appendChild(streamedWrapper);
        }
      }

      // 4. Observe divider and content for History pushState (Requirement 1)
      if (this._observer) {
        this._observer.observe(divider);
        this._observer.observe(streamedWrapper);
      }

      console.log(`[PageStream] Successfully spliced Page ${pageNum}: ${title}`);
    },

    // The rule's `replace` elements that follow a fetched page's content (its footer navigation:
    // previous, contents, next), cloned into this document with scripts removed and absolute links.
    // Navigation inside the content is already part of the streamed content.
    _extractFooterNavs(doc, mainContent, pageUrl) {
      if (!this._rule || !this._rule.replace || !mainContent) return [];
      let found;
      try { found = Array.from(doc.querySelectorAll(this._rule.replace)); } catch (e) { return []; }
      return found
        .filter(el => this._follows(el, mainContent))
        .map(el => {
          const clone = document.importNode(el, true);
          clone.querySelectorAll('script, iframe, object, embed').forEach(n => n.remove());
          clone.querySelectorAll('a[href]').forEach(a => {
            const raw = a.getAttribute('href') || '';
            if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
            try { a.setAttribute('href', new URL(raw, pageUrl).href); } catch (e) {}
          });
          clone.style.display = '';
          return clone;
        });
    },

    // True when `el` comes after `main` in the document and is not inside or around it.
    _follows(el, main) {
      if (!el || !main || el === main || el.contains(main) || main.contains(el)) return false;
      return !!(main.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    },

    // The last of page 1's footer navigation elements that directly follow its content as siblings,
    // or the content itself. Streamed pages are inserted after it.
    _lastFooterSibling(main) {
      let anchor = main;
      if (!this._rule || !this._rule.replace) return anchor;
      let live;
      try { live = Array.from(document.querySelectorAll(this._rule.replace)); } catch (e) { return anchor; }
      live.forEach(el => {
        if (el.parentNode === main.parentNode && !el.closest('.pagestream-streamed-block') &&
            (anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          anchor = el;
        }
      });
      return anchor;
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
    version: '1.1.0',
    description: 'Repeating eye & body rest reminders displayed as an anchored pet chat bubble with Repeat and Off controls.',
    category: 'Productivity',
    SHARED_KEY: 'rest_reminder',
    LOCAL_KEY: 'besing_rest_reminder_state',
    SYNC_INTERVAL_MS: 5000,
    MAX_TIMEOUT_MS: 2147483647,
    _config: null,
    _active: false,
    _state: null,
    _timer: null,
    _syncInterval: null,
    _syncing: false,
    _chatBoxEl: null,
    _preview: false,
    _boundReposition: null,
    _boundWake: null,

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._active = true;

      // Background tabs throttle timers, and other tabs may press Repeat or Off, so the state is
      // re-read on a slow poll while visible and immediately whenever the page comes back.
      this._boundWake = () => {
        if (document.visibilityState !== 'hidden') this._sync();
      };
      document.addEventListener('visibilitychange', this._boundWake);
      window.addEventListener('pageshow', this._boundWake);
      window.addEventListener('focus', this._boundWake);
      this._syncInterval = setInterval(() => {
        if (document.visibilityState !== 'hidden') this._sync();
      }, this.SYNC_INTERVAL_MS);

      this._sync(true);
    },

    onConfigChange(newConfig) {
      const prevInterval = this._getIntervalMinutes();
      this._config = newConfig || {};
      if (this._active && prevInterval !== this._getIntervalMinutes()) {
        this._startCycle();
      }
    },

    destroy() {
      this._active = false;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (this._syncInterval) {
        clearInterval(this._syncInterval);
        this._syncInterval = null;
      }
      if (this._boundWake) {
        document.removeEventListener('visibilitychange', this._boundWake);
        window.removeEventListener('pageshow', this._boundWake);
        window.removeEventListener('focus', this._boundWake);
        this._boundWake = null;
      }
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

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    /** @returns {Promise<RestReminderState | null>} */
    async _readState() {
      const appMgr = this._manager();
      if (appMgr && typeof appMgr.readSharedState === 'function') {
        try {
          return await appMgr.readSharedState(this.SHARED_KEY, null);
        } catch (e) {}
      }
      try {
        const raw = window.localStorage.getItem(this.LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /** @param {RestReminderState} state */
    async _writeState(state) {
      const appMgr = this._manager();
      if (appMgr && typeof appMgr.writeSharedState === 'function') {
        try {
          await appMgr.writeSharedState(this.SHARED_KEY, state);
          return;
        } catch (e) {}
      }
      try {
        window.localStorage.setItem(this.LOCAL_KEY, JSON.stringify(state));
      } catch (e) {}
    },

    _isValidState(state) {
      return !!state && typeof state === 'object' && Number.isFinite(Number(state.due)) && Number(state.due) > 0;
    },

    // Reads the shared state and brings this page in line with it.
    // On init, a missing or "off" state starts a fresh cycle: the script only runs when enabled,
    // so being initialized after Off means the user switched it back on.
    async _sync(isInit = false) {
      if (this._syncing) return;
      this._syncing = true;
      try {
        const state = await this._readState();
        if (!this._active) return;
        if (state && state.off && !isInit) {
          this._goDormant();
          return;
        }
        if (!this._isValidState(state) || state.off) {
          await this._startCycle();
          return;
        }
        this._apply(state);
      } finally {
        this._syncing = false;
      }
    },

    /** @returns {Promise<RestReminderState>} */
    async _startCycle() {
      const minutes = this._getIntervalMinutes();
      const state = { due: Date.now() + minutes * 60 * 1000, intervalMinutes: minutes, off: false };
      await this._writeState(state);
      if (this._active) this._apply(state);
      return state;
    },

    /** @param {RestReminderState} state */
    _apply(state) {
      this._state = state;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      const remaining = Number(state.due) - Date.now();
      if (remaining <= 0) {
        this._ensureChatBox();
        return;
      }
      if (this._chatBoxEl && !this._preview) {
        // Another tab pressed Repeat.
        this.dismissChatBox();
      }
      this._timer = setTimeout(() => this._sync(), Math.min(this.MAX_TIMEOUT_MS, Math.max(250, remaining)));
    },

    // Another tab pressed Off: stop here too, without touching storage.
    _goDormant() {
      this._state = null;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      if (!this._preview) this.dismissChatBox();
    },

    // Keeps the bubble on screen while the reminder is due, rebuilding it if the page or the
    // BESing layer removed it.
    _ensureChatBox() {
      const appMgr = this._manager();
      const box = this._chatBoxEl;
      const layer = appMgr && appMgr.shadow;
      if (box && box.isConnected && (!layer || box.getRootNode() === layer)) {
        this._preview = false;
        if (appMgr && appMgr.widgetEl) appMgr.widgetEl.classList.add('besing-pulse-alert');
        this._repositionChatBox();
        return;
      }
      if (box) this.dismissChatBox();
      this.showReminderChatBox();
    },

    /** @param {{ preview?: boolean }} [options] preview shows the bubble without a due reminder. */
    showReminderChatBox(options = {}) {
      if (this._chatBoxEl && this._chatBoxEl.isConnected) return; // Already visible
      if (this._chatBoxEl) this.dismissChatBox();
      this._preview = !!options.preview;

      const appMgr = this._manager();

      if (appMgr && typeof appMgr.ensureMounted === 'function') {
        appMgr.ensureMounted();
        if (appMgr.widgetEl) {
          // Un-dock if folded so user sees the full pet icon and speech bubble
          appMgr.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        }
      }

      const interval = this._getIntervalMinutes();
      const activeMinutes = (this._state && Number(this._state.intervalMinutes)) || interval;

      // 1. Create chat box element
      const box = document.createElement('div');
      box.className = 'besing-rest-chat-box';
      box.id = 'besing-rest-chat-box';

      const html = `
        <div class="besing-rest-arrow" id="besing-rest-arrow"></div>
        <div class="besing-rest-header">
          <span class="besing-rest-avatar">🐾</span>
          <span class="besing-rest-title">Time to Rest!</span>
          <span class="besing-rest-badge">${activeMinutes}m</span>
        </div>
        <div class="besing-rest-msg">
          You've been active for <strong>${activeMinutes} minute${activeMinutes === 1 ? '' : 's'}</strong>! Look away from the screen, blink, and stretch.
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
      // The manager's parser works on Trusted Types sites, where innerHTML throws.
      if (appMgr && typeof appMgr.setSafeHTML === 'function') {
        appMgr.setSafeHTML(box, html);
      } else {
        box.innerHTML = html;
      }

      // 2. Insert into shadow DOM if available, otherwise document.body
      const targetContainer = (appMgr && appMgr.shadow) ? appMgr.shadow : (document.body || document.documentElement);
      targetContainer.appendChild(box);
      this._chatBoxEl = box;

      this._repositionChatBox();

      // 3. Highlight pet icon with alert pulse while chat box is open
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.add('besing-pulse-alert');
      }

      // 4. Bind Repeat button (Primary action): starts the next cycle for every tab and site
      const btnRepeat = box.querySelector('#besing-rest-btn-repeat');
      if (btnRepeat) {
        btnRepeat.onclick = (e) => {
          e.stopPropagation();
          this.dismissChatBox();
          this._startCycle();
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
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this._boundReposition);
        window.visualViewport.addEventListener('scroll', this._boundReposition);
      }
    },

    dismissChatBox() {
      if (this._chatBoxEl) {
        if (this._chatBoxEl.parentNode) {
          this._chatBoxEl.parentNode.removeChild(this._chatBoxEl);
        }
        this._chatBoxEl = null;
      }
      this._preview = false;
      if (this._boundReposition) {
        window.removeEventListener('resize', this._boundReposition);
        window.removeEventListener('scroll', this._boundReposition);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', this._boundReposition);
          window.visualViewport.removeEventListener('scroll', this._boundReposition);
        }
        this._boundReposition = null;
      }
      const appMgr = this._manager();
      if (appMgr && appMgr.widgetEl) {
        appMgr.widgetEl.classList.remove('besing-pulse-alert');
      }
    },

    _repositionChatBox() {
      if (!this._chatBoxEl) return;
      const appMgr = this._manager();
      const widget = appMgr && appMgr.widgetEl;
      const box = this._chatBoxEl;
      const arrow = box.querySelector('#besing-rest-arrow');

      // Inside the BESing layer, positions use the manager's zoom-independent coordinates.
      const inManagerLayer = !!(appMgr && appMgr.shadow && box.getRootNode() === appMgr.shadow && typeof appMgr.getViewportMetrics === 'function');
      const metrics = inManagerLayer ? appMgr.getViewportMetrics() : null;
      const vpW = metrics ? metrics.width : (window.visualViewport?.width || window.innerWidth || 800);
      const vpH = metrics ? metrics.height : (window.visualViewport?.height || window.innerHeight || 600);
      const boxW = Math.min(270, vpW - 24);

      let targetX = vpW - boxW - 20;
      let targetY = vpH - 180;
      let isAbove = true;

      if (widget) {
        const rect = inManagerLayer ? appMgr.getLocalRect(widget) : widget.getBoundingClientRect();
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
      box.style.width = `${Math.round(boxW)}px`;
    },

    // Off applies everywhere: the shared state tells open tabs to stop, and the script is switched
    // off globally, including any per-site "on" rules, so new pages do not start it again.
    async _disableReminder() {
      this.destroy();
      await this._writeState({ due: 0, intervalMinutes: this._getIntervalMinutes(), off: true });
      const appMgr = this._manager();
      if (appMgr && appMgr.storage && typeof appMgr.storage.setScriptMode === 'function') {
        const storage = appMgr.storage;
        await storage.setScriptMode(this.id, 'off', storage.getCurrentHost());
        if (typeof storage.getScriptSiteOverrides === 'function' && typeof storage.removeSiteOverride === 'function') {
          for (const rule of storage.getScriptSiteOverrides(this.id)) {
            if (rule.enabled) await storage.removeSiteOverride(this.id, rule.host);
          }
        }
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
    })(),

    // Module: Grok Exporter
    (() => {
      const mod = {
    id: 'grok-exporter',
    name: 'Grok Exporter',
    version: '1.1.0',
    description: 'Copy or download the full Grok conversation on the current page as plain text or Markdown, including messages Grok has not rendered yet.',
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

    /**
     * Grok puts the conversation ID in different places:
     * - regular chats: grok.com/c/<id>
     * - chats inside a project: grok.com/project/<projectId>?tab=conversations&chat=<id>
     */
    getConversationId() {
      if (!this.isGrokHost()) return null;
      const idPattern = /^[A-Za-z0-9-]{8,}$/;
      const m = window.location.pathname.match(/\/c\/([A-Za-z0-9-]{8,})/);
      if (m) return m[1];
      const params = new URLSearchParams(window.location.search);
      for (const key of ['chat', 'conversation', 'conversationId']) {
        const value = params.get(key);
        if (value && idPattern.test(value)) return value;
      }
      return null;
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
            // The HTML flavor carries explicit <br> breaks for rich-text targets that would
            // otherwise collapse plain line breaks.
            const item = new ClipboardItem({
              'text/plain': exportPromise.then(r => new Blob([r.content], { type: 'text/plain' })),
              'text/html': exportPromise.then(r => new Blob([this._toClipboardHtml(r.content)], { type: 'text/html' }))
            });
            await navigator.clipboard.write([item]);
            result = await exportPromise;
          } else {
            throw new Error('ClipboardItem unavailable');
          }
        } catch (clipErr) {
          result = await exportPromise;
          await this._fallbackCopy(result.content);
        }
        this.toast(`Copied ${result.messageCount} messages (${this._formatCount(result.content.length)} chars)${this._noteSuffix(result)}`, 'ok');
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
        const blob = new Blob([result.content], { type: `${result.mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this._buildFilename(result.title, result.extension);
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
     * Builds the export for the conversation on the current page, as plain text or Markdown.
     * Resolves to { content, format, extension, mimeType, title, messageCount, branchCount, source }.
     */
    async exportConversation(cfg = this._config) {
      const options = this._resolveOptions(cfg);
      const conversationId = this.getConversationId();
      if (!conversationId) {
        throw new Error('Open a Grok conversation first (a chat, or a chat inside a project)');
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
      const isMarkdown = options.format === 'markdown';
      const content = isMarkdown
        ? this._toMarkdown({ title, messages, options, source })
        : this._toPlainText({ title, messages, options, source });
      return {
        content,
        format: options.format,
        extension: isMarkdown ? 'md' : 'txt',
        mimeType: isMarkdown ? 'text/markdown' : 'text/plain',
        title,
        messageCount: messages.length,
        branchCount,
        source
      };
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
        format: c.format === 'markdown' ? 'markdown' : 'text',
        includeThinking: c.includeThinking === true,
        includeTimestamps: c.includeTimestamps === true,
        includeSources: c.includeSources === true
      };
    },

    /**
     * Plain text keeps every line break exactly as written, with a [User] / [Grok] label per turn.
     * Markdown viewers join single line breaks into one paragraph, which plain text avoids.
     */
    _toPlainText({ title, messages, options, source }) {
      const lines = [];
      lines.push(title);
      lines.push(`Exported from Grok on ${new Date().toLocaleString()} · ${window.location.href}`);
      if (source === 'dom') {
        lines.push('(Captured from the rendered page because the Grok API was unavailable.)');
      }

      messages.forEach(msg => {
        lines.push('');
        let label = msg.role === 'user' ? '[User]' : '[Grok]';
        if (options.includeTimestamps && msg.createTime) {
          const d = new Date(msg.createTime);
          if (!isNaN(d.getTime())) label += ` ${d.toLocaleString()}`;
        }
        lines.push(label);
        if (options.includeThinking && msg.thinking) {
          lines.push('[Thinking]', msg.thinking, '[/Thinking]');
        }
        if (msg.attachmentCount) {
          lines.push(`(${msg.attachmentCount} attachment${msg.attachmentCount > 1 ? 's' : ''} not included)`);
        }
        if (msg.text) lines.push(msg.text);
        msg.images.forEach((url, idx) => lines.push(`[Image ${idx + 1}] ${url}`));
        if (options.includeSources && msg.sources.length) {
          lines.push('Sources:');
          msg.sources.forEach(s => lines.push(`- ${s.title}: ${s.url}`));
        }
      });

      return lines.join('\n').replace(/\r\n?/g, '\n').trim() + '\n';
    },

    _toClipboardHtml(text) {
      const escaped = String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      return `<div style="white-space:pre-wrap;">${escaped.split('\n').join('<br>')}</div>`;
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

    _buildFilename(title, extension = 'txt') {
      const safe = String(title || 'Grok Conversation')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'Grok Conversation';
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `Grok - ${safe} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${extension}`;
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
      bar.appendChild(this._makeButton('Copy chat', 'Copy the full conversation', this._svg([
        ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }],
        ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
      ]), () => this.copyConversation()));
      bar.appendChild(this._makeButton('Download', 'Download the full conversation (plain text or Markdown, set in BESing)', this._svg([
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
      mod.icon = "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"></path><polyline points=\"9 9 12 12 15 9\"></polyline><line x1=\"12\" y1=\"6\" x2=\"12\" y2=\"12\"></line></svg>";
      mod.author = "BESing Team";
      mod.category = "Tools";
      return mod;
    })()
  ];

  // 4. Update Engine (Checks version, prompts native update, or auto-updates via stable bootstrapper)
  class BESUpdater {
    static CURRENT_VERSION = '1.9.1';

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
      this.bootDocument = document;
      this.disposed = false;
      this._viewportFrame = 0;
      this._viewportHandler = null;
    }

    // Full shutdown used when another instance replaces this one: stops timers, modules and UI,
    // and makes every later lifecycle callback (pageshow, heartbeat, load) a no-op.
    dispose() {
      this.disposed = true;
      this.teardown();
      this.detachViewportTracking();
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

      // The constructor read modes and settings synchronously, so the shield starts with this site's
      // settings (strict options included) and stays off where the user turned it off.
      const prModule = this.modules.find(m => m.id === 'prevent-redirect');
      const host = this.storage.getCurrentHost();
      if (prModule && typeof prModule.init === 'function' && this.storage.isScriptActiveOnSite(prModule.id, host)) {
        try {
          prModule.init(this.storage.getScriptConfig(prModule.id, host));
          prModule.running = true;
          console.log('[BESing] Preemptive security shield synchronously armed at document-start.');
          if (typeof prModule.handleLateStart === 'function') prModule.handleLateStart();
        } catch (e) {
          console.warn('[BESing] Preemptive shield init error:', e);
          BESBootLog.error('preemptive prevent-redirect', e);
        }
      }
    }

    async init() {
      await this.storage.init();
      if (this.disposed) return;
      const currentHost = this.storage.getCurrentHost();
      BESBootLog.record('storage', {
        store: BESAdapter.lastLoad,
        modes: BUILTIN_MODULES.reduce((acc, m) => {
          const mode = this.storage.getScriptMode(m.id, currentHost);
          if (mode !== 'off') acc[m.id] = mode;
          return acc;
        }, {})
      });

      if (!IS_TOP_FRAME) {
        this.initFrameModules(currentHost);
        return;
      }

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
            } catch (err) {
              BESBootLog.error(`init ${m.id}`, err);
            }
          } else if (shouldBeActive && m.running) {
            try {
              if (typeof m.onConfigChange === 'function') {
                m.onConfigChange(cfg);
              }
            } catch (err) {
              BESBootLog.error(`config ${m.id}`, err);
            }
          }
          return;
        }

        if (shouldBeActive && !m.running) {
          try {
            m.init(cfg);
            m.running = true;
          } catch (err) {
            console.error(`[BESing] Error initializing ${m.id}:`, err);
            BESBootLog.error(`init ${m.id}`, err);
          }
        } else if (!shouldBeActive && m.running) {
          try {
            m.destroy();
            m.running = false;
          } catch (err) {
            console.error(`[BESing] Error destroying ${m.id}:`, err);
            BESBootLog.error(`destroy ${m.id}`, err);
          }
        } else if (shouldBeActive && m.running) {
          if (typeof m.onConfigChange === 'function') {
            try { m.onConfigChange(cfg); } catch (err) { BESBootLog.error(`config ${m.id}`, err); }
          }
        }
      });
      BESBootLog.record('modules', { running: this.modules.filter(m => m.running).map(m => m.id).join(',') });

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
        if (this.disposed) return;
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }
      });

      // Userscript manager menu commands. They resolve the live instance at click time,
      // because a later copy of BESing may have replaced this one.
      if (!window.__BESING_MENU_REGISTERED__) {
        window.__BESING_MENU_REGISTERED__ = true;
        const live = () => getLiveInstance() || this;
        BESAdapter.registerMenu('✨ Show / Pull Up BESing Icon', () => {
          live().pullUpIcon();
        });
        BESAdapter.registerMenu('🔄 Reset Icon Position to Default', () => {
          live().resetWidgetPosition();
        });
        BESAdapter.registerMenu('⚙️ Open BESing Settings', () => {
          live().openModal('settings');
        });
        BESAdapter.registerMenu('📦 Open BESing Extensions', () => {
          live().openModal('extensions');
        });
        // Works even when the icon never appeared on this load. A menu command is not a tap on the
        // page, so it cannot copy on iOS; it opens the viewer, whose buttons can.
        BESAdapter.registerMenu('🐞 View BESing Debug Log', async () => {
          openBootLogViewer(await BESBootLog.buildReport());
        });
      }

      // Page Navigation & bfcache Resilience
      window.addEventListener('pageshow', () => {
        if (this.disposed) return;
        this.ensureMounted('pageshow');
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      });

      window.addEventListener('popstate', () => {
        if (this.disposed) return;
        this.ensureMounted('popstate');
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      });

      document.addEventListener('visibilitychange', () => {
        if (this.disposed) return;
        if (document.visibilityState === 'visible') {
          this.ensureMounted('visible');
          this.clampWidgetPosition();
        }
      });

      this.startHeartbeat();

      // Direct DOM MutationObserver on document.documentElement
      try {
        const targetNode = document.documentElement || document.body;
        if (targetNode && !this._domObserver) {
          this._domObserver = new MutationObserver(() => {
            if (this.host && !this.host.isConnected && !this.storage.isCurrentBlocked()) {
              this.ensureMounted('dom-observer');
            }
          });
          this._domObserver.observe(targetNode, { childList: true, subtree: false });
        }
      } catch (e) {}

      if (this.storage.isCurrentBlocked()) {
        console.log(`[BESing] Inactive on ${window.location.hostname} (Site blocked)`);
        BESBootLog.record('blocked');
        return;
      }

      this.ensureMounted('init');
    }

    // Heartbeat DOM guardian (every 2.5s) to catch any random DOM detachments
    startHeartbeat() {
      if (this._heartbeatInterval || this.disposed || !IS_TOP_FRAME) return;
      this._heartbeatInterval = setInterval(() => {
        this.ensureMounted('heartbeat');
      }, 2500);
    }

    // Child frames: honor the frame's site rules for frame-safe modules only, with no widget or listeners.
    initFrameModules(currentHost) {
      this.modules.forEach(m => {
        const shouldBeActive = FRAME_SAFE_MODULES.has(m.id) && this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);
        try {
          if (shouldBeActive && !m.running) {
            m.init(cfg);
            m.running = true;
          } else if (!shouldBeActive && m.running) {
            m.destroy();
            m.running = false;
          } else if (shouldBeActive && m.running && typeof m.onConfigChange === 'function') {
            m.onConfigChange(cfg);
          }
        } catch (err) {
          console.error(`[BESing] Frame module error ${m.id}:`, err);
        }
      });
    }

    refreshCurrentSiteModules() {
      if (this.disposed) return;
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

    // Prevent Redirect's late-start rebuild replaced <html>. Re-observe the new root and remount;
    // other running modules restart so they hold the new page's elements instead of the old ones.
    onPageRebuilt() {
      if (this.disposed) return;
      if (this._domObserver && document.documentElement) {
        try {
          this._domObserver.disconnect();
          this._domObserver.observe(document.documentElement, { childList: true, subtree: false });
        } catch (e) {}
      }
      const currentHost = this.storage.getCurrentHost();
      this.modules.forEach(m => {
        if (m.id === 'prevent-redirect' || !m.running) return;
        try {
          m.destroy();
          m.init(this.storage.getScriptConfig(m.id, currentHost));
        } catch (err) {
          BESBootLog.error(`restart ${m.id}`, err);
        }
      });
      this.ensureMounted('page-rebuilt');
    }

    async applyScriptConfig(scriptId, patch) {
      const currentHost = this.storage.getCurrentHost();
      await this.storage.setScriptConfig(scriptId, patch, currentHost);
      this.pushConfigToModule(scriptId);
    }

    // Hands the settings that apply on this site to a running module, restarting modules that
    // cannot take settings live.
    pushConfigToModule(scriptId) {
      const updatedCfg = this.storage.getScriptConfig(scriptId, this.storage.getCurrentHost());
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

    // Cross-site state for modules. Userscript manager and extension storage are shared by every
    // site, unlike localStorage, which is separate per origin. Values must be JSON-serializable.
    async readSharedState(key, fallback = null) {
      return BESAdapter.get('shared_' + key, fallback);
    }

    async writeSharedState(key, value) {
      return BESAdapter.set('shared_' + key, value);
    }

    openScriptConfig(scriptId) {
      this.activeConfigScriptId = scriptId;
      this.currentView = 'script-config';
      this.renderBody();
    }

    ensureMounted(reason = '') {
      if (this.disposed || !IS_TOP_FRAME) return;
      if (this.storage.isCurrentBlocked()) return;

      try {
        const docRoot = document.body || document.documentElement;
        if (!docRoot) return;

        // Discard stale host from old document (WebKit / iPadOS refresh or bfcache)
        if (this.host && this.host.ownerDocument !== document) {
          BESBootLog.event(`stale host from old document dropped${reason ? ' (' + reason + ')' : ''}`);
          this.host = null;
          this.shadow = null;
          this.widgetEl = null;
        }

        // 1. Host exists in memory, belongs to current document, but got detached
        if (this.host && !this.host.isConnected) {
          BESBootLog.event(`host was detached, reattached${reason ? ' (' + reason + ')' : ''}`);
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
          this.mount(reason);
          return;
        }

        // 3. Make sure widget element is present in shadow DOM
        if (this.shadow && (!this.widgetEl || !this.shadow.contains(this.widgetEl))) {
          BESBootLog.event(`widget missing, re-rendered${reason ? ' (' + reason + ')' : ''}`);
          this.renderWidget(this.shadow);
        }
      } catch (err) {
        console.error('[BESing] Mount error:', err);
        BESBootLog.error(`mount${reason ? ' (' + reason + ')' : ''}`, err);
      }
    }

    mount(reason = '') {
      if (this.disposed || !IS_TOP_FRAME) return;
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
      this.attachViewportTracking();
      this.applyViewportCompensation();
      this.renderWidget(shadow);
      if (BESBootLog.entry && BESBootLog.entry.stages.mounted !== undefined) {
        BESBootLog.event(`host recreated${reason ? ' (' + reason + ')' : ''}`);
      } else {
        BESBootLog.record('mounted', reason ? { mountedBy: reason } : undefined);
      }

      if (!this._redirectListenerAttached) {
        window.addEventListener('besing:redirect-blocked', () => {
          this.blinkRedirectAlert();
        });
        this._redirectListenerAttached = true;
      }
    }

    // ---- Visual viewport compensation ----
    // The widget layer is position: fixed, which grows and drifts with pinch-zoom on mobile.
    // The host is translated onto the visual viewport and scaled by 1 / zoom, so the widget keeps
    // its normal on-screen size. Widget coordinates live in this "local" space, whose size stays
    // roughly constant while zooming, so saved positions are not disturbed by zoom.

    getViewportMetrics() {
      const doc = document.documentElement;
      const layoutW = (doc && doc.clientWidth) || window.innerWidth || 0;
      const layoutH = window.innerHeight || (doc && doc.clientHeight) || 0;
      const vv = window.visualViewport;
      if (!vv || !(vv.width > 0) || !(vv.height > 0)) {
        return { scale: 1, offsetLeft: 0, offsetTop: 0, width: layoutW, height: layoutH };
      }
      const scale = vv.scale > 0 ? vv.scale : 1;
      return {
        scale,
        offsetLeft: vv.offsetLeft || 0,
        offsetTop: vv.offsetTop || 0,
        width: vv.width * scale,
        height: vv.height * scale
      };
    }

    getLocalRect(el) {
      const r = el.getBoundingClientRect();
      const m = this.getViewportMetrics();
      const left = (r.left - m.offsetLeft) * m.scale;
      const top = (r.top - m.offsetTop) * m.scale;
      const width = r.width * m.scale;
      const height = r.height * m.scale;
      return { left, top, width, height, right: left + width, bottom: top + height };
    }

    applyViewportCompensation() {
      if (!this.host) return;
      const m = this.getViewportMetrics();
      const isIdentity = Math.abs(m.scale - 1) < 0.01 && Math.abs(m.offsetLeft) < 0.5 && Math.abs(m.offsetTop) < 0.5;
      const transform = isIdentity ? 'none' : `translate(${m.offsetLeft}px, ${m.offsetTop}px) scale(${1 / m.scale})`;
      this.host.style.setProperty('--besing-host-w', `${Math.round(m.width)}px`);
      this.host.style.setProperty('--besing-host-h', `${Math.round(m.height)}px`);
      this.host.style.setProperty('--besing-vw', `${Math.round(m.width)}px`);
      this.host.style.setProperty('--besing-vh', `${Math.round(m.height)}px`);
      this.host.style.setProperty('--besing-host-transform', transform);
    }

    attachViewportTracking() {
      if (this._viewportHandler) return;
      this._viewportHandler = () => {
        if (this._viewportFrame) return;
        this._viewportFrame = requestAnimationFrame(() => {
          this._viewportFrame = 0;
          if (this.disposed) return;
          this.applyViewportCompensation();
          if (this.widgetEl && !this.isDragging) {
            this.restoreWidgetPosition();
            this.checkEdgeDocking(this.widgetEl);
          }
          if (this.menuWrapperEl) {
            this.positionBubble(this.menuWrapperEl, this.menuWrapperEl.querySelector('.besing-bubble-panel'), this.menuWrapperEl.querySelector('.besing-bubble-arrow'));
          }
        });
      };
      window.addEventListener('resize', this._viewportHandler);
      window.addEventListener('orientationchange', this._viewportHandler);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this._viewportHandler);
        window.visualViewport.addEventListener('scroll', this._viewportHandler);
      }
    }

    detachViewportTracking() {
      if (!this._viewportHandler) return;
      window.removeEventListener('resize', this._viewportHandler);
      window.removeEventListener('orientationchange', this._viewportHandler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this._viewportHandler);
        window.visualViewport.removeEventListener('scroll', this._viewportHandler);
      }
      if (this._viewportFrame) cancelAnimationFrame(this._viewportFrame);
      this._viewportFrame = 0;
      this._viewportHandler = null;
    }

    // Re-applies the saved position clamped to the current viewport without saving the clamp,
    // so a temporary shrink (on-screen keyboard, rotation) does not overwrite where the user put it.
    restoreWidgetPosition() {
      if (!this.widgetEl) return;
      const saved = this.storage.getWidgetPosition();
      if (!saved || saved.x === undefined || saved.y === undefined) return;
      const m = this.getViewportMetrics();
      if (m.width < 200 || m.height < 200) return;
      const left = Math.max(0, Math.min(m.width - 48, saved.x));
      const top = Math.max(0, Math.min(m.height - 48, saved.y));
      this.widgetEl.style.left = `${left}px`;
      this.widgetEl.style.top = `${top}px`;
      this.widgetEl.style.right = 'auto';
      this.widgetEl.style.bottom = 'auto';
    }

    // Keeps the widget on screen for the current viewport. The saved position is only written
    // by explicit user actions (drag, pull up, reset), never by a clamp.
    clampWidgetPosition() {
      this.applyViewportCompensation();
      this.restoreWidgetPosition();
    }

    pullUpIcon() {
      if (this.storage.isCurrentBlocked()) {
        console.log('[BESing] Site was blocked. Mounting and opening settings...');
        this.mount();
        this.openModal('settings');
        return;
      }

      this.ensureMounted('pull-up');

      if (!this.widgetEl) {
        if (this.shadow) this.renderWidget(this.shadow);
        else this.mount();
      }

      if (!this.widgetEl) return;

      // 1. Un-dock / un-fold
      this.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

      // 2. Position comfortably in visible viewport (bottom-right)
      this.applyViewportCompensation();
      const m = this.getViewportMetrics();
      const clientW = Math.max(300, m.width || 800);
      const clientH = Math.max(300, m.height || 600);
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
        m.running = false;
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
      const m = this.getViewportMetrics();
      const maxW = Math.max(300, m.width || 800);
      const maxH = Math.max(300, m.height || 600);

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

        btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        btn.style.transition = 'none';

        // Prefer the stored coordinates: the measured rect includes fold and hover transforms.
        const styleLeft = parseFloat(btn.style.left);
        const styleTop = parseFloat(btn.style.top);
        if (!isNaN(styleLeft) && !isNaN(styleTop)) {
          this.initialLeft = styleLeft;
          this.initialTop = styleTop;
        } else {
          const rect = this.getLocalRect(btn);
          this.initialLeft = rect.left;
          this.initialTop = rect.top;
        }
        this._dragScale = this.getViewportMetrics().scale;

        window.addEventListener('mousemove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
      };

      const onMove = (e) => {
        if (!this.isDragging) return;
        const pt = e.touches ? e.touches[0] : e;
        if (!pt) return;
        const dx = pt.clientX - this.startX;
        const dy = pt.clientY - this.startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          this.dragMoved = true;
          if (e.cancelable) e.preventDefault();
        }

        // Pointer deltas are in zoomed page pixels; the widget lives in unzoomed local pixels.
        const s = this._dragScale || 1;
        const m = this.getViewportMetrics();
        const newL = Math.max(0, Math.min(m.width - 48, this.initialLeft + dx * s));
        const newT = Math.max(0, Math.min(m.height - 48, this.initialTop + dy * s));

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
        window.removeEventListener('touchcancel', onEnd);

        // Only a real drag moves the saved position; a tap leaves it alone.
        if (this.dragMoved) {
          const left = parseFloat(btn.style.left);
          const top = parseFloat(btn.style.top);
          if (!isNaN(left) && !isNaN(top)) {
            this.storage.setWidgetPosition({ x: Math.round(left), y: Math.round(top) });
          }
        }
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
      if (!btn) return;
      const m = this.getViewportMetrics();
      const clientW = m.width;
      const clientH = m.height;
      if (clientW < 200 || clientH < 200) return;

      // Measure unfolded: the fold transform would otherwise shift the rect toward the edge.
      btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
      const rect = this.getLocalRect(btn);
      const margin = 14;

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
      if (this.disposed || !IS_TOP_FRAME) return;
      if (this.outsideClickHandler) {
        document.removeEventListener('click', this.outsideClickHandler, true);
        document.removeEventListener('click', this.outsideClickHandler, false);
        this.outsideClickHandler = null;
      }
      if (this.menuWrapperEl) this.closeModal();
      // The host is torn down on blocked sites; mount it so Settings can still be opened to unblock.
      if (!this.shadow || !this.host || !this.host.isConnected) this.mount();
      if (!this.shadow) return;
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
      if (panel) {
        panel.style.removeProperty('max-height');
        panel.style.removeProperty('min-height');
      }
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
      const margin = 14;
      const m = this.getViewportMetrics();
      const bubbleW = Math.min(390, Math.max(200, m.width - 28));

      if (this.widgetEl) {
        const clientW = m.width;
        const clientH = m.height;
        const rect = this.getLocalRect(this.widgetEl);
        const center = rect.left + rect.width / 2;
        const left = Math.max(margin, Math.min(clientW - bubbleW - margin, center - bubbleW / 2));
        const isBottom = rect.top > clientH / 2;

        // Cap the panel to the space on its side of the widget so it never runs off screen.
        const available = isBottom ? rect.top - 10 - margin : clientH - rect.bottom - 10 - margin;
        if (panel) panel.style.setProperty('max-height', `${Math.max(200, Math.round(available))}px`, 'important');
        if (panel) panel.style.setProperty('min-height', `${Math.min(380, Math.max(200, Math.round(available)))}px`, 'important');

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

            <div class="besing-update-card" style="background:rgba(148,163,184,0.05);border-color:rgba(148,163,184,0.2);">
              <div class="besing-update-header">
                <span class="besing-section-title">Recent Page Loads</span>
                <button type="button" class="besing-btn-sub-action" id="besing-btn-clear-boot-log">Clear</button>
              </div>
              <div style="font-size:10px;color:#94a3b8;line-height:1.35;">
                Each page load BESing ran on, newest first. If a load you made is missing, your userscript manager never started BESing on it. "Stopped" means BESing started but the icon never appeared. The debug log holds the last ${BOOT_LOG_LIMIT} loads with timings and errors for a bug report.
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="besing-btn-sub-action" id="besing-btn-copy-boot-log" style="flex:1;min-height:34px;font-size:11px;color:#38bdf8;border-color:rgba(56,189,248,0.3);">Copy Debug Log</button>
                ${navigator.share ? '<button type="button" class="besing-btn-sub-action" id="besing-btn-share-boot-log" style="flex:1;min-height:34px;font-size:11px;">Share</button>' : ''}
                <button type="button" class="besing-btn-sub-action" id="besing-btn-view-boot-log" style="flex:1;min-height:34px;font-size:11px;">View Full Screen</button>
              </div>
              <div id="besing-boot-log-msg" style="font-size:10px;color:#34d399;display:none;"></div>
              <div id="besing-boot-log-list" style="display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:#cbd5e1;">Loading...</div>
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
              <div class="besing-add-override-row" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                <input type="text" class="besing-input-sm" id="besing-settings-new-host" placeholder="domain (e.g. google.com, rbc.com)" style="flex:1 1 100%;min-width:0;">
                <select class="besing-select-sm" id="besing-settings-new-script" style="flex:1 1 0;min-width:0;">
                  ${this.modules.map(mod => `<option value="${mod.id}">${mod.name}</option>`).join('')}
                </select>
                <select class="besing-select-sm" id="besing-settings-new-mode" style="flex:1 1 0;min-width:0;">
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

        const bootLogList = body.querySelector('#besing-boot-log-list');
        const bootLogMsg = body.querySelector('#besing-boot-log-msg');
        // Built ahead of the tap: iOS only allows clipboard writes and sharing during the tap
        // itself, and awaiting storage first would use that window up.
        let bootLogReport = '';
        const renderBootLog = async () => {
          if (!bootLogList) return;
          const entries = await BESBootLog.read();
          bootLogReport = await BESBootLog.buildReport();
          bootLogList.textContent = '';
          if (!entries.length) {
            bootLogList.textContent = 'No page loads recorded yet.';
            return;
          }
          entries.forEach(e => {
            const s = e.stages || {};
            const when = new Date(e.t || 0);
            const pad = (n) => String(n).padStart(2, '0');
            const time = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
            const status = BESBootLog.statusOf(e);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
            const left = document.createElement('span');
            left.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            left.textContent = `${time} ${e.host || ''}`;
            const right = document.createElement('span');
            right.style.cssText = `flex-shrink:0;color:${s.mounted !== undefined ? '#34d399' : (s.blocked !== undefined ? '#94a3b8' : '#fbbf24')};`;
            right.textContent = e.id === (BESBootLog.entry && BESBootLog.entry.id) ? `${status} (this page)` : status;
            row.appendChild(left);
            row.appendChild(right);
            bootLogList.appendChild(row);
          });
        };
        renderBootLog();
        const showBootLogMsg = (text, color) => {
          if (!bootLogMsg) return;
          bootLogMsg.textContent = text;
          bootLogMsg.style.color = color;
          bootLogMsg.style.display = 'block';
        };
        const copyBootLogBtn = body.querySelector('#besing-btn-copy-boot-log');
        if (copyBootLogBtn) {
          copyBootLogBtn.onclick = async () => {
            if (!bootLogReport) {
              // Report not ready yet, so this tap cannot copy; the viewer's own Copy button can.
              openBootLogViewer(await BESBootLog.buildReport());
              return;
            }
            const report = bootLogReport;
            const method = await copyTextToClipboard(report);
            BESBootLog.event(`log copy from settings: ${method || 'failed'}`);
            if (method) {
              showBootLogMsg('Debug log copied. Paste it into your message.', '#34d399');
            } else {
              showBootLogMsg('This browser blocked copying, so the log opened full screen. Try Share there.', '#fbbf24');
              openBootLogViewer(report);
            }
            renderBootLog();
          };
        }
        const shareBootLogBtn = body.querySelector('#besing-btn-share-boot-log');
        if (shareBootLogBtn) {
          shareBootLogBtn.onclick = async () => {
            if (!bootLogReport) {
              openBootLogViewer(await BESBootLog.buildReport());
              return;
            }
            const result = await shareText('BESing debug log', bootLogReport);
            if (result === 'unavailable') {
              showBootLogMsg('Sharing is not available here, so the log opened full screen.', '#fbbf24');
              openBootLogViewer(bootLogReport);
            }
          };
        }
        const viewBootLogBtn = body.querySelector('#besing-btn-view-boot-log');
        if (viewBootLogBtn) {
          viewBootLogBtn.onclick = async () => {
            openBootLogViewer(bootLogReport || await BESBootLog.buildReport());
          };
        }
        const clearBootLogBtn = body.querySelector('#besing-btn-clear-boot-log');
        if (clearBootLogBtn) {
          clearBootLogBtn.onclick = async () => {
            await BESBootLog.clear();
            if (bootLogMsg) bootLogMsg.style.display = 'none';
            renderBootLog();
          };
        }

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
          if (!val) this.startHeartbeat();
          renderSiteRulesList();
        };

        // Groups start collapsed except the current site; the open set survives re-renders.
        const expandedHosts = new Set([currentHost.toLowerCase()]);
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
            group.className = expandedHosts.has(host) ? 'besing-site-group' : 'besing-site-group collapsed';

            let ruleCount = 0;
            if (rule.disableAll) ruleCount++;
            if (rule.scripts) ruleCount += Object.keys(rule.scripts).length;
            if (rule.configs) ruleCount += Object.keys(rule.configs).length;

            const groupHeader = document.createElement('div');
            groupHeader.className = 'besing-site-group-header';
            this.setSafeHTML(groupHeader, `
              <div class="besing-site-group-title">
                <svg class="besing-site-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span class="besing-site-host">${host}</span>
                <span class="besing-site-rule-count">${ruleCount} configured</span>
              </div>
              <button type="button" class="besing-btn-del-site" title="Remove all rules for ${host}">Remove Site</button>
            `);

            // Collapsible dropdown toggle: click header to expand/collapse rules
            groupHeader.onclick = (e) => {
              if (e.target.closest('.besing-btn-del-site')) return;
              const collapsed = group.classList.toggle('collapsed');
              if (collapsed) expandedHosts.delete(host);
              else expandedHosts.add(host);
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
                const m = this.modules.find(mod => mod.id === scriptId) || { name: scriptId };
                const row = document.createElement('div');
                row.className = 'besing-site-rule-row';
                this.setSafeHTML(row, `
                  <div class="besing-site-rule-info">
                    <span class="besing-site-rule-name">${m.name}</span>
                    <span class="besing-site-rule-tag" style="background:rgba(167,139,250,0.15);color:#a78bfa;">Settings Locked</span>
                  </div>
                  <div class="besing-site-rule-actions">
                    <button class="besing-rule-remove" title="Unlock: discard this site's settings and use the global ones">✕</button>
                  </div>
                `);
                row.querySelector('.besing-rule-remove').onclick = async (e) => {
                  e.stopPropagation();
                  await this.storage.setConfigLock(scriptId, false, host);
                  renderSiteRulesList();
                  if (host === this.storage.getCurrentHost()) this.pushConfigToModule(scriptId);
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

      let scopeNotice = '';
      if (currentMode === 'site') {
        scopeNotice = `
          <div class="besing-config-scope site">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
            <div><strong>Site Only (${currentHost}):</strong> Runs on this site only and is off on other sites.</div>
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
            <div><strong>On Everywhere:</strong> Runs on every site except those where it is set to Site Off.</div>
          </div>
        `;
      } else {
        scopeNotice = `
          <div class="besing-config-scope off">
            <div>⚪ <strong>Script is currently OFF.</strong> Choose <strong>ON</strong> to run it everywhere or <strong>SITE ONLY</strong> to run it here.</div>
          </div>
        `;
      }

      let specificControls = '';
      let hasSettings = true;

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
        const level = typeof m._readLevel === 'function' ? m._readLevel(cfg) : 3.4;
        const levelInfo = typeof m.describeLevel === 'function' ? m.describeLevel(level) : { name: '', detail: '' };
        const zapLists = typeof m.getZapLists === 'function' ? m.getZapLists(cfg) : { site: [], legacy: [] };
        const stats = m.running && typeof m.getStats === 'function' ? m.getStats() : null;
        const escAttr = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const zapRows = [
          ...zapLists.site.map((sel, idx) => ({ sel, kind: 'site', idx })),
          ...zapLists.legacy.map((sel, idx) => ({ sel, kind: 'legacy', idx }))
        ];
        let blockedListHtml = '';
        if (zapRows.length === 0) {
          blockedListHtml = `<div class="besing-zapped-empty">No elements zapped on this site yet.</div>`;
        } else {
          blockedListHtml = zapRows.map(row => `
            <div class="besing-zapped-item">
              <code class="besing-zapped-selector" title="${escAttr(row.sel)}">${row.kind === 'legacy' ? '[all sites] ' : ''}${escAttr(row.sel)}</code>
              <button type="button" class="besing-btn-restore-zapped" data-kind="${row.kind}" data-index="${row.idx}" title="Show this element again">✕</button>
            </div>
          `).join('');
        }
        let statsText = 'Not running on this page.';
        if (stats) {
          const reasons = Object.entries(stats.byReason).map(([k, v]) => `${k} ${v}`).join(', ');
          statsText = `Hidden on this page: ${stats.hidden}${reasons ? ` (${reasons})` : ''}. Unstuck: ${stats.statics}. Main content: ${stats.main}.`;
        }

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Aggressiveness</span>
              <span class="besing-brightness-badge" id="ac-level-badge">${level.toFixed(1)} · ${escAttr(levelInfo.name)}</span>
            </div>
            <input type="range" class="besing-slider-range ac-level-range" id="ac-level-range" min="0" max="4" step="0.1" value="${level}">
            <div class="besing-range-ticks">
              <span>0 Zaps only</span>
              <span>2 Third-party</span>
              <span>3.4 Default</span>
              <span>4 Text only</span>
            </div>
            <p id="ac-level-detail" style="font-size:11px;color:#cbd5e1;line-height:1.4;margin:6px 0 0;">${escAttr(levelInfo.detail)} Higher levels include everything below them.</p>
            <p id="ac-stats" style="font-size:10px;color:#94a3b8;line-height:1.35;margin:6px 0 0;">${escAttr(statsText)}</p>
          </div>

          <div class="besing-config-section besing-zapper-hero-section">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;color:#f87171;display:flex;align-items:center;gap:6px;">
                <span>🎯</span> Element Zapper
              </span>
              <span class="besing-shortcut-badge" title="Global Shortcut: Press Alt + Z anywhere on the webpage">Alt + Z</span>
            </div>
            <p style="font-size:11px;color:#cbd5e1;line-height:1.4;margin:0;">
              Tap or click anything the cleaner missed to hide it on this site. The page cannot receive your taps while the Zapper is open, so ads cannot open. Use Undo or Bigger to fix a pick.
            </p>
            <button type="button" class="besing-btn-zapper-launch" id="btn-launch-zapper">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              <span>Launch Element Zapper</span>
            </button>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row" style="margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#cbd5e1;">Zapped on this Website (${zapRows.length})</span>
              ${zapRows.length > 0 ? '<button type="button" class="besing-btn-sub-action" id="btn-clear-zapped" style="color:#f87171;">Clear All</button>' : ''}
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
              <span class="besing-section-title">Next Reminder</span>
              <span class="besing-shortcut-badge" id="badge-reminder-remaining" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:#38bdf8;">--:--</span>
            </div>
            <p id="txt-reminder-due" style="font-size:10px;color:#94a3b8;margin-top:4px;line-height:1.3;">Reading timer...</p>
          </div>

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
              When the time is up, a chat bubble pops up on the icon with Repeat and Off buttons. It remains until you choose an action. One timer is shared by every tab and site: Repeat or Off on any page applies everywhere within a few seconds.
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
      } else if (m.id === 'grok-exporter') {
        const onGrok = typeof m.isGrokHost === 'function' && m.isGrokHost();
        const hasConversation = onGrok && typeof m.getConversationId === 'function' && !!m.getConversationId();
        const includeThinking = cfg.includeThinking === true;
        const includeTimestamps = cfg.includeTimestamps === true;
        const includeSources = cfg.includeSources === true;
        const showFloatingButtons = cfg.showFloatingButtons !== false;
        const exportFormat = cfg.format === 'markdown' ? 'markdown' : 'text';
        const statusText = !onGrok
          ? 'Open a conversation on grok.com to export it.'
          : (hasConversation ? 'Exports every message on the branch you are viewing, including ones Grok has not rendered yet.' : 'Open a conversation (a chat, or a chat inside a project) to export it.');
        const disabledAttr = hasConversation ? '' : 'disabled';
        const disabledStyle = hasConversation ? '' : 'opacity:0.45;cursor:not-allowed;';

        specificControls = `
          <div class="besing-config-section">
            <p style="font-size:11px;color:#cbd5e1;line-height:1.4;margin:0;" id="grok-export-status">${statusText}</p>
            <div style="display:flex;gap:8px;">
              <button type="button" class="besing-btn-zapper-launch" id="btn-grok-copy" ${disabledAttr} style="flex:1;background:linear-gradient(135deg, rgba(56,189,248,0.2), rgba(99,102,241,0.25));border:1px solid rgba(56,189,248,0.4);color:#38bdf8;box-shadow:none;${disabledStyle}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Copy Full Chat</span>
              </button>
              <button type="button" class="besing-btn-zapper-launch" id="btn-grok-download" ${disabledAttr} style="flex:1;background:linear-gradient(135deg, rgba(16,185,129,0.2), rgba(20,184,166,0.25));border:1px solid rgba(16,185,129,0.4);color:#34d399;box-shadow:none;${disabledStyle}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span id="grok-download-label">${exportFormat === 'markdown' ? 'Download .md' : 'Download .txt'}</span>
              </button>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Output Format</span>
            </div>
            <div class="besing-segmented-group" id="group-grok-format" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${exportFormat === 'text' ? 'active' : ''}" data-format="text">Plain Text</button>
              <button type="button" class="besing-segmented-btn ${exportFormat === 'markdown' ? 'active' : ''}" data-format="markdown">Markdown</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.3;">
              Plain Text labels each turn [User] / [Grok] and keeps every line break. Markdown uses headings, but Markdown viewers join single line breaks.
            </p>
          </div>

          <div class="besing-config-section">
            <div class="besing-toggle-row-list">
              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Floating Buttons on Grok</div>
                  <div class="besing-toggle-desc">Shows Copy and Download buttons at the bottom right of conversation pages</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-floating" ${showFloatingButtons ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Thinking</div>
                  <div class="besing-toggle-desc">Adds Grok's reasoning trace as a collapsible block when available</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-thinking" ${includeThinking ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Timestamps</div>
                  <div class="besing-toggle-desc">Adds the send time next to each message heading</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-timestamps" ${includeTimestamps ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Web Sources</div>
                  <div class="besing-toggle-desc">Lists the web search results Grok used under each answer</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-sources" ${includeSources ? 'checked' : ''}>
                  <span class="besing-slider"></span>
                </label>
              </div>
            </div>
          </div>
        `;
      } else if (m.id === 'prevent-redirect') {
        const blockScripts = (cfg.blockScripts === 'third-party' || cfg.blockScripts === 'all') ? cfg.blockScripts : 'off';
        const lateStart = (cfg.lateStart === 'purge-timers' || cfg.lateStart === 'rebuild') ? cfg.lateStart : 'off';
        const allowlist = String(cfg.scriptAllowlist || '').replace(/[&<>"']/g, '');

        specificControls = `
          <div class="besing-config-section">
            <p style="font-size:11px;color:#94a3b8;line-height:1.4;margin:0;">${m.description || ''}</p>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Strict Protection</span>
              <span class="besing-shortcut-badge" style="color:#fbbf24;">Can break sites</span>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin:6px 0 0;line-height:1.35;">
              Off by default. For sites that still redirect. Turn on <strong>Lock Settings to This Site</strong> above first so other sites are not affected.
            </p>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Block Page Scripts</span>
              <span style="font-size:10px;color:#64748b;">Stopped on this page: ${BESBootLog.gated}</span>
            </div>
            <div class="besing-segmented-group" id="group-pr-gate" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${blockScripts === 'off' ? 'active' : ''}" data-gate="off">Off</button>
              <button type="button" class="besing-segmented-btn ${blockScripts === 'third-party' ? 'active' : ''}" data-gate="third-party">Other Sites</button>
              <button type="button" class="besing-segmented-btn ${blockScripts === 'all' ? 'active' : ''}" data-gate="all">All Scripts</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.35;">
              <strong>Other Sites</strong> stops scripts loaded from other domains, where most ad networks live. <strong>All Scripts</strong> runs the page with no scripts at all. Scripts are stopped before they run, so this works when BESing starts before the page does.
            </p>
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
              <input type="text" class="besing-test-input" id="input-pr-allowlist" placeholder="Always allow scripts from (e.g. cdnjs.cloudflare.com)" value="${allowlist}">
              <button type="button" class="besing-btn-sub-action" id="btn-save-pr-allowlist" style="align-self:flex-end;">Save Allowed Hosts</button>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">If BESing Starts Late</span>
            </div>
            <div class="besing-segmented-group" id="group-pr-late" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${lateStart === 'off' ? 'active' : ''}" data-late="off">Off</button>
              <button type="button" class="besing-segmented-btn ${lateStart === 'purge-timers' ? 'active' : ''}" data-late="purge-timers">Cancel Timers</button>
              <button type="button" class="besing-segmented-btn ${lateStart === 'rebuild' ? 'active' : ''}" data-late="rebuild">Rebuild Page</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.35;">
              When the browser starts BESing after the page has loaded, the page's scripts have already run. <strong>Cancel Timers</strong> stops the redirects they scheduled for later. <strong>Rebuild Page</strong> also swaps in a script-free copy of the page, which drops tap traps; site features that need scripts stop working. Applies from the next page load.
            </p>
          </div>
        `;
      } else {
        hasSettings = false;
        specificControls = `
          <div class="besing-config-section">
            <p style="font-size:11px;color:#94a3b8;line-height:1.4;">${m.description || 'No additional custom options for this script.'}</p>
            <div style="margin-top:12px;font-size:10px;color:#64748b;">
              Author: ${m.author || 'BESing Team'} | Category: ${m.category || 'General'}
            </div>
          </div>
        `;
      }

      // All four modes live here; the script list keeps its simpler off / on / site on cycle.
      const triButtonsHtml = `
        <button type="button" class="besing-tri-btn ${currentMode === 'off' ? 'active active-off' : ''}" data-mode="off" title="Turn off on every site">OFF</button>
        <button type="button" class="besing-tri-btn ${currentMode === 'site-off' ? 'active active-site-off' : ''}" data-mode="site-off" title="Turn off on ${currentHost} only; other sites keep their setting">SITE OFF</button>
        <button type="button" class="besing-tri-btn ${currentMode === 'site' ? 'active active-site' : ''}" data-mode="site" title="Run on ${currentHost} only; off on other sites">SITE ONLY</button>
        <button type="button" class="besing-tri-btn ${currentMode === 'on' ? 'active active-on' : ''}" data-mode="on" title="Run on every site">ON</button>
      `;

      // Settings lock: where this script's settings are read from and saved to on this site.
      const canLock = hasSettings && !GLOBAL_ONLY_SETTINGS.has(m.id);
      const isLocked = canLock && this.storage.isConfigLocked(m.id, currentHost);
      const lockHtml = canLock ? `
        <div class="besing-config-section">
          <div class="besing-section-header-row">
            <span class="besing-section-title">Lock Settings to This Site</span>
          </div>
          <div class="besing-segmented-group" id="group-config-scope" style="margin-top:8px;">
            <button type="button" class="besing-segmented-btn ${isLocked ? '' : 'active'}" data-scope="global">Global</button>
            <button type="button" class="besing-segmented-btn ${isLocked ? 'active' : ''}" data-scope="site">${currentHost}</button>
          </div>
          <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.35;">
            ${isLocked
              ? `Settings below are saved for <strong>${currentHost}</strong> only. They stay even when the script is turned off, until you switch back to Global, which discards them.`
              : 'Settings below apply on every site. Choose this site to give it its own copy.'}
          </p>
        </div>
      ` : '';

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
          ${lockHtml}
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

      // Settings lock. The running module is given the settings that now apply on this site.
      const groupScope = body.querySelector('#group-config-scope');
      if (groupScope) {
        groupScope.querySelectorAll('.besing-segmented-btn').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const lock = btn.getAttribute('data-scope') === 'site';
            if (lock === this.storage.isConfigLocked(m.id, currentHost)) return;
            await this.storage.setConfigLock(m.id, lock, currentHost);
            this.pushConfigToModule(m.id);
            this.renderBody();
          };
        });
      }

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
        const levelRange = body.querySelector('#ac-level-range');
        const levelBadge = body.querySelector('#ac-level-badge');
        const levelDetail = body.querySelector('#ac-level-detail');
        const statsEl = body.querySelector('#ac-stats');
        const btnClearAll = body.querySelector('#btn-clear-zapped');
        const currentHost = this.storage.getCurrentHost();
        const readCfg = () => this.storage.getScriptConfig(m.id, currentHost);

        const refreshStats = () => {
          if (!statsEl || !m.running || typeof m.getStats !== 'function') return;
          const st = m.getStats();
          const reasons = Object.entries(st.byReason).map(([k, v]) => `${k} ${v}`).join(', ');
          statsEl.textContent = `Hidden on this page: ${st.hidden}${reasons ? ` (${reasons})` : ''}. Unstuck: ${st.statics}. Main content: ${st.main}.`;
        };

        if (levelRange) {
          const showLevel = (v) => {
            const info = typeof m.describeLevel === 'function' ? m.describeLevel(v) : { name: '', detail: '' };
            if (levelBadge) levelBadge.textContent = `${Number(v).toFixed(1)} · ${info.name}`;
            if (levelDetail) levelDetail.textContent = `${info.detail} Higher levels include everything below them.`;
          };
          levelRange.oninput = (e) => showLevel(e.target.value);
          levelRange.onchange = async (e) => {
            showLevel(e.target.value);
            await this.applyScriptConfig(m.id, { level: Number(e.target.value) });
            setTimeout(refreshStats, 900);
          };
        }

        if (btnLaunch) {
          btnLaunch.onclick = () => {
            this.closeModal();
            if (typeof m.init === 'function' && !m.running) {
              m.init(readCfg());
              m.running = true;
            }
            if (typeof m.startZapper === 'function') {
              m.startZapper(async (patch) => {
                await this.applyScriptConfig(m.id, patch);
              });
            }
          };
        }

        if (btnClearAll) {
          btnClearAll.onclick = async () => {
            const cfgNow = readCfg();
            const zapped = { ...(cfgNow.zapped || {}) };
            delete zapped[currentHost];
            await this.applyScriptConfig(m.id, { zapped, blockedSelectors: [] });
            this.renderBody();
          };
        }

        body.querySelectorAll('.besing-btn-restore-zapped').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-index'));
            const cfgNow = readCfg();
            if (btn.getAttribute('data-kind') === 'legacy') {
              const list = Array.isArray(cfgNow.blockedSelectors) ? [...cfgNow.blockedSelectors] : [];
              if (idx < 0 || idx >= list.length) return;
              list.splice(idx, 1);
              await this.applyScriptConfig(m.id, { blockedSelectors: list });
            } else {
              const zapped = { ...(cfgNow.zapped || {}) };
              const list = Array.isArray(zapped[currentHost]) ? [...zapped[currentHost]] : [];
              if (idx < 0 || idx >= list.length) return;
              list.splice(idx, 1);
              if (list.length) zapped[currentHost] = list;
              else delete zapped[currentHost];
              await this.applyScriptConfig(m.id, { zapped });
            }
            this.renderBody();
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
        const badgeRemaining = body.querySelector('#badge-reminder-remaining');
        const txtDue = body.querySelector('#txt-reminder-due');

        // Live countdown from the shared timer. It ticks every second and re-reads the shared state
        // every 5 seconds, so Repeat or an interval change in any tab shows up here.
        let reminderState = m._state || null;
        let countdownTimer = null;
        const formatRemaining = (ms) => {
          const total = Math.max(0, Math.ceil(ms / 1000));
          const h = Math.floor(total / 3600);
          const mm = Math.floor((total % 3600) / 60);
          const ss = total % 60;
          const pad = (n) => String(n).padStart(2, '0');
          return h > 0 ? `${h}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
        };
        const paintCountdown = () => {
          if (!badgeRemaining || !badgeRemaining.isConnected) {
            if (countdownTimer) clearInterval(countdownTimer);
            countdownTimer = null;
            return;
          }
          const due = reminderState && !reminderState.off ? Number(reminderState.due) : 0;
          if (!m.running) {
            badgeRemaining.textContent = 'Off';
            if (txtDue) txtDue.textContent = 'Rest Reminder is off on this site. Switch it on to start the timer.';
          } else if (!due) {
            badgeRemaining.textContent = 'Off';
            if (txtDue) txtDue.textContent = 'No reminder is scheduled.';
          } else if (due <= Date.now()) {
            badgeRemaining.textContent = 'Now';
            if (txtDue) txtDue.textContent = 'Time for a break. Use Repeat or Off on the chat bubble.';
          } else {
            badgeRemaining.textContent = formatRemaining(due - Date.now());
            const at = new Date(due);
            if (txtDue) txtDue.textContent = `Due at ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}, shared by every tab and site.`;
          }
        };
        const refreshReminderState = async () => {
          try {
            const shared = await this.readSharedState(m.SHARED_KEY || 'rest_reminder', null);
            if (shared) reminderState = shared;
          } catch (e) {}
          paintCountdown();
        };
        if (badgeRemaining) {
          let ticks = 0;
          paintCountdown();
          refreshReminderState();
          countdownTimer = setInterval(() => {
            if (++ticks % 5 === 0) refreshReminderState();
            else paintCountdown();
          }, 1000);
        }

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
          // A new interval starts a new cycle; show it once the shared state is written.
          setTimeout(refreshReminderState, 300);
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
              m.showReminderChatBox({ preview: true });
            }
          };
        }
      } else if (m.id === 'grok-exporter') {
        const btnCopy = body.querySelector('#btn-grok-copy');
        const btnDownload = body.querySelector('#btn-grok-download');
        const statusEl = body.querySelector('#grok-export-status');
        const currentCfg = () => this.storage.getScriptConfig(m.id, this.storage.getCurrentHost());

        const runExport = async (btn, action) => {
          if (!btn || btn.disabled || typeof m[action] !== 'function') return;
          const label = btn.querySelector('span');
          const original = label ? label.textContent : '';
          btn.disabled = true;
          if (label) label.textContent = 'Working...';
          const result = await m[action](currentCfg());
          btn.disabled = false;
          if (label) label.textContent = original;
          if (statusEl && result) {
            const verb = action === 'copyConversation' ? 'Copied' : 'Downloaded';
            const branchNote = result.branchCount > 1 ? ` (current branch of ${result.branchCount})` : '';
            statusEl.textContent = `${verb} ${result.messageCount} messages from "${result.title}"${branchNote}.`;
          }
        };

        if (btnCopy) btnCopy.onclick = () => runExport(btnCopy, 'copyConversation');
        if (btnDownload) btnDownload.onclick = () => runExport(btnDownload, 'downloadConversation');

        const bindToggle = (selector, key) => {
          const chk = body.querySelector(selector);
          if (chk) {
            chk.onchange = async () => {
              await this.applyScriptConfig(m.id, { [key]: chk.checked });
            };
          }
        };
        const groupFormat = body.querySelector('#group-grok-format');
        const downloadLabel = body.querySelector('#grok-download-label');
        if (groupFormat) {
          groupFormat.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              const formatVal = btn.getAttribute('data-format');
              groupFormat.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (downloadLabel) downloadLabel.textContent = formatVal === 'markdown' ? 'Download .md' : 'Download .txt';
              await this.applyScriptConfig(m.id, { format: formatVal });
            };
          });
        }
        bindToggle('#chk-grok-floating', 'showFloatingButtons');
        bindToggle('#chk-grok-thinking', 'includeThinking');
        bindToggle('#chk-grok-timestamps', 'includeTimestamps');
        bindToggle('#chk-grok-sources', 'includeSources');
      } else if (m.id === 'prevent-redirect') {
        const bindChoice = (groupSelector, attr, key) => {
          const group = body.querySelector(groupSelector);
          if (!group) return;
          group.querySelectorAll('.besing-segmented-btn').forEach(btn => {
            btn.onclick = async () => {
              group.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              await this.applyScriptConfig(m.id, { [key]: btn.getAttribute(attr) });
            };
          });
        };
        bindChoice('#group-pr-gate', 'data-gate', 'blockScripts');
        bindChoice('#group-pr-late', 'data-late', 'lateStart');

        // Saved in the module's own normalized form, so the field shows exactly what the gate uses.
        const inAllow = body.querySelector('#input-pr-allowlist');
        const btnAllow = body.querySelector('#btn-save-pr-allowlist');
        if (inAllow && btnAllow) {
          btnAllow.onclick = async () => {
            const hosts = typeof m._normalizeConfig === 'function'
              ? m._normalizeConfig({ scriptAllowlist: inAllow.value }).scriptAllowlist
              : [];
            inAllow.value = hosts.join(', ');
            await this.applyScriptConfig(m.id, { scriptAllowlist: inAllow.value });
            btnAllow.textContent = 'Saved!';
            setTimeout(() => { btnAllow.textContent = 'Save Allowed Hosts'; }, 1500);
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
        :host { all: initial; position: fixed !important; top: 0 !important; left: 0 !important; width: var(--besing-host-w, 0px) !important; height: var(--besing-host-h, 0px) !important; transform: var(--besing-host-transform, none) !important; transform-origin: 0 0 !important; z-index: 2147483647 !important; pointer-events: none !important; overflow: visible !important; display: block !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }
        *, *::before, *::after { box-sizing: border-box !important; margin: 0; padding: 0; }
        svg { display: block !important; overflow: visible !important; flex-shrink: 0 !important; }
        svg:not(:root) { overflow: visible !important; }
        .besing-trigger { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483647; pointer-events: auto; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }
        @media (hover: hover) { .besing-trigger:hover { transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); } }
        .besing-trigger:active { cursor: grabbing; transform: scale(0.95); }
        .besing-trigger.folded-left { transform: translateX(-24px) !important; opacity: 0.88; }
        .besing-trigger.folded-right { transform: translateX(24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top { transform: translateY(-24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom { transform: translateY(24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top.folded-left { transform: translate(-24px, -24px) !important; opacity: 0.88; }
        .besing-trigger.folded-top.folded-right { transform: translate(24px, -24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom.folded-left { transform: translate(-24px, 24px) !important; opacity: 0.88; }
        .besing-trigger.folded-bottom.folded-right { transform: translate(24px, 24px) !important; opacity: 0.88; }
        @media (hover: hover) { .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover { transform: translate(0, 0) scale(1.08) !important; opacity: 1 !important; } }
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
        @media (hover: hover) { .besing-pet-face:hover .besing-pet-eye { animation: none; transform: scaleY(0.2) translateY(1px); } }
        @keyframes petBlink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
        .besing-bubble-wrapper { position: fixed; z-index: 2147483647; pointer-events: auto; animation: besingBubblePop 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-arrow { position: absolute; width: 14px; height: 14px; background: #0d1322; border: 1px solid rgba(255, 255, 255, 0.14); transform: rotate(45deg); z-index: 2; }
        .besing-bubble-arrow.arrow-bottom { bottom: -7px; border-top: none; border-left: none; }
        .besing-bubble-arrow.arrow-top { top: -7px; border-bottom: none; border-right: none; }
        .besing-bubble-panel { width: 390px !important; min-width: min(360px, calc(var(--besing-vw, 100vw) - 28px)) !important; max-width: calc(var(--besing-vw, 100vw) - 28px) !important; min-height: min(380px, calc(var(--besing-vh, 100vh) - 90px)) !important; max-height: min(520px, calc(var(--besing-vh, 100vh) - 90px)) !important; background: linear-gradient(180deg, rgba(16, 23, 38, 0.98) 0%, rgba(9, 13, 22, 0.99) 100%) !important; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.13) !important; border-radius: 18px !important; box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.75), 0 0 30px rgba(99, 102, 241, 0.16) !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; color: #e2e8f0 !important; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .besing-bubble-panel.is-expanded { width: 540px !important; min-height: min(500px, calc(var(--besing-vh, 100vh) - 28px)) !important; max-height: calc(var(--besing-vh, 100vh) * 0.8) !important; }
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
        .besing-site-rules-list { display: flex; flex-direction: column; gap: 8px; }
        .besing-site-group { flex-shrink: 0; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; overflow: hidden; }
        .besing-site-group-header { padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; transition: background 0.15s ease; }
        .besing-site-group-header:hover { background: rgba(255, 255, 255, 0.06); }
        .besing-site-chevron { transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); color: #94a3b8; flex-shrink: 0; }
        .besing-site-group.collapsed .besing-site-chevron { transform: rotate(-90deg); }
        .besing-site-group.collapsed .besing-site-subrules { display: none; }
        .besing-site-group.collapsed .besing-site-group-header { border-bottom: none; }
        .besing-site-rule-count { font-size: 10px; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 6px; border-radius: 999px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .besing-site-group-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; font-weight: 700; color: #f1f5f9; font-family: monospace; }
        .besing-site-host { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .besing-site-rule-count, .besing-btn-del-site { flex-shrink: 0; white-space: nowrap; }
        .besing-btn-del-site { background: transparent; border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 5px; cursor: pointer; transition: all 0.15s ease; }
        .besing-btn-del-site:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }
        .besing-site-subrules { display: flex; flex-direction: column; padding: 4px 10px; }
        .besing-site-rule-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
        .besing-site-rule-row:last-child { border-bottom: none; }
        .besing-site-rule-info { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }
        .besing-site-rule-name { font-size: 11px; font-weight: 500; color: #e2e8f0; }
        .besing-site-rule-tag { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px; }
        .besing-site-rule-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
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
        .besing-secondary-top-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 8px; width: 100%; }
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
        .besing-slider-range.ac-level-range { accent-color: #ef4444; }
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

  // Single-instance guard. A second copy can arrive from the same script running twice, a second
  // install (Stable + Packed, GitHub + Greasy Fork), or the extension alongside a userscript.
  // 1. Same JS world: an instance created for this document wins, mounted or not.
  const existingApp = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                      (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
  if (existingApp && !existingApp.disposed && existingApp.bootDocument === document) {
    console.warn('[BESing] An instance already owns this page. Skipping duplicate initialization.');
    BESBootLog.record('skipped', { ...describeEnvironment(), reason: 'same-world instance exists' });
    return;
  }
  // An instance left over from a previous document (WebKit can keep the global across reloads) is shut down fully.
  let disposedStale = false;
  if (existingApp && !existingApp.disposed && typeof existingApp.dispose === 'function') {
    try { existingApp.dispose(); } catch (e) {}
    disposedStale = true;
  }
  // 2. Other JS worlds: ask whether a live owner exists. Dispatch is synchronous, so two copies
  // starting at the same moment still run one after the other and only the first claims the page.
  let claimedElsewhere = false;
  try {
    claimedElsewhere = !document.dispatchEvent(new CustomEvent(CLAIM_EVENT, { cancelable: true }));
  } catch (e) {}
  if (claimedElsewhere) {
    console.warn('[BESing] Another BESing copy (different script or extension) already owns this page. Skipping.');
    BESBootLog.record('skipped', { ...describeEnvironment(), reason: 'another world claimed the page' });
    return;
  }

  const app = new BESManagerApp();
  document.addEventListener(CLAIM_EVENT, (e) => {
    if (!app.disposed) e.preventDefault();
  });
  app.isPacked = !BESUpdater.isStableLoader();
  try {
    window.__BESING_INSTANCE__ = app;
    if (typeof unsafeWindow !== 'undefined') unsafeWindow.__BESING_INSTANCE__ = app;
  } catch (e) {}
  BESBootLog.record('start', describeEnvironment());
  if (disposedStale) BESBootLog.event('disposed instance left from a previous document');

  // Blocked redirects, so a late load shows whether protection still caught something.
  let blockedLogged = 0;
  window.addEventListener('besing:redirect-blocked', (e) => {
    if (++blockedLogged > 10) return;
    try {
      const d = (e && e.detail) || {};
      let where = String(d.url || '');
      try { where = new URL(where, location.href).host || where; } catch (x) {}
      BESBootLog.event(`blocked ${d.reason || '?'}: ${where.slice(0, 60)}`);
    } catch (err) {}
  });

  const hostOf = (url) => {
    let where = String(url || '');
    try { where = new URL(where, location.href).host || where; } catch (x) {}
    return where.slice(0, 60);
  };

  // Script gate (strict mode): counted from every JS world, the first few logged by host.
  window.addEventListener('besing:scripts-gated', (e) => {
    BESBootLog.gated++;
    if (BESBootLog.gated > 5) return;
    try { BESBootLog.event(`gated script: ${hostOf(e && e.detail && e.detail.url)}`); } catch (err) {}
  });

  // Off-site navigations the browser would not let Prevent Redirect cancel.
  let missedLogged = 0;
  window.addEventListener('besing:redirect-missed', (e) => {
    if (++missedLogged > 5) return;
    try {
      const d = (e && e.detail) || {};
      BESBootLog.event(`MISSED ${d.reason || 'redirect'}: ${hostOf(d.url)}`);
    } catch (err) {}
  });

  // Strict late-start handling. A timer purge also cancels the boot log's pending write, and a page
  // rebuild replaces <html>, so the DOM observer and the widget are re-attached to the new page.
  window.addEventListener('besing:late-start-handled', (e) => {
    const d = (e && e.detail) || {};
    BESBootLog.rearm();
    BESBootLog.event(`late start (${d.ready || '?'}): ${d.action}, timers up to id ${d.timersUpTo}${d.rebuilt ? ', page rebuilt without scripts' : ''}`);
    if (d.rebuilt) app.onPageRebuilt();
  });

  // 1. Synchronously arm security shields at document-start before yielding to event loop
  app.initPreemptiveShields();

  // 2. Initialize storage and load remaining active modules with resilient fallback
  app.init().catch(err => {
    console.error('[BESing] Storage init error:', err);
    BESBootLog.error('init', err);
  }).finally(() => {
    app.ensureMounted('init-finally');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      BESBootLog.event('DOMContentLoaded');
      app.ensureMounted('DOMContentLoaded');
    });
  } else {
    app.ensureMounted('already-' + document.readyState);
  }

  window.addEventListener('load', () => {
    BESBootLog.event('load');
    app.ensureMounted('load');
    BESBootLog.check('after load');
  });

  // Mobile iPad / WebKit tab suspension and bfcache lifecycle recovery
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) BESBootLog.event('pageshow from back/forward cache');
    app.ensureMounted('pageshow');
  });

  window.addEventListener('pagehide', (e) => {
    BESBootLog.event(e.persisted ? 'pagehide into back/forward cache' : 'pagehide');
    BESBootLog.persist();
  });

  document.addEventListener('visibilitychange', () => {
    BESBootLog.event(`visibility ${document.visibilityState}`);
    if (document.visibilityState === 'visible') {
      app.ensureMounted('visible');
    }
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      app.clampWidgetPosition();
      app.ensureMounted('orientation');
    }, 200);
  });

  // Emergency 3-finger tap on mobile/tablet to pull up icon if lost
  window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 3) {
      console.log('[BESing] 3-finger tap detected: pulling up widget icon');
      BESBootLog.event('3-finger pull-up');
      app.pullUpIcon();
    }
  }, { passive: true });

  setTimeout(() => {
    app.ensureMounted('failsafe-1s');
  }, 1000);

  // What the user should be seeing a few seconds in: catches a widget that mounted but is hidden,
  // detached or off-screen, and modules whose page hooks went missing.
  setTimeout(() => BESBootLog.check('check@3s'), 3000);
  setTimeout(() => BESBootLog.check('check@10s'), 10000);
})();
