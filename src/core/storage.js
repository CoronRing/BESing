/**
 * BESing - State and Persistent Storage Layer
 * Supports 3-stage toggles (OFF / SITE / ON) and Site-Isolated Script Configs.
 */
import { BESAdapter } from './adapter.js';

const STORAGE_KEYS = {
  SITE_RULES: 'site_rules',
  ENABLED_SCRIPTS: 'enabled_scripts',
  SCRIPT_CONFIGS: 'script_configs',
  WIDGET_POS: 'widget_position',
  SETTINGS: 'global_settings'
};

export class BESStorage {
  constructor() {
    const readLocal = (k, def) => {
      try {
        const item = window.localStorage.getItem('besing_' + k);
        return (item !== null && item !== undefined) ? JSON.parse(item) : def;
      } catch (e) {
        return def;
      }
    };

    this.siteRules = readLocal(STORAGE_KEYS.SITE_RULES, {});
    this.enabledScripts = readLocal(STORAGE_KEYS.ENABLED_SCRIPTS, { 'prevent-redirect': true });
    if (this.enabledScripts['prevent-redirect'] === undefined) {
      this.enabledScripts['prevent-redirect'] = true;
    }
    this.scriptConfigs = readLocal(STORAGE_KEYS.SCRIPT_CONFIGS, {});
    this.widgetPos = readLocal(STORAGE_KEYS.WIDGET_POS, null);
    this.settings = {
      theme: 'cyber-pet',
      agentUrl: 'http://127.0.0.1:8765/api/sync',
      authToken: '',
      updateChannel: 'github',
      autoCheckUpdates: true,
      ...readLocal(STORAGE_KEYS.SETTINGS, {})
    };
    this._isInitialized = false;
  }

  async init() {
    if (this._isInitialized) return;

    const data = await BESAdapter.getAll({
      [STORAGE_KEYS.SITE_RULES]: this.siteRules || {},
      [STORAGE_KEYS.ENABLED_SCRIPTS]: this.enabledScripts || {},
      [STORAGE_KEYS.SCRIPT_CONFIGS]: this.scriptConfigs || {},
      [STORAGE_KEYS.WIDGET_POS]: this.widgetPos,
      [STORAGE_KEYS.SETTINGS]: this.settings || {}
    });

    this.siteRules = (data[STORAGE_KEYS.SITE_RULES] && typeof data[STORAGE_KEYS.SITE_RULES] === 'object') ? data[STORAGE_KEYS.SITE_RULES] : {};
    this.enabledScripts = (data[STORAGE_KEYS.ENABLED_SCRIPTS] && typeof data[STORAGE_KEYS.ENABLED_SCRIPTS] === 'object') ? data[STORAGE_KEYS.ENABLED_SCRIPTS] : {};
    if (this.enabledScripts['prevent-redirect'] === undefined) {
      this.enabledScripts['prevent-redirect'] = true;
    }
    this.scriptConfigs = (data[STORAGE_KEYS.SCRIPT_CONFIGS] && typeof data[STORAGE_KEYS.SCRIPT_CONFIGS] === 'object') ? data[STORAGE_KEYS.SCRIPT_CONFIGS] : {};
    if (data[STORAGE_KEYS.WIDGET_POS]) {
      this.widgetPos = data[STORAGE_KEYS.WIDGET_POS];
    }
    this.settings = { ...this.settings, ...(data[STORAGE_KEYS.SETTINGS] || {}) };

    this._isInitialized = true;
  }

  getCurrentHost() {
    return (window.location.hostname || 'localhost').toLowerCase().trim();
  }

  isCurrentSiteBlocked() {
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
    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
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
      // Global ON: active across all sites by default; remove any site-specific override for current site
      this.enabledScripts[scriptId] = true;
      delete this.siteRules[h].scripts[scriptId];
    } else if (mode === 'site') {
      // Active on this site only
      this.siteRules[h].scripts[scriptId] = true;
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
    await BESAdapter.set(STORAGE_KEYS.ENABLED_SCRIPTS, this.enabledScripts);
    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
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
    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
  }

  async removeSiteOverride(scriptId, host) {
    const h = (host || '').toLowerCase().trim();
    if (!h || !this.siteRules[h]) return;
    if (this.siteRules[h].scripts) delete this.siteRules[h].scripts[scriptId];
    if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
    this.cleanupSiteRule(h);
    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
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
      await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
    } else {
      this.scriptConfigs[scriptId] = { ...(this.scriptConfigs[scriptId] || {}), ...patch };
      await BESAdapter.set(STORAGE_KEYS.SCRIPT_CONFIGS, this.scriptConfigs);
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
    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
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

    await BESAdapter.set(STORAGE_KEYS.SITE_RULES, this.siteRules);
  }

  getAllSiteRules() {
    return this.siteRules || {};
  }

  getWidgetPosition() {
    return this.widgetPos;
  }

  async setWidgetPosition(pos) {
    this.widgetPos = pos;
    await BESAdapter.set(STORAGE_KEYS.WIDGET_POS, pos);
  }

  getTheme() {
    return this.settings.theme || 'cyber-pet';
  }

  async setTheme(theme) {
    this.settings.theme = theme;
    await BESAdapter.set(STORAGE_KEYS.SETTINGS, this.settings);
  }

  async updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await BESAdapter.set(STORAGE_KEYS.SETTINGS, this.settings);
  }
}
