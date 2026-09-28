/**
 * BESing - Script / Extension Registry & Lifecycle Manager
 * Handles auto-installation, on/off toggles, and runtime execution.
 */

export class BESRegistry {
  constructor(storage) {
    this.storage = storage;
    this.modules = new Map(); // id -> module definition
    this.activeInstances = new Map(); // id -> cleanup/destroy function or state
  }

  /**
   * Register (auto-install) a module into the manager.
   */
  register(moduleDef) {
    if (!moduleDef || !moduleDef.id) {
      console.error('[BESing Registry] Invalid module definition:', moduleDef);
      return;
    }

    this.modules.set(moduleDef.id, {
      ...moduleDef,
      enabled: this.storage.isScriptEnabled(moduleDef.id, moduleDef.enabled ?? true)
    });
  }

  /**
   * Register or update a dynamic script pushed from an authorized agent.
   */
  registerDynamicScript(payload) {
    if (!payload || !payload.id) return;
    const existing = this.modules.get(payload.id);

    const moduleDef = {
      id: payload.id,
      name: payload.name || payload.id,
      version: payload.version || '1.0.0-dynamic',
      description: payload.description || 'Dynamic agent script',
      category: payload.category || 'Agent Scripts',
      author: payload.author || 'AI Agent',
      enabled: payload.enabled ?? (existing ? existing.enabled : true),
      icon: payload.icon || `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>`,
      matches: payload.matches || ['*'],
      init: payload.init || (() => { console.log(`[Dynamic Script] ${payload.id} active`); }),
      destroy: payload.destroy || (() => {})
    };

    // If active, stop old version before replacing
    if (this.activeInstances.has(payload.id)) {
      this._stopModule(existing);
    }

    this.register(moduleDef);

    // If enabled, boot the new dynamic script
    if (moduleDef.enabled && this._matchesHost(moduleDef.matches, window.location.hostname)) {
      this._startModule(moduleDef, { storage: this.storage });
    }
  }

  /**
   * Get all registered modules.
   */
  getAll() {
    return Array.from(this.modules.values()).map(mod => ({
      ...mod,
      enabled: this.storage.isScriptEnabled(mod.id, mod.enabled ?? true)
    }));
  }

  /**
   * Get a module by ID.
   */
  get(id) {
    const mod = this.modules.get(id);
    if (!mod) return null;
    return {
      ...mod,
      enabled: this.storage.isScriptEnabled(mod.id, mod.enabled ?? true)
    };
  }

  /**
   * Boot up all currently enabled modules that match the current URL.
   */
  async startEnabledModules(context) {
    const currentHost = window.location.hostname;

    for (const mod of this.modules.values()) {
      const isEnabled = this.storage.isScriptEnabled(mod.id, mod.enabled ?? true);
      const matches = this._matchesHost(mod.matches, currentHost);

      if (isEnabled && matches && !this.activeInstances.has(mod.id)) {
        await this._startModule(mod, context);
      }
    }
  }

  /**
   * Toggle a module ON or OFF.
   */
  async toggleModule(id, isEnabled, context) {
    const mod = this.modules.get(id);
    if (!mod) return;

    await this.storage.setScriptEnabled(id, isEnabled);
    mod.enabled = isEnabled;

    if (isEnabled) {
      if (!this.activeInstances.has(id)) {
        await this._startModule(mod, context);
      }
    } else {
      if (this.activeInstances.has(id)) {
        await this._stopModule(mod);
      }
    }
  }

  /**
   * Stop all running modules (used when site is blocked or during teardown).
   */
  async stopAll() {
    for (const [id, mod] of this.modules.entries()) {
      if (this.activeInstances.has(id)) {
        await this._stopModule(mod);
      }
    }
  }

  async _startModule(mod, context) {
    try {
      if (typeof mod.init === 'function') {
        const result = await mod.init(context);
        this.activeInstances.set(mod.id, result || true);
      } else {
        this.activeInstances.set(mod.id, true);
      }
    } catch (err) {
      console.error(`[BESing Registry] Error starting module '${mod.id}':`, err);
    }
  }

  async _stopModule(mod) {
    try {
      if (typeof mod.destroy === 'function') {
        await mod.destroy();
      }
      this.activeInstances.delete(mod.id);
    } catch (err) {
      console.error(`[BESing Registry] Error stopping module '${mod.id}':`, err);
    }
  }

  _matchesHost(patterns, host) {
    if (!patterns || !patterns.length || patterns.includes('*') || patterns.includes('*://*/*')) {
      return true;
    }
    return patterns.some(pattern => {
      if (pattern === host) return true;
      if (pattern.startsWith('*.')) {
        const root = pattern.slice(2);
        return host === root || host.endsWith('.' + root);
      }
      return false;
    });
  }
}
