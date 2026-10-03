/**
 * BESing (Browser Extension Script) - Core Main Orchestrator
 * Integrates storage, registry, sync engine, and Shadow DOM UI.
 */
import { BESAdapter } from './core/adapter.js';
import { BESStorage } from './core/storage.js';
import { BESRegistry } from './core/registry.js';
import { BESSyncEngine } from './core/sync.js';
import { BESWidget } from './ui/widget.js';
import { BESMenu } from './ui/menu.js';
import { ReadingAssistantModule } from './modules/reading-assistant.js';
import { DarkDimmerModule } from './modules/dark-dimmer.js';
import { QuickCopyModule } from './modules/quick-copy.js';
import { ColorChangeModule } from './modules/color-change.js';
import { TextSizeControlModule } from './modules/text-size-control.js';
import { ForceCopyModule } from './modules/force-copy.js';

export class BESManager {
  constructor() {
    this.storage = new BESStorage();
    this.registry = new BESRegistry(this.storage);
    this.syncEngine = new BESSyncEngine({
      storage: this.storage,
      registry: this.registry,
      onStateChanged: () => {
        this._updateWidgetBadge();
        if (this.menu) this.menu._renderCurrentView();
      }
    });
    this.hostElement = null;
    this.shadowRoot = null;
    this.widget = null;
    this.menu = null;
    this.isBlocked = false;
    this._cssContent = '';
  }

  setStyles(css) {
    this._cssContent = css;
  }

  async start() {
    await this.storage.init();

    // Auto-install bundled modules
    this.registry.register(ReadingAssistantModule);
    this.registry.register(DarkDimmerModule);
    this.registry.register(QuickCopyModule);
    this.registry.register(ColorChangeModule);
    this.registry.register(TextSizeControlModule);
    this.registry.register(ForceCopyModule);

    // Register emergency shortcut (Alt + Shift + B)
    this._setupGlobalShortcut();

    // Register Greasemonkey menu commands
    BESAdapter.registerMenuCommand('BESing: Open Manager / Settings', () => {
      this.openManager(this.isBlocked ? 'settings' : 'extensions');
    });

    // Check if current site is blocked
    if (this.storage.isCurrentSiteBlocked()) {
      this.isBlocked = true;
      console.log(`[BESing] Inactive on ${window.location.hostname} (Site disabled).`);
      return;
    }

    this._mount();
  }

  async _mount() {
    if (this.hostElement) return;

    const docRoot = document.body || document.documentElement;
    if (!docRoot) return;

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
    this.hostElement = host;

    const shadow = host.attachShadow({ mode: 'open' });
    this.shadowRoot = shadow;

    this._injectStyles(shadow);

    const context = {
      storage: this.storage,
      adapter: BESAdapter,
      syncEngine: this.syncEngine,
      manager: this
    };

    // Render Draggable & Edge-Folding Widget
    this.widget = new BESWidget({
      storage: this.storage,
      onClick: () => {
        if (this.menu) {
          this.menu.close();
          this.menu = null;
        } else {
          this.openManager('extensions');
        }
      }
    });

    this.widget.render(shadow);
    this._updateWidgetBadge();

    // Start all enabled sub-scripts on this site
    await this.registry.startEnabledModules(context);

    // Start auto-sync loop with AI agent
    this.syncEngine.startAutoSync(2500);
  }

  async teardown() {
    this.isBlocked = true;
    this.syncEngine.stopAutoSync();
    await this.registry.stopAll();

    if (this.menu) {
      this.menu.destroy();
      this.menu = null;
    }

    if (this.widget) {
      this.widget.destroy();
      this.widget = null;
    }

    if (this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
      this.shadowRoot = null;
    }
  }

  openManager(view = 'extensions') {
    if (!this.shadowRoot) {
      const docRoot = document.body || document.documentElement;
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
      if (docRoot) docRoot.appendChild(host);
      this.hostElement = host;
      this.shadowRoot = host.attachShadow({ mode: 'open' });
      this._injectStyles(this.shadowRoot);
    }

    if (this.menu) {
      this.menu.destroy();
    }

    const context = {
      storage: this.storage,
      adapter: BESAdapter,
      syncEngine: this.syncEngine,
      manager: this
    };

    this.menu = new BESMenu({
      registry: this.registry,
      storage: this.storage,
      syncEngine: this.syncEngine,
      widget: this.widget,
      context: context,
      onClose: () => {
        this.menu = null;
        this._updateWidgetBadge();
        if (this.storage.isCurrentSiteBlocked()) {
          this.teardown();
        }
      },
      onDisableCurrentSite: async (host) => {
        await this.teardown();
      },
      onThemeChanged: (theme) => {
        if (this.widget) {
          this.widget.setTheme(theme);
        }
      },
      onSitesChanged: async (unblockedHost, action) => {
        if (action === 'unblock' && unblockedHost.toLowerCase() === window.location.hostname.toLowerCase()) {
          this.isBlocked = false;
          if (!this.widget) {
            this.widget = new BESWidget({
              storage: this.storage,
              onClick: () => this.openManager('extensions')
            });
            this.widget.render(this.shadowRoot);
            this._updateWidgetBadge();
            await this.registry.startEnabledModules(context);
          }
        }
      }
    });

    this.menu.render(this.shadowRoot, view);
  }

  _updateWidgetBadge() {
    if (!this.widget) return;
    const activeCount = this.registry.getAll().filter(m => m.enabled).length;
    this.widget.updateActiveCount(activeCount);
  }

  _setupGlobalShortcut() {
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        const initialView = this.storage.isCurrentSiteBlocked() ? 'settings' : 'extensions';
        this.openManager(initialView);
      }
    });
  }

  _injectStyles(targetShadow) {
    const style = document.createElement('style');
    style.textContent = this._cssContent || this._getDefaultStyles();
    targetShadow.appendChild(style);
  }

  _getDefaultStyles() {
    return `
      :host { all: initial; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; overflow: visible !important; display: block !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box !important; margin: 0; padding: 0; }
      svg { display: block !important; overflow: visible !important; flex-shrink: 0 !important; }
      svg:not(:root) { overflow: visible !important; }
      .besing-trigger { position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483647; pointer-events: auto; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }
      .besing-trigger:hover { transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); }
      .besing-trigger:active { cursor: grabbing; transform: scale(0.95); }
      .besing-trigger.folded-right { transform: translateX(24px) !important; opacity: 0.88; }
      .besing-trigger.folded-left { transform: translateX(-24px) !important; opacity: 0.88; }
      .besing-trigger.folded-top { transform: translateY(-24px) !important; opacity: 0.88; }
      .besing-trigger.folded-bottom { transform: translateY(24px) !important; opacity: 0.88; }
      .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover { transform: translate(0, 0) scale(1.08) !important; opacity: 1 !important; }
      .besing-trigger.folded-right::before { content: ""; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; }
      .besing-trigger.folded-left::after { content: ""; position: absolute; right: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; }
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
      .besing-btn-icon { background: transparent; border: none; color: #94a3b8; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
      .besing-btn-icon:hover { background: rgba(255, 255, 255, 0.08); color: #f8fafc; }
      .besing-btn-icon.active { background: rgba(99, 102, 241, 0.25); color: #818cf8; }
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
      @keyframes besingBubblePop { 0% { opacity: 0; transform: scale(0.92) translateY(6px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
    `;
  }
}
