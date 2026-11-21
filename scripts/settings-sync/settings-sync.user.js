// ==UserScript==
// @name         Settings Sync
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Sync BESing script modes, configs, site rules, and pet theme across devices with UTC Last-Write-Wins conflict resolution.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SettingsSync = {
    id: 'settings-sync',
    name: 'Settings Sync',
    version: '1.0.0',
    description: 'Sync BESing script modes, configs, site rules, and pet theme across devices with UTC Last-Write-Wins conflict resolution.',
    category: 'Sync',

    NAMESPACE: 'settings',
    META_KEY: 'settings_sync_meta',
    EXCLUDED_SCRIPTS: ['settings-sync'],

    _config: null,
    _active: false,
    _syncing: false,
    _debounceTimer: null,
    _pollTimer: null,
    _boundMutated: null,
    _boundVisible: null,

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    async _readMeta() {
      const mgr = this._manager();
      const fallback = { lastServerTime: null, lastSyncAt: 0, lockUntil: 0, lastError: null, recentLog: [] };
      if (!mgr || typeof mgr.readSharedState !== 'function') return fallback;
      const m = await mgr.readSharedState(this.META_KEY, null);
      if (m && typeof m === 'object') {
        return Object.assign({}, fallback, m, { recentLog: Array.isArray(m.recentLog) ? m.recentLog : [] });
      }
      return fallback;
    },

    async _writeMeta(meta) {
      const mgr = this._manager();
      if (!mgr || typeof mgr.writeSharedState !== 'function') return;
      await mgr.writeSharedState(this.META_KEY, meta);
    },

    _collectLocalEntries(mgr, cfg, onlySinceMs = 0) {
      const st = mgr.storage;
      const tsMap = (st && st.settingsTimestamps && typeof st.settingsTimestamps === 'object') ? st.settingsTimestamps : {};
      const cloud = (mgr.cloud && typeof mgr.cloud.getConfig === 'function') ? mgr.cloud.getConfig() : {};
      const sender = (cloud.deviceName || 'Device').slice(0, 80);
      const entries = [];

      const syncModes = cfg.syncModes !== false;
      const syncConfigs = cfg.syncConfigs !== false;
      const syncSites = cfg.syncSites !== false;
      const syncTheme = cfg.syncTheme !== false;

      const pushEntry = (key, value, deleted = false) => {
        const ts = Number(tsMap[key]) || 0;
        // Skip untouched defaults unless we have a real timestamp or explicit tombstone.
        if (ts <= 0) return;
        if (onlySinceMs > 0 && ts <= onlySinceMs) return;
        entries.push({ key, value: deleted ? null : value, deleted, updated_ms: ts, updated_by: sender });
      };

      if (syncModes) {
        const enabled = st.enabledScripts || {};
        const seenIds = new Set([...Object.keys(enabled), ...Object.keys(tsMap).filter(k => k.startsWith('enabled:')).map(k => k.slice(8))]);
        seenIds.forEach(id => {
          if (!id || this.EXCLUDED_SCRIPTS.includes(id)) return;
          pushEntry(`enabled:${id}`, Boolean(enabled[id]), false);
        });
      }

      if (syncConfigs) {
        const cfgs = st.scriptConfigs || {};
        const seenIds = new Set([...Object.keys(cfgs), ...Object.keys(tsMap).filter(k => k.startsWith('config:')).map(k => k.slice(7))]);
        seenIds.forEach(id => {
          if (!id || this.EXCLUDED_SCRIPTS.includes(id)) return;
          const raw = cfgs[id];
          if (raw && typeof raw === 'object') {
            // Never sync device-local connection secrets or device labels inside script configs.
            const clean = Object.assign({}, raw);
            if (id === 'browser-sync') {
              delete clean.syncLink;
              delete clean.deviceName;
              delete clean.accountLabel;
            }
            pushEntry(`config:${id}`, clean, false);
          } else {
            pushEntry(`config:${id}`, null, true);
          }
        });
      }

      if (syncSites) {
        const rules = st.siteRules || {};
        const seenHosts = new Set([...Object.keys(rules), ...Object.keys(tsMap).filter(k => k.startsWith('site:')).map(k => k.slice(5))]);
        seenHosts.forEach(host => {
          if (!host) return;
          const rule = rules[host];
          if (rule && typeof rule === 'object') {
            pushEntry(`site:${host}`, rule, false);
          } else {
            pushEntry(`site:${host}`, null, true);
          }
        });
      }

      if (syncTheme) {
        const theme = (st.settings && st.settings.theme) ? String(st.settings.theme) : null;
        if (theme) pushEntry('ui:theme', theme, false);
      }

      return entries.slice(0, 100);
    },

    async _applyRemoteEntries(mgr, cfg, remoteEntries) {
      if (!Array.isArray(remoteEntries) || remoteEntries.length === 0) return { applied: 0, logLines: [] };
      const st = mgr.storage;
      if (!st.settingsTimestamps || typeof st.settingsTimestamps !== 'object') st.settingsTimestamps = {};

      const syncModes = cfg.syncModes !== false;
      const syncConfigs = cfg.syncConfigs !== false;
      const syncSites = cfg.syncSites !== false;
      const syncTheme = cfg.syncTheme !== false;

      let applied = 0;
      let rulesTouched = false;
      let settingsTouched = false;
      const logLines = [];

      for (let i = 0; i < remoteEntries.length; i++) {
        const e = remoteEntries[i];
        if (!e || typeof e.key !== 'string') continue;
        const remoteMs = Number(e.updated_ms) || 0;
        const localMs = Number(st.settingsTimestamps[e.key]) || 0;
        if (remoteMs <= localMs) continue;

        const key = e.key;
        const deleted = Boolean(e.deleted);
        const val = e.value;
        let didApply = false;

        if (key.startsWith('enabled:') && syncModes) {
          const id = key.slice(8);
          if (id && !this.EXCLUDED_SCRIPTS.includes(id)) {
            if (!st.enabledScripts) st.enabledScripts = {};
            st.enabledScripts[id] = Boolean(val);
            rulesTouched = true;
            didApply = true;
          }
        } else if (key.startsWith('config:') && syncConfigs) {
          const id = key.slice(7);
          if (id && !this.EXCLUDED_SCRIPTS.includes(id)) {
            if (!st.scriptConfigs) st.scriptConfigs = {};
            if (deleted || !val || typeof val !== 'object') {
              delete st.scriptConfigs[id];
            } else {
              const clean = Object.assign({}, val);
              if (id === 'browser-sync') {
                delete clean.syncLink;
                delete clean.deviceName;
                delete clean.accountLabel;
              }
              st.scriptConfigs[id] = clean;
            }
            rulesTouched = true;
            didApply = true;
          }
        } else if (key.startsWith('site:') && syncSites) {
          const host = key.slice(5);
          if (host) {
            if (!st.siteRules) st.siteRules = {};
            if (deleted || !val || typeof val !== 'object') {
              delete st.siteRules[host];
            } else {
              st.siteRules[host] = val;
            }
            rulesTouched = true;
            didApply = true;
          }
        } else if (key === 'ui:theme' && syncTheme) {
          if (typeof val === 'string' && val) {
            if (!st.settings) st.settings = {};
            st.settings.theme = val;
            settingsTouched = true;
            didApply = true;
          }
        }

        if (didApply) {
          st.settingsTimestamps[key] = remoteMs;
          applied++;
          const who = e.updated_by ? ` from ${e.updated_by}` : '';
          const timeStr = new Date(remoteMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          logLines.push(`${key}${deleted ? ' (removed)' : ''}${who} @ ${timeStr}`);
        }
      }

      if (applied > 0) {
        await st.persistFromCloudMerge({ rulesTouched, settingsTouched });
        if (rulesTouched && typeof mgr.refreshCurrentSiteModules === 'function') {
          mgr.refreshCurrentSiteModules({ fromSync: true });
        }
        if (settingsTouched && mgr.widgetEl && typeof mgr.updatePetIcon === 'function') {
          mgr.updatePetIcon(mgr.widgetEl);
        }
      }
      return { applied, logLines };
    },

    async syncNow({ full = false, force = true } = {}) {
      if (this._syncing) return { ok: true, busy: true };
      const mgr = this._manager();
      if (!mgr || !mgr.cloud || !mgr.cloud.isConfigured()) {
        return { ok: false, error: 'Cloud database not linked. Configure Sync Link in BESing Settings.' };
      }

      const meta = await this._readMeta();
      const now = Date.now();
      const cfg = this._config || {};
      const intervalMs = Math.max(2, Math.min(120, Number(cfg.pullIntervalMinutes) || 10)) * 60 * 1000;

      if (!force) {
        if (now - meta.lastSyncAt < intervalMs) return { ok: true, skipped: true, meta };
        if (meta.lockUntil && now < meta.lockUntil) return { ok: true, skipped: true, meta };
      }

      meta.lockUntil = now + 15000;
      await this._writeMeta(meta);

      this._syncing = true;
      try {
        // On full/manual sync, send all timestamped local keys so LWW resolves both ways cleanly.
        const entries = this._collectLocalEntries(mgr, cfg, 0);
        const res = await mgr.cloud.rpc('besing_kv_sync', {
          p_namespace: this.NAMESPACE,
          p_entries: entries,
          p_since: full ? null : meta.lastServerTime
        }, { trafficKind: 'pull' });

        if (!res || !res.ok) {
          throw new Error((res && res.error) || 'Settings sync RPC failed');
        }
        const data = res.data || {};
        const merged = await this._applyRemoteEntries(mgr, cfg, data.entries || []);

        const nextLog = [...merged.logLines, ...meta.recentLog].slice(0, 15);
        const nextMeta = {
          lastServerTime: data.server_time || new Date().toISOString(),
          lastSyncAt: Date.now(),
          lockUntil: 0,
          lastError: null,
          lastAccepted: Number(data.accepted) || 0,
          lastApplied: merged.applied,
          lastStaleIgnored: Number(data.stale_ignored) || 0,
          recentLog: nextLog
        };
        await this._writeMeta(nextMeta);
        return { ok: true, meta: nextMeta, applied: merged.applied, accepted: nextMeta.lastAccepted };
      } catch (err) {
        const cur = await this._readMeta();
        cur.lockUntil = 0;
        cur.lastError = err && err.message ? err.message : String(err);
        await this._writeMeta(cur);
        return { ok: false, error: cur.lastError, meta: cur };
      } finally {
        this._syncing = false;
      }
    },

    async getStatus() {
      const mgr = this._manager();
      const configured = Boolean(mgr && mgr.cloud && mgr.cloud.isConfigured());
      const meta = await this._readMeta();
      const trackedKeys = (mgr && mgr.storage && mgr.storage.settingsTimestamps)
        ? Object.keys(mgr.storage.settingsTimestamps).length
        : 0;
      return { ok: true, configured, enabled: this._active, trackedKeys, meta };
    },

    _schedulePush() {
      if (!this._active) return;
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._debounceTimer = null;
        if (this._active) this.syncNow({ full: false, force: true }).catch(() => {});
      }, 4500);
    },

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._active = true;

      // Initial delta sync shortly after boot (throttled across tabs via shared meta).
      setTimeout(() => {
        if (this._active) this.syncNow({ full: false, force: false }).catch(() => {});
      }, 2000);

      // Push shortly after local BESing setting mutations.
      this._boundMutated = () => this._schedulePush();
      window.addEventListener('besing:settings-mutated', this._boundMutated);

      // Re-check 10-min sync when tab becomes visible.
      this._boundVisible = () => {
        if (this._active && document.visibilityState === 'visible') {
          this.syncNow({ full: false, force: false }).catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this._boundVisible);

      this._pollTimer = setInterval(() => {
        if (this._active && document.visibilityState === 'visible') {
          this.syncNow({ full: false, force: false }).catch(() => {});
        }
      }, 60000);
    },

    onConfigChange(newConfig) {
      this._config = newConfig || {};
    },

    destroy() {
      this._active = false;
      if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      if (this._boundMutated) {
        window.removeEventListener('besing:settings-mutated', this._boundMutated);
        this._boundMutated = null;
      }
      if (this._boundVisible) {
        document.removeEventListener('visibilitychange', this._boundVisible);
        this._boundVisible = null;
      }
    }
  };

  if (typeof window !== 'undefined' && window.__BESING_REGISTER__) {
    window.__BESING_REGISTER__(SettingsSync);
  }
})();
