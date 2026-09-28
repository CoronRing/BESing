/**
 * BESing - State and Persistent Storage Layer
 */
import { BESAdapter } from './adapter.js';

const STORAGE_KEYS = {
  BLOCKED_SITES: 'blocked_sites',
  ENABLED_SCRIPTS: 'enabled_scripts',
  WIDGET_POS: 'widget_position',
  SETTINGS: 'global_settings'
};

export class BESStorage {
  constructor() {
    this._blockedSites = [];
    this._enabledScripts = {};
    this._widgetPosition = null;
    this._settings = {
      theme: 'cyber-pet', // 'cyber-pet' | 'orb' | 'crystal' | 'minimal'
      hotkey: 'Alt+Shift+B',
      agentUrl: 'http://127.0.0.1:8765/api/sync',
      authToken: '',
      autoSync: false
    };
    this._isInitialized = false;
  }

  /**
   * Load all cached state from persistent storage.
   */
  async init() {
    if (this._isInitialized) return;

    this._blockedSites = await BESAdapter.get(STORAGE_KEYS.BLOCKED_SITES, []);
    this._enabledScripts = await BESAdapter.get(STORAGE_KEYS.ENABLED_SCRIPTS, {});
    this._widgetPosition = await BESAdapter.get(STORAGE_KEYS.WIDGET_POS, null);
    
    const loadedSettings = await BESAdapter.get(STORAGE_KEYS.SETTINGS, {});
    this._settings = { ...this._settings, ...loadedSettings };

    // Validate blockedSites structure
    if (!Array.isArray(this._blockedSites)) {
      this._blockedSites = [];
    }

    this._isInitialized = true;
  }

  // --- Blocked Sites Management ---

  isHostBlocked(hostname = window.location.hostname) {
    const cleanHost = String(hostname).toLowerCase().trim();
    return this._blockedSites.some(item => item.host.toLowerCase() === cleanHost);
  }

  isCurrentSiteBlocked() {
    return this.isHostBlocked(window.location.hostname);
  }

  async blockSite(hostname = window.location.hostname) {
    const cleanHost = String(hostname).toLowerCase().trim();
    if (!cleanHost) return false;

    this._blockedSites = this._blockedSites.filter(item => item.host.toLowerCase() !== cleanHost);
    this._blockedSites.unshift({
      host: cleanHost,
      addedAt: Date.now()
    });

    await BESAdapter.set(STORAGE_KEYS.BLOCKED_SITES, this._blockedSites);
    return true;
  }

  async unblockSite(hostname) {
    const cleanHost = String(hostname).toLowerCase().trim();
    const prevCount = this._blockedSites.length;
    this._blockedSites = this._blockedSites.filter(item => item.host.toLowerCase() !== cleanHost);

    if (this._blockedSites.length !== prevCount) {
      await BESAdapter.set(STORAGE_KEYS.BLOCKED_SITES, this._blockedSites);
      return true;
    }
    return false;
  }

  getBlockedSites() {
    return [...this._blockedSites].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  // --- Script Enable/Disable Management ---

  isScriptEnabled(scriptId, defaultValue = true) {
    if (this._enabledScripts[scriptId] !== undefined) {
      return Boolean(this._enabledScripts[scriptId]);
    }
    return defaultValue;
  }

  async setScriptEnabled(scriptId, isEnabled) {
    this._enabledScripts[scriptId] = Boolean(isEnabled);
    await BESAdapter.set(STORAGE_KEYS.ENABLED_SCRIPTS, this._enabledScripts);
  }

  // --- Widget Position ---

  getWidgetPosition() {
    return this._widgetPosition;
  }

  async setWidgetPosition(pos) {
    this._widgetPosition = pos;
    await BESAdapter.set(STORAGE_KEYS.WIDGET_POS, pos);
  }

  // --- Global Settings & Themes ---

  getSettings() {
    return { ...this._settings };
  }

  async updateSettings(partial) {
    this._settings = { ...this._settings, ...partial };
    await BESAdapter.set(STORAGE_KEYS.SETTINGS, this._settings);
  }

  getTheme() {
    return this._settings.theme || 'cyber-pet';
  }

  async setTheme(themeName) {
    this._settings.theme = themeName;
    await this.updateSettings({ theme: themeName });
  }
}
