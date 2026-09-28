/**
 * BESing - Full Targeted Agent Sync Engine
 * Enables real-time bi-directional telemetry, script content retrieval,
 * dynamic script insertion, and remote toggle execution via /api/sync.
 */

export class BESSyncEngine {
  constructor({ storage, registry, onStateChanged }) {
    this.storage = storage;
    this.registry = registry;
    this.onStateChanged = onStateChanged;
    this.lastSyncTime = null;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'connected' | 'error'
    this.lastError = null;
    this._pollingTimer = null;
    this._isPolling = false;
  }

  async getAgentConfig() {
    const settings = await this.storage.getSettings();
    return {
      agentUrl: (settings.agentUrl || 'http://127.0.0.1:8765/api/sync').replace(/\/+$/, ''),
      authToken: settings.authToken || '',
      autoSync: settings.autoSync !== false // default true for active sync
    };
  }

  /**
   * Start auto-sync heartbeat loop
   */
  startAutoSync(intervalMs = 2500) {
    if (this._pollingTimer) clearInterval(this._pollingTimer);
    this._isPolling = true;

    // Run first sync immediately
    this.syncNow();

    this._pollingTimer = setInterval(async () => {
      if (!this._isPolling) return;
      await this.syncNow();
    }, intervalMs);
  }

  stopAutoSync() {
    this._isPolling = false;
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }

  /**
   * Execute full two-way sync: push current state & script contents, then pull & execute pending commands
   */
  async syncNow() {
    const pushResult = await this.push();
    if (!pushResult.ok) return pushResult;
    const pullResult = await this.pull();
    return { ok: pullResult.ok, pushResult, pullResult };
  }

  /**
   * Push live state, active status list, and full script content to the agent
   */
  async push() {
    const config = await this.getAgentConfig();
    try {
      const allModules = this.registry.getAll();
      const serializedExtensions = allModules.map(m => ({
        id: m.id,
        name: m.name,
        version: m.version,
        enabled: Boolean(m.enabled),
        description: m.description,
        category: m.category || 'General',
        author: m.author || 'BESing',
        // Extract script code for remote agent inspection
        code: typeof m.init === 'function' ? m.init.toString() : (m.code || ''),
        destroyCode: typeof m.destroy === 'function' ? m.destroy.toString() : (m.destroyCode || '')
      }));

      const payload = {
        site: window.location.hostname,
        url: window.location.href,
        title: document.title,
        extensions: serializedExtensions,
        blockedSites: this.storage.getBlockedSites(),
        timestamp: Date.now()
      };

      const res = await fetch(`${config.agentUrl}/push`, {
        method: 'POST',
        headers: this._getHeaders(config.authToken),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000)
      });

      if (!res.ok) throw new Error(`Push HTTP ${res.status}`);
      this.syncStatus = 'connected';
      this.lastError = null;
      return { ok: true };
    } catch (err) {
      this.syncStatus = 'error';
      this.lastError = err.message;
      return { ok: false, error: err.message };
    }
  }

  /**
   * Pull pending agent commands (insert script, modify script, set status on/off) and execute them live
   */
  async pull() {
    const config = await this.getAgentConfig();
    try {
      const res = await fetch(`${config.agentUrl}/pull`, {
        method: 'POST',
        headers: this._getHeaders(config.authToken),
        body: JSON.stringify({ site: window.location.hostname, timestamp: Date.now() }),
        signal: AbortSignal.timeout(4000)
      });

      if (!res.ok) throw new Error(`Pull HTTP ${res.status}`);
      const data = await res.json();
      const commands = data.commands || [];

      let executedCount = 0;
      for (const cmd of commands) {
        await this._executeCommand(cmd);
        executedCount++;
      }

      this.lastSyncTime = Date.now();
      this.syncStatus = 'connected';
      this.lastError = null;

      if (executedCount > 0 && typeof this.onStateChanged === 'function') {
        this.onStateChanged();
      }

      return { ok: true, executedCount, commands };
    } catch (err) {
      this.syncStatus = 'error';
      this.lastError = err.message;
      return { ok: false, error: err.message };
    }
  }

  /**
   * Execute an incoming agent command in the browser
   */
  async _executeCommand(cmd) {
    if (!cmd || !cmd.action) return;
    console.log('[BESing Agent Sync] Executing remote agent command:', cmd);

    // 1. Toggle extension ON or OFF remotely
    if (cmd.action === 'set_status') {
      const { id, enabled } = cmd;
      if (id) {
        await this.registry.toggleModule(id, Boolean(enabled), { storage: this.storage });
        console.log(`[BESing Agent Sync] Set extension '${id}' status to ${enabled ? 'ON' : 'OFF'}`);
      }
    }

    // 2. Dynamically insert a new script or modify an existing script
    if (cmd.action === 'insert_script' || cmd.action === 'modify_script' || cmd.action === 'upsert_script') {
      const s = cmd.script || cmd;
      if (s && s.id) {
        let initFn = s.init;
        let destroyFn = s.destroy;

        // If code is provided as string, safely bind function
        if (typeof s.code === 'string') {
          try {
            initFn = new Function(s.code);
          } catch (e) {
            console.error('[BESing Agent Sync] Error compiling script init:', e);
          }
        }
        if (typeof s.destroyCode === 'string') {
          try {
            destroyFn = new Function(s.destroyCode);
          } catch (e) {
            console.error('[BESing Agent Sync] Error compiling script destroy:', e);
          }
        }

        const scriptDef = {
          id: s.id,
          name: s.name || s.id,
          version: s.version || '1.0.0',
          description: s.description || 'Agent remote script',
          category: s.category || 'Agent Scripts',
          author: s.author || 'AI Agent',
          enabled: s.enabled !== false,
          icon: s.icon || `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,
          matches: s.matches || ['*'],
          code: s.code,
          destroyCode: s.destroyCode,
          init: initFn || (() => {}),
          destroy: destroyFn || (() => {})
        };

        this.registry.registerDynamicScript(scriptDef);
        console.log(`[BESing Agent Sync] Dynamically registered/modified script: '${s.id}'`);
      }
    }
  }

  _getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }
}
