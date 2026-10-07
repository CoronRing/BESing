#!/usr/bin/env python3
"""
BESing Mega-File Autogenerator
Bundles all standalone scripts under `scripts/` into the monolithic `besing-manager.user.js`
for Greasy Fork and offline distribution.
All scripts are pre-installed and OFF by default.
"""

import os
import json
import re
from pathlib import Path

ROOT_DIR = Path(__file__).parent.resolve()
SCRIPTS_DIR = ROOT_DIR / "scripts"
USERSCRIPT_DIR = ROOT_DIR / "userscript"
MANIFEST_PATH = SCRIPTS_DIR / "SCRIPT_LIST.json"
TARGET_USER_JS = USERSCRIPT_DIR / "besing-manager.user.js"
TARGET_META_JS = USERSCRIPT_DIR / "besing-manager.meta.js"

VERSION = "1.7.6"

USER_SCRIPT_HEADER = f"""// ==UserScript==
// @name         BESing Packed
// @namespace    https://github.com/CoronRing/BESing
// @version      {VERSION}
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
"""

META_SCRIPT_CONTENT = f"""// ==UserScript==
// @name         BESing Packed
// @namespace    https://github.com/CoronRing/BESing
// @version      {VERSION}
// @description  Universal Browser Extension & Greasy Fork Script Manager (Packed Standalone) with 4-way edge folding, desktop pet themes, non-blocking anchored bubble menu, and bundled productivity tools.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js
// @downloadURL  https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js
// @run-at       document-start
// ==/UserScript==
"""

def extract_module_body(script_path: Path):
    content = script_path.read_text(encoding="utf-8")
    m = re.search(r'const\s+[A-Za-z0-9_]+\s*=\s*(\{[\s\S]*?\n  \});\s*(?:\n\s*if|\n\s*window|\Z)', content)
    if m:
        return m.group(1)
    
    # Fallback to general boundary match if formatting differs
    m2 = re.search(r'const\s+[A-Za-z0-9_]+\s*=\s*(\{[\s\S]*?\n\s*\});\s*(?:\n\s*if|\n\s*window|\Z)', content)
    if m2:
        return m2.group(1)
    return None

def build():
    print(f"[*] Reading scripts from {SCRIPTS_DIR}...")
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    modules_code = []
    for item in catalog:
        script_id = item["id"]
        script_file = SCRIPTS_DIR / script_id / f"{script_id}.user.js"
        if not script_file.exists():
            print(f"[!] Warning: {script_file} not found, skipping.")
            continue
        
        body = extract_module_body(script_file)
        if body:
            # Inject icon and author if not in body
            clean_icon = item.get("icon", "").replace("\n", "").replace('"', '\\"')
            desc = item.get("description", "").replace('"', '\\"')
            
            # Format object
            mod_js = f"""    // Module: {item['name']}
    (() => {{
      const mod = {body};
      mod.icon = "{clean_icon}";
      mod.author = "{item.get('author', 'BESing Team')}";
      mod.category = "{item.get('category', 'General')}";
      return mod;
    }})()"""
            modules_code.append(mod_js)
            print(f"  [+] Bundled: {item['name']} ({script_id})")

    modules_joined = ",\n\n".join(modules_code)

    full_script = f"""{USER_SCRIPT_HEADER}
(function () {{
  'use strict';

  // Userscript managers inject into every frame. Only the top frame gets the widget and menu;
  // child frames (ads, embeds) run the modules listed here and nothing else.
  const IS_TOP_FRAME = (() => {{
    try {{ return window.top === window.self; }} catch (e) {{ return false; }}
  }})();
  const FRAME_SAFE_MODULES = new Set(['prevent-redirect', 'force-copy']);

  // Ownership claim shared by every JS world (userscript sandboxes, extension content scripts, page).
  // Worlds do not share globals, and <html> may not exist yet at document-start, but they do share
  // event dispatch on `document`: the owner cancels this event, and a newcomer sees it was cancelled.
  const CLAIM_EVENT = 'besing:claim-page';
  const BOOT_LOG_KEY = 'boot_log';
  const BOOT_LOG_MIRROR_KEY = 'besing_boot_log_mirror';
  const BOOT_LOG_LIMIT = 20;
  const BOOT_LOG_MAX_EVENTS = 40;
  const BOOT_LOG_MAX_ERRORS = 12;

  const getLiveInstance = () => {{
    const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) ||
                 (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
    return inst && !inst.disposed ? inst : null;
  }};

  // 1. Unified Adapter Layer
  const BESAdapter = {{
    isGM: typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
    isExt: typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local,

    // `timeoutMs` bounds the wait for extension storage before falling back to the localStorage mirror.
    async get(key, defaultValue = null, timeoutMs = 350) {{
      if (this.isGM) {{
        try {{
          const val = GM_getValue(key, defaultValue);
          return val !== undefined ? val : defaultValue;
        }} catch (e) {{
          return defaultValue;
        }}
      }}
      if (this.isExt) {{
        return new Promise(resolve => {{
          let resolved = false;
          // Mobile Edge / WebKit timeout guard: 350ms race
          const timer = setTimeout(() => {{
            if (!resolved) {{
              resolved = true;
              try {{
                const item = window.localStorage.getItem('besing_' + key);
                resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
              }} catch (e) {{
                resolve(defaultValue);
              }}
            }}
          }}, timeoutMs);

          try {{
            chrome.storage.local.get([key], res => {{
              if (!resolved) {{
                resolved = true;
                clearTimeout(timer);
                if (chrome.runtime && chrome.runtime.lastError) {{
                  try {{
                    const item = window.localStorage.getItem('besing_' + key);
                    resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
                  }} catch (e) {{
                    resolve(defaultValue);
                  }}
                }} else {{
                  const val = (res && res[key] !== undefined) ? res[key] : defaultValue;
                  try {{
                    window.localStorage.setItem('besing_' + key, JSON.stringify(val));
                  }} catch (e) {{}}
                  resolve(val);
                }}
              }}
            }});
          }} catch (err) {{
            if (!resolved) {{
              resolved = true;
              clearTimeout(timer);
              try {{
                const item = window.localStorage.getItem('besing_' + key);
                resolve((item !== null && item !== undefined) ? JSON.parse(item) : defaultValue);
              }} catch (e) {{
                resolve(defaultValue);
              }}
            }}
          }}
        }});
      }}
      try {{
        const item = window.localStorage.getItem('besing_' + key);
        return (item !== null && item !== undefined) ? JSON.parse(item) : defaultValue;
      }} catch (e) {{
        return defaultValue;
      }}
    }},

    // How the last getAll() was answered, for the boot log: `source` is the backend
    // ('gm', 'ext', 'ext-timeout', 'ext-error' or 'local'), `found` lists the keys that existed
    // there, and `local` the keys taken from this site's localStorage mirror. Keys in neither
    // fell back to defaults. `lateMs` is set when extension storage answered after the timeout.
    lastLoad: null,

    async getAll(defaults = {{}}) {{
      const keys = Object.keys(defaults);
      const result = {{ ...defaults }};
      const t0 = Date.now();
      const local = [];

      // Pre-fill from localStorage synchronously
      for (const k of keys) {{
        try {{
          const item = window.localStorage.getItem('besing_' + k);
          if (item !== null && item !== undefined) {{
            result[k] = JSON.parse(item);
            local.push(k);
          }}
        }} catch (e) {{}}
      }}

      if (this.isGM) {{
        const found = [];
        for (const k of keys) {{
          try {{
            const val = GM_getValue(k, undefined);
            if (val !== undefined) {{
              result[k] = val;
              found.push(k);
            }}
          }} catch (e) {{}}
        }}
        this.lastLoad = {{ source: 'gm', ms: Date.now() - t0, found, local }};
        return result;
      }}

      if (this.isExt) {{
        const report = {{ source: 'ext', ms: null, found: [], local }};
        this.lastLoad = report;
        return new Promise(resolve => {{
          let resolved = false;
          // Mobile Edge / WebKit timeout guard: 350ms race
          const timer = setTimeout(() => {{
            if (!resolved) {{
              resolved = true;
              report.source = 'ext-timeout';
              report.ms = Date.now() - t0;
              resolve(result);
            }}
          }}, 350);

          try {{
            chrome.storage.local.get(keys, res => {{
              if (resolved) {{
                report.lateMs = Date.now() - t0;
                return;
              }}
              resolved = true;
              clearTimeout(timer);
              report.ms = Date.now() - t0;
              if (chrome.runtime && chrome.runtime.lastError) {{
                report.source = 'ext-error';
                resolve(result);
              }} else if (res && typeof res === 'object') {{
                for (const k of keys) {{
                  if (res[k] !== undefined) {{
                    result[k] = res[k];
                    report.found.push(k);
                    try {{
                      window.localStorage.setItem('besing_' + k, JSON.stringify(res[k]));
                    }} catch (e) {{}}
                  }}
                }}
                resolve(result);
              }} else {{
                resolve(result);
              }}
            }});
          }} catch (err) {{
            if (!resolved) {{
              resolved = true;
              clearTimeout(timer);
              report.source = 'ext-error';
              report.ms = Date.now() - t0;
              resolve(result);
            }}
          }}
        }});
      }}

      this.lastLoad = {{ source: 'local', ms: Date.now() - t0, found: local.slice(), local }};
      return result;
    }},

    async set(key, value) {{
      if (this.isGM) {{
        try {{ GM_setValue(key, value); return true; }} catch (e) {{ return false; }}
      }}
      if (this.isExt) {{
        try {{
          window.localStorage.setItem('besing_' + key, JSON.stringify(value));
        }} catch (e) {{}}
        return new Promise(resolve => {{
          try {{
            chrome.storage.local.set({{ [key]: value }}, () => resolve(!chrome.runtime?.lastError));
          }} catch (e) {{
            resolve(false);
          }}
        }});
      }}
      try {{
        window.localStorage.setItem('besing_' + key, JSON.stringify(value));
        return true;
      }} catch (e) {{
        return false;
      }}
    }},

    registerMenu(name, cb) {{
      if (typeof GM_registerMenuCommand === 'function') {{
        try {{ GM_registerMenuCommand(name, cb); }} catch (e) {{}}
      }}
    }}
  }};

  // 2. Storage Manager
  class BESStorage {{
    constructor() {{
      const readLocal = (k, def) => {{
        try {{
          const item = window.localStorage.getItem('besing_' + k);
          return (item !== null && item !== undefined) ? JSON.parse(item) : def;
        }} catch (e) {{
          return def;
        }}
      }};

      this.siteRules = readLocal('site_rules', {{}});
      this.enabledScripts = readLocal('enabled_scripts', {{ 'prevent-redirect': true }});
      if (this.enabledScripts['prevent-redirect'] === undefined) {{
        this.enabledScripts['prevent-redirect'] = true;
      }}
      this.scriptConfigs = readLocal('script_configs', {{}});
      this.widgetPos = readLocal('widget_position', null);
      this.settings = {{
        theme: 'cyber-pet',
        agentUrl: 'http://127.0.0.1:8765/api/sync',
        authToken: '',
        updateChannel: 'github',
        autoCheckUpdates: true,
        ...readLocal('global_settings', {{}})
      }};
    }}

    async init() {{
      const data = await BESAdapter.getAll({{
        site_rules: this.siteRules || {{}},
        blocked_sites: [],
        enabled_scripts: this.enabledScripts || {{}},
        script_configs: this.scriptConfigs || {{}},
        widget_position: this.widgetPos,
        global_settings: this.settings || {{}}
      }});

      this.siteRules = (data.site_rules && typeof data.site_rules === 'object') ? data.site_rules : {{}};

      // Migrate legacy blocked_sites array if present
      if (Array.isArray(data.blocked_sites)) {{
        for (const item of data.blocked_sites) {{
          const host = (item.host || '').toLowerCase().trim();
          if (host) {{
            if (!this.siteRules[host]) this.siteRules[host] = {{ disableAll: true, scripts: {{}}, configs: {{}} }};
            else this.siteRules[host].disableAll = true;
          }}
        }}
      }}

      this.enabledScripts = (data.enabled_scripts && typeof data.enabled_scripts === 'object') ? data.enabled_scripts : {{}};
      if (this.enabledScripts['prevent-redirect'] === undefined) {{
        this.enabledScripts['prevent-redirect'] = true;
      }}

      this.scriptConfigs = (data.script_configs && typeof data.script_configs === 'object') ? data.script_configs : {{}};
      if (data.widget_position) {{
        this.widgetPos = data.widget_position;
      }}
      this.settings = {{ ...this.settings, ...(data.global_settings || {{}}) }};
    }}

    getCurrentHost() {{
      return (window.location.hostname || 'localhost').toLowerCase().trim();
    }}

    isCurrentBlocked() {{
      return this.isSiteDisabledAll(this.getCurrentHost());
    }}

    isSiteDisabledAll(host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      return !!(this.siteRules[h] && this.siteRules[h].disableAll);
    }}

    async setSiteDisabledAll(host, disabled) {{
      const h = (host || this.getCurrentHost()).toLowerCase().trim();
      if (!h) return;
      if (!this.siteRules[h]) this.siteRules[h] = {{ disableAll: false, scripts: {{}}, configs: {{}} }};
      this.siteRules[h].disableAll = !!disabled;
      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }}

    // Mode: 'off' | 'site' | 'site-off' | 'on'
    getScriptMode(scriptId, host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      const siteConfig = this.siteRules[h];

      if (siteConfig && siteConfig.scripts && siteConfig.scripts[scriptId] !== undefined) {{
        return siteConfig.scripts[scriptId] ? 'site' : 'site-off';
      }}

      if (this.enabledScripts[scriptId] !== undefined) {{
        return this.enabledScripts[scriptId] ? 'on' : 'off';
      }}
      if (scriptId === 'prevent-redirect') return 'on';
      return 'off';
    }}

    isScriptActiveOnSite(scriptId, host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      if (this.isSiteDisabledAll(h)) return false;

      const siteConfig = this.siteRules[h];
      if (siteConfig && siteConfig.scripts && siteConfig.scripts[scriptId] !== undefined) {{
        return !!siteConfig.scripts[scriptId];
      }}

      if (this.enabledScripts[scriptId] !== undefined) {{
        return !!this.enabledScripts[scriptId];
      }}
      if (scriptId === 'prevent-redirect') return true;

      return false;
    }}

    async setScriptMode(scriptId, mode, host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) this.siteRules[h] = {{ disableAll: false, scripts: {{}}, configs: {{}} }};
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {{}};

      if (mode === 'on') {{
        // Global ON: active across all sites by default; remove any site override for this host
        this.enabledScripts[scriptId] = true;
        delete this.siteRules[h].scripts[scriptId];
      }} else if (mode === 'site') {{
        // Active on this site only; globally OFF elsewhere
        this.siteRules[h].scripts[scriptId] = true;
        this.enabledScripts[scriptId] = false;
      }} else if (mode === 'site-off') {{
        // Explicitly disabled on this site only (e.g. RBC), global stays enabled
        this.siteRules[h].scripts[scriptId] = false;
        if (this.siteRules[h].configs && this.siteRules[h].configs[scriptId]) {{
          delete this.siteRules[h].configs[scriptId];
        }}
      }} else {{
        // OFF: Remove site override if present, and disable globally
        if (this.siteRules[h].scripts[scriptId] !== undefined) {{
          delete this.siteRules[h].scripts[scriptId];
          if (this.siteRules[h].configs && this.siteRules[h].configs[scriptId]) {{
            delete this.siteRules[h].configs[scriptId];
          }}
        }}
        this.enabledScripts[scriptId] = false;
      }}

      this.cleanupSiteRule(h);
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
      await BESAdapter.set('site_rules', this.siteRules);
    }}

    getScriptSiteOverrides(scriptId) {{
      const list = [];
      Object.keys(this.siteRules || {{}}).forEach(h => {{
        const rule = this.siteRules[h];
        if (rule && rule.scripts && rule.scripts[scriptId] !== undefined) {{
          list.push({{
            host: h,
            mode: rule.scripts[scriptId] ? 'site' : 'site-off',
            enabled: !!rule.scripts[scriptId],
            hasConfig: !!(rule.configs && rule.configs[scriptId])
          }});
        }}
      }});
      return list;
    }}

    async setSiteOverride(scriptId, host, mode) {{
      const h = (host || '').toLowerCase().trim();
      if (!h) return;
      if (!this.siteRules[h]) this.siteRules[h] = {{ disableAll: false, scripts: {{}}, configs: {{}} }};
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {{}};

      if (mode === 'site' || mode === true) {{
        this.siteRules[h].scripts[scriptId] = true;
      }} else if (mode === 'site-off' || mode === false) {{
        this.siteRules[h].scripts[scriptId] = false;
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      }} else {{
        delete this.siteRules[h].scripts[scriptId];
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      }}

      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }}

    async removeSiteOverride(scriptId, host) {{
      const h = (host || '').toLowerCase().trim();
      if (!h || !this.siteRules[h]) return;
      if (this.siteRules[h].scripts) delete this.siteRules[h].scripts[scriptId];
      if (this.siteRules[h].configs) delete this.siteRules[h].configs[scriptId];
      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }}

    // Script Configs: Site-Isolated vs Global
    getScriptConfig(scriptId, host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      const mode = this.getScriptMode(scriptId, h);

      if (mode === 'site') {{
        if (this.siteRules[h] && this.siteRules[h].configs && this.siteRules[h].configs[scriptId] !== undefined) {{
          return {{ ...(this.scriptConfigs[scriptId] || {{}}), ...this.siteRules[h].configs[scriptId] }};
        }}
        return {{ ...(this.scriptConfigs[scriptId] || {{}}) }};
      }}

      return {{ ...(this.scriptConfigs[scriptId] || {{}}) }};
    }}

    async setScriptConfig(scriptId, patch, host = this.getCurrentHost()) {{
      const h = (host || '').toLowerCase().trim();
      const mode = this.getScriptMode(scriptId, h);

      if (mode === 'site') {{
        if (!this.siteRules[h]) this.siteRules[h] = {{ disableAll: false, scripts: {{}}, configs: {{}} }};
        if (!this.siteRules[h].configs) this.siteRules[h].configs = {{}};
        this.siteRules[h].configs[scriptId] = {{ ...(this.siteRules[h].configs[scriptId] || {{}}), ...patch }};
        await BESAdapter.set('site_rules', this.siteRules);
      }} else {{
        this.scriptConfigs[scriptId] = {{ ...(this.scriptConfigs[scriptId] || {{}}), ...patch }};
        await BESAdapter.set('script_configs', this.scriptConfigs);
      }}
    }}

    async toggleSiteRule(host, ruleKey, val) {{
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) this.siteRules[h] = {{ disableAll: false, scripts: {{}}, configs: {{}} }};
      if (!this.siteRules[h].scripts) this.siteRules[h].scripts = {{}};

      if (ruleKey === 'disableAll') {{
        this.siteRules[h].disableAll = !!val;
      }} else {{
        this.siteRules[h].scripts[ruleKey] = !!val;
      }}

      this.cleanupSiteRule(h);
      await BESAdapter.set('site_rules', this.siteRules);
    }}

    cleanupSiteRule(host) {{
      const rule = this.siteRules[host];
      if (!rule) return;
      const hasScripts = rule.scripts && Object.keys(rule.scripts).length > 0;
      const hasConfigs = rule.configs && Object.keys(rule.configs).length > 0;
      if (!rule.disableAll && !hasScripts && !hasConfigs) {{
        delete this.siteRules[host];
      }}
    }}

    async removeSiteRule(host, ruleKey = null) {{
      const h = (host || '').toLowerCase().trim();
      if (!this.siteRules[h]) return;

      if (!ruleKey || ruleKey === 'all') {{
        delete this.siteRules[h];
      }} else if (ruleKey === 'disableAll') {{
        this.siteRules[h].disableAll = false;
        this.cleanupSiteRule(h);
      }} else if (this.siteRules[h].scripts) {{
        delete this.siteRules[h].scripts[ruleKey];
        if (this.siteRules[h].configs) delete this.siteRules[h].configs[ruleKey];
        this.cleanupSiteRule(h);
      }}

      await BESAdapter.set('site_rules', this.siteRules);
    }}

    getAllSiteRules() {{
      return this.siteRules || {{}};
    }}

    getBlockedSites() {{
      return Object.keys(this.siteRules)
        .filter(h => this.siteRules[h] && this.siteRules[h].disableAll)
        .map(h => ({{ host: h, addedAt: Date.now() }}));
    }}

    getWidgetPosition() {{
      return this.widgetPos;
    }}

    async setWidgetPosition(pos) {{
      this.widgetPos = pos;
      await BESAdapter.set('widget_position', pos);
    }}

    getTheme() {{
      return this.settings.theme || 'cyber-pet';
    }}

    async setTheme(theme) {{
      this.settings.theme = theme;
      await BESAdapter.set('global_settings', this.settings);
    }}

    async updateSettings(patch) {{
      this.settings = {{ ...this.settings, ...patch }};
      await BESAdapter.set('global_settings', this.settings);
    }}
  }}

  // Boot diagnostics: a history of page loads with how far each one got, when, and what failed.
  // A load missing from the list means the userscript manager never injected BESing.
  // Entries live in manager storage (shared by every site) and are mirrored to this site's
  // localStorage, so a load whose manager storage misbehaves still leaves a trace here.
  const BESBootLog = {{
    entry: null,
    // ms since navigation start when this copy of BESing began running (the injection delay).
    startedAt: (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0,
    _persistTimer: 0,
    _writing: Promise.resolve(),

    elapsed() {{
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      return Math.round(now - this.startedAt);
    }},

    ensureEntry() {{
      if (!this.entry) {{
        let navType = '';
        try {{
          const nav = performance.getEntriesByType('navigation')[0];
          navType = nav ? nav.type : '';
        }} catch (e) {{}}
        this.entry = {{
          id: Math.random().toString(36).slice(2, 10),
          t: Date.now(),
          u: Date.now(),
          host: (window.location.hostname || '').toLowerCase(),
          v: '{VERSION}',
          nav: navType,
          injectMs: Math.round(this.startedAt),
          ready: document.readyState,
          vis: document.visibilityState,
          stages: {{}},
          info: {{}},
          events: [],
          errors: []
        }};
      }}
      return this.entry;
    }},

    // Marks the first time a boot stage was reached (ms since BESing started) and merges `info` into the entry.
    record(stage, info) {{
      if (!IS_TOP_FRAME) return;
      try {{
        const e = this.ensureEntry();
        if (e.stages[stage] === undefined) e.stages[stage] = this.elapsed();
        if (info && typeof info === 'object') Object.assign(e.info, info);
        this.schedulePersist();
      }} catch (err) {{}}
    }},

    event(name) {{
      if (!IS_TOP_FRAME) return;
      try {{
        const e = this.ensureEntry();
        if (e.events.length >= BOOT_LOG_MAX_EVENTS) return;
        e.events.push(`+${{this.elapsed()}} ${{name}}`);
        this.schedulePersist();
      }} catch (err) {{}}
    }},

    error(where, err) {{
      if (!IS_TOP_FRAME) return;
      try {{
        const e = this.ensureEntry();
        if (e.errors.length >= BOOT_LOG_MAX_ERRORS) return;
        const msg = (err && err.message) ? `${{err.name || 'Error'}}: ${{err.message}}` : String(err);
        e.errors.push(`+${{this.elapsed()}} ${{where}}: ${{msg.slice(0, 240)}}`);
        this.schedulePersist();
      }} catch (x) {{}}
    }},

    // Snapshot of what the user should be seeing right now, logged as an event.
    check(label) {{
      if (!IS_TOP_FRAME) return;
      try {{
        const app = getLiveInstance();
        if (!app) {{
          this.event(`${{label}}: no live instance`);
          return;
        }}
        const parts = [];
        if (!app.host) {{
          parts.push(app.storage && app.storage.isCurrentBlocked() ? 'site-disabled' : 'NO-HOST');
        }} else {{
          parts.push(app.host.isConnected ? 'host-in-dom' : 'HOST-DETACHED');
          try {{
            const cs = getComputedStyle(app.host);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {{
              parts.push(`HOST-HIDDEN(${{cs.display}}/${{cs.visibility}}/${{cs.opacity}})`);
            }}
          }} catch (e) {{}}
          if (!app.widgetEl || !app.shadow || !app.shadow.contains(app.widgetEl)) {{
            parts.push('NO-WIDGET');
          }} else {{
            const r = app.widgetEl.getBoundingClientRect();
            const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
              r.left < window.innerWidth && r.top < window.innerHeight;
            const folded = (app.widgetEl.className.match(/folded-\\w+/) || [''])[0];
            parts.push(`widget ${{Math.round(r.left)}},${{Math.round(r.top)}} ${{Math.round(r.width)}}x${{Math.round(r.height)}} ${{onScreen ? 'on-screen' : 'OFF-SCREEN'}}${{folded ? ' ' + folded : ''}}`);
          }}
        }}
        const running = (app.modules || []).filter(m => m.running).map(m => m.id);
        parts.push(`running[${{running.join(',')}}]`);
        if (running.includes('ad-cleaner')) {{
          const s = document.getElementById('besing-ad-cleaner-style');
          parts.push(s && s.isConnected ? 'ad-style-ok' : 'AD-STYLE-MISSING');
        }}
        if (running.includes('prevent-redirect')) {{
          const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
          let guard = 'unknown';
          try {{ guard = pageWin.__besing_pr_active__ ? 'ok' : 'MISSING'; }} catch (e) {{}}
          parts.push(`page-guard-${{guard}}`);
          const pr = (app.modules || []).find(m => m.id === 'prevent-redirect');
          parts.push(pr && pr._navigateHandler ? 'nav-guard-on' : 'NAV-GUARD-OFF');
        }}
        parts.push(`vis=${{document.visibilityState}}`);
        this.event(`${{label}}: ${{parts.join(' ')}}`);
      }} catch (err) {{
        this.error(`check ${{label}}`, err);
      }}
    }},

    schedulePersist() {{
      if (this._persistTimer) return;
      this._persistTimer = setTimeout(() => {{
        this._persistTimer = 0;
        this.persist();
      }}, 150);
    }},

    // Writes are chained so one page never interleaves two read-modify-write cycles.
    persist() {{
      if (!this.entry) return this._writing;
      if (this._persistTimer) {{
        clearTimeout(this._persistTimer);
        this._persistTimer = 0;
      }}
      this.entry.u = Date.now();
      const snapshot = JSON.parse(JSON.stringify(this.entry));
      this._writing = this._writing.then(async () => {{
        try {{
          window.localStorage.setItem(BOOT_LOG_MIRROR_KEY, JSON.stringify(this.merge([snapshot], this.readMirror())));
        }} catch (e) {{}}
        try {{
          const list = await BESAdapter.get(BOOT_LOG_KEY, [], 3000);
          await BESAdapter.set(BOOT_LOG_KEY, this.merge([snapshot], list));
        }} catch (e) {{}}
      }});
      return this._writing;
    }},

    readMirror() {{
      try {{
        const raw = window.localStorage.getItem(BOOT_LOG_MIRROR_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      }} catch (e) {{
        return [];
      }}
    }},

    // Combines entry lists, keeping the most recently updated copy of each load, newest load first.
    merge(...lists) {{
      const byId = new Map();
      for (const list of lists) {{
        if (!Array.isArray(list)) continue;
        for (const e of list) {{
          if (!e || !e.id) continue;
          const prev = byId.get(e.id);
          if (!prev || (e.u || 0) > (prev.u || 0)) byId.set(e.id, e);
        }}
      }}
      return Array.from(byId.values()).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, BOOT_LOG_LIMIT);
    }},

    async read() {{
      await this.persist();
      const list = await BESAdapter.get(BOOT_LOG_KEY, [], 3000);
      return this.merge(list, this.readMirror());
    }},

    async clear() {{
      try {{ window.localStorage.removeItem(BOOT_LOG_MIRROR_KEY); }} catch (e) {{}}
      await BESAdapter.set(BOOT_LOG_KEY, []);
    }},

    // One-line status used by the Settings list and the copied report.
    statusOf(e) {{
      const s = (e && e.stages) || {{}};
      if (s.skipped !== undefined) return 'skipped (another copy owns the page)';
      if (s.mounted !== undefined) return `shown ${{s.mounted}}ms`;
      if (s.blocked !== undefined) return 'site disabled';
      if (s.storage !== undefined) return 'stopped after settings load';
      return 'stopped at start';
    }},

    // Plain-text report meant to be pasted into a bug report.
    async buildReport() {{
      const entries = await this.read();
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (t) => {{
        const d = new Date(t || 0);
        return `${{d.getFullYear()}}-${{pad(d.getMonth() + 1)}}-${{pad(d.getDate())}} ${{pad(d.getHours())}}:${{pad(d.getMinutes())}}:${{pad(d.getSeconds())}}`;
      }};
      const env = describeEnvironment();
      const lines = [
        `BESing debug log (v{VERSION}), copied ${{fmt(Date.now())}}`,
        `UA: ${{navigator.userAgent}}`,
        `This copy: ${{Object.entries(env).map(([k, v]) => `${{k}}=${{v}}`).join(' ')}}`,
        `Times: "inject" is ms from navigation start until BESing began; stage and event times are ms after that.`,
        `${{entries.length}} loads, newest first:`,
        ''
      ];
      entries.forEach((e, i) => {{
        const s = e.stages || {{}};
        const stageText = Object.entries(s).map(([k, v]) => `${{k}} ${{v}}`).join(', ');
        const here = this.entry && e.id === this.entry.id ? ' (this page)' : '';
        lines.push(`#${{i + 1}} ${{fmt(e.t)}} ${{e.host || '?'}} [${{e.nav || '?'}}] -- ${{this.statusOf(e)}}${{here}}`);
        const late = e.ready && e.ready !== 'loading' ? ' (LATE: page scripts had already run)' : '';
        const inject = e.injectMs !== undefined ? `inject ${{e.injectMs}}ms, ` : '';
        lines.push(`  ${{inject}}ready=${{e.ready}}${{late}}, vis=${{e.vis || '?'}}, v${{e.v}}`);
        lines.push(`  stages: ${{stageText || 'none'}}`);
        const info = e.info || {{}};
        if (Object.keys(info).length) {{
          lines.push(`  info: ${{Object.entries(info).map(([k, v]) => `${{k}}=${{typeof v === 'object' ? JSON.stringify(v) : v}}`).join(' ')}}`);
        }}
        (e.events || []).forEach(ev => lines.push(`  ${{ev}}`));
        (e.errors || []).forEach(er => lines.push(`  ERROR ${{er}}`));
        lines.push('');
      }});
      return lines.join('\\n');
    }}
  }};

  // Short description of how this copy of BESing was loaded, for the boot log.
  function describeEnvironment() {{
    const env = {{}};
    try {{
      if (typeof GM_info !== 'undefined' && GM_info) {{
        env.handler = `${{GM_info.scriptHandler || '?'}} ${{GM_info.version || ''}}`.trim();
        if (GM_info.injectInto) env.injectInto = GM_info.injectInto;
        if (GM_info.script) env.script = `${{GM_info.script.name || '?'}} ${{GM_info.script.version || ''}}`.trim();
      }} else if (BESAdapter.isExt) {{
        env.handler = 'BESing extension';
      }} else {{
        env.handler = 'none';
      }}
      const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const loader = (typeof window !== 'undefined' && window.__BESING_LOADER_INFO__) || (win && win.__BESING_LOADER_INFO__);
      if (loader) env.loader = `stable ${{loader.version || '?'}} ${{loader.source || '?'}}`;
      env.storage = BESAdapter.isGM ? 'gm' : (BESAdapter.isExt ? 'ext' : 'local');
      env.frame = IS_TOP_FRAME ? 'top' : 'child';
    }} catch (e) {{}}
    return env;
  }}

  // Copies text from inside a tap or click handler, and must be called before that handler awaits
  // anything: WebKit only allows clipboard writes while the tap's user activation is live.
  // Resolves to the method the browser confirmed ('clipboard' or 'command'), or '' when none did.
  // GM_setClipboard is deliberately not used: it reports nothing, and Stay on iOS Edge accepts
  // the call without copying.
  async function copyTextToClipboard(text) {{
    let pending = null;
    try {{
      if (navigator.clipboard && navigator.clipboard.writeText) {{
        // Started synchronously so it carries the activation. It can also stay pending forever
        // when the browser withholds permission, so it is raced.
        pending = Promise.race([
          navigator.clipboard.writeText(text).then(() => true, () => false),
          new Promise(resolve => setTimeout(() => resolve(false), 1500))
        ]);
      }}
    }} catch (e) {{
      pending = null;
    }}
    if (!pending && copyViaCommand(text)) return 'command';
    if (pending && await pending) return 'clipboard';
    if (pending && copyViaCommand(text)) return 'command';
    return '';
  }}

  // execCommand('copy') with the selection steps iOS needs (a range on the field plus
  // setSelectionRange). Returns the browser's answer, which is false when it refused.
  function copyViaCommand(text) {{
    let ta = null;
    try {{
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
    }} catch (e) {{
      return false;
    }} finally {{
      if (ta) ta.remove();
    }}
  }}

  // Opens the system share sheet (iOS offers Copy, Notes, Messages). Like copying, it must be
  // called before the tap handler awaits. Resolves to 'shared', 'cancelled' or 'unavailable'.
  async function shareText(title, text) {{
    if (!navigator.share) return 'unavailable';
    try {{
      await navigator.share({{ title, text }});
      return 'shared';
    }} catch (e) {{
      return e && e.name === 'AbortError' ? 'cancelled' : 'unavailable';
    }}
  }}

  // Full-screen viewer for the debug log with large Copy and Share buttons, for touch devices where
  // selecting text in the small Settings panel is impractical. It is its own element with its own
  // shadow root, so it works even when the BESing icon never mounted on this load.
  function openBootLogViewer(report) {{
    try {{
      const old = document.getElementById('__besing_log_viewer__');
      if (old) old.remove();
      const host = document.createElement('besing-log-viewer');
      host.id = '__besing_log_viewer__';
      host.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:2147483647 !important;display:block !important;';
      (document.body || document.documentElement).appendChild(host);
      const root = host.attachShadow({{ mode: 'open' }});

      const style = document.createElement('style');
      style.textContent = `
        :host {{ all: initial; }}
        .wrap {{ position: fixed; inset: 0; display: flex; flex-direction: column; gap: 10px; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); background: #0b1120; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-sizing: border-box; }}
        .bar {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
        .title {{ font-size: 16px; font-weight: 700; flex: 1 1 100%; }}
        button, a.btn {{ flex: 1 1 0; min-height: 44px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: #1e293b; color: #e2e8f0; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0 10px; cursor: pointer; font-family: inherit; }}
        button.primary {{ background: linear-gradient(135deg, #0284c7, #2563eb); border-color: transparent; color: #fff; }}
        .msg {{ font-size: 13px; min-height: 18px; color: #34d399; }}
        .msg.warn {{ color: #fbbf24; }}
        textarea {{ flex: 1; width: 100%; box-sizing: border-box; background: #020617; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.45; resize: none; -webkit-user-select: text; user-select: text; }}
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
      const say = (text, warn) => {{
        msg.textContent = text;
        msg.className = warn ? 'msg warn' : 'msg';
      }};

      const copyBtn = document.createElement('button');
      copyBtn.className = 'primary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {{
        const method = await copyTextToClipboard(report);
        BESBootLog.event(`log copy from viewer: ${{method || 'failed'}}`);
        if (method) say('Copied. Paste it into your message.');
        else say('This browser blocked copying. Use Share, or press and hold the text and choose Select All.', true);
      }});
      bar.appendChild(copyBtn);

      if (navigator.share) {{
        const shareBtn = document.createElement('button');
        shareBtn.textContent = 'Share';
        shareBtn.addEventListener('click', async () => {{
          const result = await shareText('BESing debug log', report);
          if (result === 'unavailable') say('Sharing is not available here.', true);
        }});
        bar.appendChild(shareBtn);
      }}

      // Plain-text tab as a last resort; a real link, so popup guards do not treat it as a script popup.
      try {{
        const url = URL.createObjectURL(new Blob([report], {{ type: 'text/plain;charset=utf-8' }}));
        const tabLink = document.createElement('a');
        tabLink.className = 'btn';
        tabLink.href = url;
        tabLink.target = '_blank';
        tabLink.rel = 'noopener';
        tabLink.textContent = 'Open as Tab';
        bar.appendChild(tabLink);
      }} catch (e) {{}}

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
    }} catch (err) {{
      BESBootLog.error('log viewer', err);
      return false;
    }}
  }}

  // 3. Pre-bundled Modules (Off by default, zero remote eval)
  const BUILTIN_MODULES = [
{modules_joined}
  ];

  // 4. Update Engine (Checks version, prompts native update, or auto-updates via stable bootstrapper)
  class BESUpdater {{
    static CURRENT_VERSION = '{VERSION}';

    static isStableLoader() {{
      if (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.name) {{
        if (GM_info.script.name.includes('Packed')) return false;
        if (GM_info.script.name.includes('Stable')) return true;
      }}
      const win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || (typeof window !== 'undefined' && window);
      return typeof win !== 'undefined' && (
        win.__BESING_ENVIRONMENT__ === 'stable-loader' ||
        typeof win.__BESING_AUTO_UPDATE__ === 'function' ||
        typeof win.__BESING_RELOAD_LATEST__ === 'function'
      );
    }}

    static CHANNELS = {{
      github: {{
        name: 'GitHub Releases',
        metaUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js',
        userUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js'
      }},
      greasyfork: {{
        name: 'Greasy Fork (Public)',
        metaUrl: 'https://update.greasyfork.org/scripts/597772/BESing%20Script%20Manager.meta.js',
        userUrl: 'https://update.greasyfork.org/scripts/597772/BESing%20Script%20Manager.user.js'
      }}
    }};

    static async fetchText(url) {{
      return new Promise((resolve, reject) => {{
        const tryFetch = () => {{
          const fetchUrl = url.includes('raw.githubusercontent.com')
            ? url.replace('https://raw.githubusercontent.com/CoronRing/BESing/master/', 'https://cdn.jsdelivr.net/gh/CoronRing/BESing@master/')
            : url;
          fetch(`${{fetchUrl}}${{fetchUrl.includes('?') ? '&' : '?'}}_t=${{Date.now()}}`, {{ cache: 'no-cache' }})
            .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
            .then(resolve)
            .catch(reject);
        }};

        if (typeof GM_xmlhttpRequest === 'function') {{
          try {{
            GM_xmlhttpRequest({{
              method: 'GET',
              url: `${{url}}${{url.includes('?') ? '&' : '?'}}_t=${{Date.now()}}`,
              timeout: 7000,
              onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : tryFetch(),
              onerror: () => tryFetch(),
              ontimeout: () => tryFetch()
            }});
            return;
          }} catch (e) {{
            tryFetch();
            return;
          }}
        }} else {{
          tryFetch();
        }}
      }});
    }}

    static parseVersion(metaText) {{
      const match = metaText.match(/@version\\s+([0-9\\.]+)/i);
      return match ? match[1].trim() : null;
    }}

    static compareVersions(vA, vB) {{
      const a = (vA || '0').split('.').map(n => parseInt(n, 10) || 0);
      const b = (vB || '0').split('.').map(n => parseInt(n, 10) || 0);
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {{
        const numA = a[i] || 0;
        const numB = b[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
      }}
      return 0;
    }}

    async checkForUpdates(manual = false) {{
      const channelKey = 'github';
      const channel = BESUpdater.CHANNELS[channelKey];
      const isStable = BESUpdater.isStableLoader();
      try {{
        const text = await BESUpdater.fetchText(channel.metaUrl);
        const remoteVer = BESUpdater.parseVersion(text);
        if (!remoteVer) throw new Error('Could not parse remote version header');
        const hasUpdate = BESUpdater.compareVersions(remoteVer, BESUpdater.CURRENT_VERSION) > 0;

        let autoUpdated = false;
        if (hasUpdate && isStable) {{
          const autoUpdateFn = (typeof window !== 'undefined' && window.__BESING_AUTO_UPDATE__) ||
                               (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_AUTO_UPDATE__);
          if (typeof autoUpdateFn === 'function') {{
            try {{
              const uRes = await autoUpdateFn(true);
              if (uRes && uRes.ok !== false) autoUpdated = true;
            }} catch (e) {{
              console.warn('[BESUpdater] Auto-update hook failed:', e);
            }}
          }}

          if (!autoUpdated) {{
            // Direct download & update into GM cache
            try {{
              const newCode = await BESUpdater.fetchText(channel.userUrl);
              if (newCode && newCode.length > 500) {{
                if (typeof GM_setValue === 'function') {{
                  GM_setValue('besing_cached_code', newCode);
                  GM_setValue('besing_cached_version', remoteVer);
                  GM_setValue('besing_last_check', Date.now());
                  autoUpdated = true;
                }} else if (BESAdapter.isGM) {{
                  await BESAdapter.set('besing_cached_code', newCode);
                  await BESAdapter.set('besing_cached_version', remoteVer);
                  await BESAdapter.set('besing_last_check', Date.now());
                  autoUpdated = true;
                }}
              }}
            }} catch (err) {{
              console.warn('[BESUpdater] Fallback download failed:', err);
            }}
          }}
        }}

        return {{
          ok: true,
          isStableLoader: isStable,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          remoteVersion: remoteVer,
          hasUpdate,
          autoUpdated,
          downloadUrl: channel.userUrl
        }};
      }} catch (err) {{
        return {{
          ok: false,
          isStableLoader: isStable,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          error: err.message
        }};
      }}
    }}

    triggerInstall(downloadUrl) {{
      const url = downloadUrl || BESUpdater.CHANNELS.github.userUrl;
      window.open(url, '_blank');
    }}
  }}

  // 5. App Core & UI Controller
  class BESManagerApp {{
    constructor() {{
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
    }}

    // Full shutdown used when another instance replaces this one: stops timers, modules and UI,
    // and makes every later lifecycle callback (pageshow, heartbeat, load) a no-op.
    dispose() {{
      this.disposed = true;
      this.teardown();
      this.detachViewportTracking();
    }}

    initPreemptiveShields() {{
      // 1. Immediately and synchronously arm the security shield (prevent-redirect)
      // so zero page scripts or ad networks can slip through during async storage loading.
      if (!this.modules || this.modules.length === 0) {{
        this.modules = BUILTIN_MODULES.map(m => ({{
          ...m,
          running: false
        }}));
      }}

      const prModule = this.modules.find(m => m.id === 'prevent-redirect');
      if (prModule && typeof prModule.init === 'function') {{
        try {{
          prModule.init({{}});
          prModule.running = true;
          console.log('[BESing] Preemptive security shield synchronously armed at document-start.');
        }} catch (e) {{
          console.warn('[BESing] Preemptive shield init error:', e);
        }}
      }}
    }}

    async init() {{
      await this.storage.init();
      if (this.disposed) return;
      const currentHost = this.storage.getCurrentHost();
      BESBootLog.record('storage', {{
        store: BESAdapter.lastLoad,
        modes: BUILTIN_MODULES.reduce((acc, m) => {{
          const mode = this.storage.getScriptMode(m.id, currentHost);
          if (mode !== 'off') acc[m.id] = mode;
          return acc;
        }}, {{}})
      }});

      if (!IS_TOP_FRAME) {{
        this.initFrameModules(currentHost);
        return;
      }}

      if (!this.modules || this.modules.length === 0) {{
        this.modules = BUILTIN_MODULES.map(m => ({{
          ...m,
          running: false
        }}));
      }}

      // Re-evaluate modules with loaded storage configuration
      this.modules.forEach(m => {{
        const shouldBeActive = this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);

        if (m.id === 'prevent-redirect') {{
          // If explicitly disabled on this site by user, deactivate the preemptive shield
          if (!shouldBeActive && m.running) {{
            try {{
              m.destroy();
              m.running = false;
              console.log('[BESing] Preemptive security shield deactivated per site rule.');
            }} catch (err) {{}}
          }} else if (shouldBeActive && !m.running) {{
            try {{
              m.init(cfg);
              m.running = true;
            }} catch (err) {{
              BESBootLog.error(`init ${{m.id}}`, err);
            }}
          }} else if (shouldBeActive && m.running) {{
            try {{
              if (typeof m.onConfigChange === 'function') {{
                m.onConfigChange(cfg);
              }}
            }} catch (err) {{
              BESBootLog.error(`config ${{m.id}}`, err);
            }}
          }}
          return;
        }}

        if (shouldBeActive && !m.running) {{
          try {{
            m.init(cfg);
            m.running = true;
          }} catch (err) {{
            console.error(`[BESing] Error initializing ${{m.id}}:`, err);
            BESBootLog.error(`init ${{m.id}}`, err);
          }}
        }} else if (!shouldBeActive && m.running) {{
          try {{
            m.destroy();
            m.running = false;
          }} catch (err) {{
            console.error(`[BESing] Error destroying ${{m.id}}:`, err);
            BESBootLog.error(`destroy ${{m.id}}`, err);
          }}
        }} else if (shouldBeActive && m.running) {{
          if (typeof m.onConfigChange === 'function') {{
            try {{ m.onConfigChange(cfg); }} catch (err) {{ BESBootLog.error(`config ${{m.id}}`, err); }}
          }}
        }}
      }});
      BESBootLog.record('modules', {{ running: this.modules.filter(m => m.running).map(m => m.id).join(',') }});

      // Throttled Update Check:
      // If running inside stable loader: auto-check in background and silently auto-update!
      // If running full script: check once every 24 hours
      if (BESUpdater.isStableLoader()) {{
        setTimeout(async () => {{
          await this.updater.checkForUpdates(false).catch(() => {{}});
        }}, 3000);
      }} else {{
        setTimeout(async () => {{
          try {{
            const lastCheck = await BESAdapter.get('last_update_check_time', 0);
            const ONE_DAY = 24 * 60 * 60 * 1000;
            if (Date.now() - (lastCheck || 0) > ONE_DAY) {{
              await this.updater.checkForUpdates(false).catch(() => {{}});
              await BESAdapter.set('last_update_check_time', Date.now());
            }}
          }} catch (e) {{}}
        }}, 4000);
      }}

      // Hotkey: Alt + Shift + B
      window.addEventListener('keydown', (e) => {{
        if (this.disposed) return;
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {{
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }}
      }});

      // Userscript manager menu commands. They resolve the live instance at click time,
      // because a later copy of BESing may have replaced this one.
      if (!window.__BESING_MENU_REGISTERED__) {{
        window.__BESING_MENU_REGISTERED__ = true;
        const live = () => getLiveInstance() || this;
        BESAdapter.registerMenu('✨ Show / Pull Up BESing Icon', () => {{
          live().pullUpIcon();
        }});
        BESAdapter.registerMenu('🔄 Reset Icon Position to Default', () => {{
          live().resetWidgetPosition();
        }});
        BESAdapter.registerMenu('⚙️ Open BESing Settings', () => {{
          live().openModal('settings');
        }});
        BESAdapter.registerMenu('📦 Open BESing Extensions', () => {{
          live().openModal('extensions');
        }});
        // Works even when the icon never appeared on this load. A menu command is not a tap on the
        // page, so it cannot copy on iOS; it opens the viewer, whose buttons can.
        BESAdapter.registerMenu('🐞 View BESing Debug Log', async () => {{
          openBootLogViewer(await BESBootLog.buildReport());
        }});
      }}

      // Page Navigation & bfcache Resilience
      window.addEventListener('pageshow', () => {{
        if (this.disposed) return;
        this.ensureMounted('pageshow');
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      }});

      window.addEventListener('popstate', () => {{
        if (this.disposed) return;
        this.ensureMounted('popstate');
        this.clampWidgetPosition();
        this.refreshCurrentSiteModules();
      }});

      document.addEventListener('visibilitychange', () => {{
        if (this.disposed) return;
        if (document.visibilityState === 'visible') {{
          this.ensureMounted('visible');
          this.clampWidgetPosition();
        }}
      }});

      this.startHeartbeat();

      // Direct DOM MutationObserver on document.documentElement
      try {{
        const targetNode = document.documentElement || document.body;
        if (targetNode && !this._domObserver) {{
          this._domObserver = new MutationObserver(() => {{
            if (this.host && !this.host.isConnected && !this.storage.isCurrentBlocked()) {{
              this.ensureMounted('dom-observer');
            }}
          }});
          this._domObserver.observe(targetNode, {{ childList: true, subtree: false }});
        }}
      }} catch (e) {{}}

      if (this.storage.isCurrentBlocked()) {{
        console.log(`[BESing] Inactive on ${{window.location.hostname}} (Site blocked)`);
        BESBootLog.record('blocked');
        return;
      }}

      this.ensureMounted('init');
    }}

    // Heartbeat DOM guardian (every 2.5s) to catch any random DOM detachments
    startHeartbeat() {{
      if (this._heartbeatInterval || this.disposed || !IS_TOP_FRAME) return;
      this._heartbeatInterval = setInterval(() => {{
        this.ensureMounted('heartbeat');
      }}, 2500);
    }}

    // Child frames: honor the frame's site rules for frame-safe modules only, with no widget or listeners.
    initFrameModules(currentHost) {{
      this.modules.forEach(m => {{
        const shouldBeActive = FRAME_SAFE_MODULES.has(m.id) && this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);
        try {{
          if (shouldBeActive && !m.running) {{
            m.init(cfg);
            m.running = true;
          }} else if (!shouldBeActive && m.running) {{
            m.destroy();
            m.running = false;
          }} else if (shouldBeActive && m.running && typeof m.onConfigChange === 'function') {{
            m.onConfigChange(cfg);
          }}
        }} catch (err) {{
          console.error(`[BESing] Frame module error ${{m.id}}:`, err);
        }}
      }});
    }}

    refreshCurrentSiteModules() {{
      if (this.disposed) return;
      const currentHost = this.storage.getCurrentHost();
      this.modules.forEach(m => {{
        const shouldBeActive = this.storage.isScriptActiveOnSite(m.id, currentHost);
        const cfg = this.storage.getScriptConfig(m.id, currentHost);
        if (shouldBeActive && !m.running) {{
          try {{
            m.init(cfg);
            m.running = true;
          }} catch (err) {{
            console.error(`[BESing] Error initializing ${{m.id}}:`, err);
          }}
        }} else if (!shouldBeActive && m.running) {{
          try {{
            m.destroy();
            m.running = false;
          }} catch (err) {{
            console.error(`[BESing] Error destroying ${{m.id}}:`, err);
          }}
        }} else if (shouldBeActive && m.running) {{
          if (typeof m.onConfigChange === 'function') {{
            try {{ m.onConfigChange(cfg); }} catch (e) {{}}
          }}
        }}
      }});
      this.updateBadge();
    }}

    async applyScriptConfig(scriptId, patch) {{
      const currentHost = this.storage.getCurrentHost();
      await this.storage.setScriptConfig(scriptId, patch, currentHost);
      const updatedCfg = this.storage.getScriptConfig(scriptId, currentHost);
      const m = this.modules.find(mod => mod.id === scriptId);
      if (m && m.running) {{
        if (typeof m.onConfigChange === 'function') {{
          try {{ m.onConfigChange(updatedCfg); }} catch (e) {{}}
        }} else {{
          try {{
            m.destroy();
            m.init(updatedCfg);
          }} catch (e) {{}}
        }}
      }}
    }}

    // Cross-site state for modules. Userscript manager and extension storage are shared by every
    // site, unlike localStorage, which is separate per origin. Values must be JSON-serializable.
    async readSharedState(key, fallback = null) {{
      return BESAdapter.get('shared_' + key, fallback);
    }}

    async writeSharedState(key, value) {{
      return BESAdapter.set('shared_' + key, value);
    }}

    openScriptConfig(scriptId) {{
      this.activeConfigScriptId = scriptId;
      this.currentView = 'script-config';
      this.renderBody();
    }}

    ensureMounted(reason = '') {{
      if (this.disposed || !IS_TOP_FRAME) return;
      if (this.storage.isCurrentBlocked()) return;

      try {{
        const docRoot = document.body || document.documentElement;
        if (!docRoot) return;

        // Discard stale host from old document (WebKit / iPadOS refresh or bfcache)
        if (this.host && this.host.ownerDocument !== document) {{
          BESBootLog.event(`stale host from old document dropped${{reason ? ' (' + reason + ')' : ''}}`);
          this.host = null;
          this.shadow = null;
          this.widgetEl = null;
        }}

        // 1. Host exists in memory, belongs to current document, but got detached
        if (this.host && !this.host.isConnected) {{
          BESBootLog.event(`host was detached, reattached${{reason ? ' (' + reason + ')' : ''}}`);
          docRoot.appendChild(this.host);
          this.clampWidgetPosition();
          return;
        }}

        // 2. Host is null or was removed
        if (!this.host) {{
          const existing = document.getElementById('__besing_root__');
          if (existing) {{
            existing.remove();
          }}
          this.mount(reason);
          return;
        }}

        // 3. Make sure widget element is present in shadow DOM
        if (this.shadow && (!this.widgetEl || !this.shadow.contains(this.widgetEl))) {{
          BESBootLog.event(`widget missing, re-rendered${{reason ? ' (' + reason + ')' : ''}}`);
          this.renderWidget(this.shadow);
        }}
      }} catch (err) {{
        console.error('[BESing] Mount error:', err);
        BESBootLog.error(`mount${{reason ? ' (' + reason + ')' : ''}}`, err);
      }}
    }}

    mount(reason = '') {{
      if (this.disposed || !IS_TOP_FRAME) return;
      const docRoot = document.body || document.documentElement;
      if (!docRoot) return;

      // Discard stale host from old document
      if (this.host && this.host.ownerDocument !== document) {{
        this.host = null;
        this.shadow = null;
        this.widgetEl = null;
      }}

      if (this.host && this.host.isConnected) return;

      if (this.host && !this.host.isConnected) {{
        docRoot.appendChild(this.host);
        this.clampWidgetPosition();
        return;
      }}

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

      const shadow = host.attachShadow({{ mode: 'open' }});
      this.shadow = shadow;

      this.injectStyles(shadow);
      this.attachViewportTracking();
      this.applyViewportCompensation();
      this.renderWidget(shadow);
      if (BESBootLog.entry && BESBootLog.entry.stages.mounted !== undefined) {{
        BESBootLog.event(`host recreated${{reason ? ' (' + reason + ')' : ''}}`);
      }} else {{
        BESBootLog.record('mounted', reason ? {{ mountedBy: reason }} : undefined);
      }}

      if (!this._redirectListenerAttached) {{
        window.addEventListener('besing:redirect-blocked', () => {{
          this.blinkRedirectAlert();
        }});
        this._redirectListenerAttached = true;
      }}
    }}

    // ---- Visual viewport compensation ----
    // The widget layer is position: fixed, which grows and drifts with pinch-zoom on mobile.
    // The host is translated onto the visual viewport and scaled by 1 / zoom, so the widget keeps
    // its normal on-screen size. Widget coordinates live in this "local" space, whose size stays
    // roughly constant while zooming, so saved positions are not disturbed by zoom.

    getViewportMetrics() {{
      const doc = document.documentElement;
      const layoutW = (doc && doc.clientWidth) || window.innerWidth || 0;
      const layoutH = window.innerHeight || (doc && doc.clientHeight) || 0;
      const vv = window.visualViewport;
      if (!vv || !(vv.width > 0) || !(vv.height > 0)) {{
        return {{ scale: 1, offsetLeft: 0, offsetTop: 0, width: layoutW, height: layoutH }};
      }}
      const scale = vv.scale > 0 ? vv.scale : 1;
      return {{
        scale,
        offsetLeft: vv.offsetLeft || 0,
        offsetTop: vv.offsetTop || 0,
        width: vv.width * scale,
        height: vv.height * scale
      }};
    }}

    getLocalRect(el) {{
      const r = el.getBoundingClientRect();
      const m = this.getViewportMetrics();
      const left = (r.left - m.offsetLeft) * m.scale;
      const top = (r.top - m.offsetTop) * m.scale;
      const width = r.width * m.scale;
      const height = r.height * m.scale;
      return {{ left, top, width, height, right: left + width, bottom: top + height }};
    }}

    applyViewportCompensation() {{
      if (!this.host) return;
      const m = this.getViewportMetrics();
      const isIdentity = Math.abs(m.scale - 1) < 0.01 && Math.abs(m.offsetLeft) < 0.5 && Math.abs(m.offsetTop) < 0.5;
      const transform = isIdentity ? 'none' : `translate(${{m.offsetLeft}}px, ${{m.offsetTop}}px) scale(${{1 / m.scale}})`;
      this.host.style.setProperty('--besing-host-w', `${{Math.round(m.width)}}px`);
      this.host.style.setProperty('--besing-host-h', `${{Math.round(m.height)}}px`);
      this.host.style.setProperty('--besing-vw', `${{Math.round(m.width)}}px`);
      this.host.style.setProperty('--besing-vh', `${{Math.round(m.height)}}px`);
      this.host.style.setProperty('--besing-host-transform', transform);
    }}

    attachViewportTracking() {{
      if (this._viewportHandler) return;
      this._viewportHandler = () => {{
        if (this._viewportFrame) return;
        this._viewportFrame = requestAnimationFrame(() => {{
          this._viewportFrame = 0;
          if (this.disposed) return;
          this.applyViewportCompensation();
          if (this.widgetEl && !this.isDragging) {{
            this.restoreWidgetPosition();
            this.checkEdgeDocking(this.widgetEl);
          }}
          if (this.menuWrapperEl) {{
            this.positionBubble(this.menuWrapperEl, this.menuWrapperEl.querySelector('.besing-bubble-panel'), this.menuWrapperEl.querySelector('.besing-bubble-arrow'));
          }}
        }});
      }};
      window.addEventListener('resize', this._viewportHandler);
      window.addEventListener('orientationchange', this._viewportHandler);
      if (window.visualViewport) {{
        window.visualViewport.addEventListener('resize', this._viewportHandler);
        window.visualViewport.addEventListener('scroll', this._viewportHandler);
      }}
    }}

    detachViewportTracking() {{
      if (!this._viewportHandler) return;
      window.removeEventListener('resize', this._viewportHandler);
      window.removeEventListener('orientationchange', this._viewportHandler);
      if (window.visualViewport) {{
        window.visualViewport.removeEventListener('resize', this._viewportHandler);
        window.visualViewport.removeEventListener('scroll', this._viewportHandler);
      }}
      if (this._viewportFrame) cancelAnimationFrame(this._viewportFrame);
      this._viewportFrame = 0;
      this._viewportHandler = null;
    }}

    // Re-applies the saved position clamped to the current viewport without saving the clamp,
    // so a temporary shrink (on-screen keyboard, rotation) does not overwrite where the user put it.
    restoreWidgetPosition() {{
      if (!this.widgetEl) return;
      const saved = this.storage.getWidgetPosition();
      if (!saved || saved.x === undefined || saved.y === undefined) return;
      const m = this.getViewportMetrics();
      if (m.width < 200 || m.height < 200) return;
      const left = Math.max(0, Math.min(m.width - 48, saved.x));
      const top = Math.max(0, Math.min(m.height - 48, saved.y));
      this.widgetEl.style.left = `${{left}}px`;
      this.widgetEl.style.top = `${{top}}px`;
      this.widgetEl.style.right = 'auto';
      this.widgetEl.style.bottom = 'auto';
    }}

    // Keeps the widget on screen for the current viewport. The saved position is only written
    // by explicit user actions (drag, pull up, reset), never by a clamp.
    clampWidgetPosition() {{
      this.applyViewportCompensation();
      this.restoreWidgetPosition();
    }}

    pullUpIcon() {{
      if (this.storage.isCurrentBlocked()) {{
        console.log('[BESing] Site was blocked. Mounting and opening settings...');
        this.mount();
        this.openModal('settings');
        return;
      }}

      this.ensureMounted('pull-up');

      if (!this.widgetEl) {{
        if (this.shadow) this.renderWidget(this.shadow);
        else this.mount();
      }}

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

      this.widgetEl.style.left = `${{targetLeft}}px`;
      this.widgetEl.style.top = `${{targetTop}}px`;
      this.widgetEl.style.right = 'auto';
      this.widgetEl.style.bottom = 'auto';
      this.widgetEl.style.display = 'flex';
      this.widgetEl.style.opacity = '1';
      this.widgetEl.style.visibility = 'visible';

      this.storage.setWidgetPosition({{ x: targetLeft, y: targetTop }});

      // 3. Highlight with bright pulse animation
      this.widgetEl.classList.remove('besing-pulse-alert');
      void this.widgetEl.offsetWidth; // reflow
      this.widgetEl.classList.add('besing-pulse-alert');
      setTimeout(() => {{
        if (this.widgetEl) this.widgetEl.classList.remove('besing-pulse-alert');
      }}, 2500);

      console.log(`[BESing] Pull-up icon succeeded at (${{targetLeft}}, ${{targetTop}})`);
    }}

    resetWidgetPosition() {{
      if (this.widgetEl) {{
        this.widgetEl.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        this.widgetEl.style.left = '';
        this.widgetEl.style.top = '';
        this.widgetEl.style.right = '18px';
        this.widgetEl.style.bottom = '90px';
        this.widgetEl.style.display = 'flex';
      }}
      this.storage.setWidgetPosition(null);
      this.pullUpIcon();
    }}

    blinkRedirectAlert() {{
      if (!this.widgetEl) return;
      this.widgetEl.classList.remove('redirect-alert');
      void this.widgetEl.offsetWidth;
      this.widgetEl.classList.add('redirect-alert');
      setTimeout(() => {{
        if (this.widgetEl) this.widgetEl.classList.remove('redirect-alert');
      }}, 1200);
    }}

    teardown() {{
      if (this._heartbeatInterval) {{
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }}
      if (this._domObserver) {{
        this._domObserver.disconnect();
        this._domObserver = null;
      }}
      if (this.outsideClickHandler) {{
        document.removeEventListener('click', this.outsideClickHandler);
        this.outsideClickHandler = null;
      }}
      this.modules.forEach(m => {{
        try {{ m.destroy(); }} catch (e) {{}}
        m.running = false;
      }});
      if (this.host) {{
        this.host.remove();
        this.host = null;
        this.shadow = null;
        this.widgetEl = null;
        this.menuWrapperEl = null;
      }}
    }}

    renderWidget(shadow) {{
      const btn = document.createElement('div');
      btn.className = 'besing-trigger';
      btn.id = 'besing-widget-btn';

      const savedPos = this.storage.getWidgetPosition();
      const m = this.getViewportMetrics();
      const maxW = Math.max(300, m.width || 800);
      const maxH = Math.max(300, m.height || 600);

      if (savedPos && savedPos.x !== undefined && savedPos.y !== undefined) {{
        const clampX = Math.max(0, Math.min(maxW - 48, savedPos.x));
        const clampY = Math.max(0, Math.min(maxH - 48, savedPos.y));
        btn.style.left = `${{clampX}}px`;
        btn.style.top = `${{clampY}}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      }} else {{
        btn.style.right = '18px';
        btn.style.bottom = '90px';
      }}

      this.widgetEl = btn;
      this.updatePetIcon(btn);
      this.updateBadge();
      this.setupDragging(btn);
      shadow.appendChild(btn);

      setTimeout(() => this.checkEdgeDocking(btn), 150);
    }}

    updateBadge() {{
      if (!this.widgetEl) return;
      let badge = this.widgetEl.querySelector('.besing-badge-count');
      const currentHost = this.storage.getCurrentHost();
      const activeCount = this.modules.filter(m => this.storage.isScriptActiveOnSite(m.id, currentHost)).length;
      if (!badge) {{
        badge = document.createElement('span');
        badge.className = 'besing-badge-count';
        this.widgetEl.appendChild(badge);
      }}
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'flex' : 'none';
    }}

    safeParseHTML(htmlStr) {{
      if (!htmlStr) return document.createDocumentFragment();
      const frag = document.createDocumentFragment();
      const svgNS = 'http://www.w3.org/2000/svg';

      const tokenRegex = /<!--[\\s\\S]*?-->|<\\s*(\\/?)\\s*([a-zA-Z0-9\\-:]+)([^>]*?)(\\/?>)|([^<]+)/g;
      const attrRegex = /([a-zA-Z0-9\\-:]+)(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?/g;

      const voidElements = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
        'link', 'meta', 'param', 'source', 'track', 'wbr',
        'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'stop'
      ]);

      const stack = [{{ node: frag, inSVG: false }}];
      let match;

      while ((match = tokenRegex.exec(htmlStr)) !== null) {{
        if (match[0].startsWith('<!--')) continue;
        if (match[5]) {{
          const text = match[5];
          if (text) {{
            stack[stack.length - 1].node.appendChild(document.createTextNode(text));
          }}
          continue;
        }}

        const isClosing = match[1] === '/';
        const rawTagName = match[2];
        const tagName = rawTagName ? rawTagName.toLowerCase() : '';
        const rawAttrs = match[3];
        const isSelfClosing = (match[4] && match[4].startsWith('/')) || voidElements.has(tagName);

        if (isClosing) {{
          for (let i = stack.length - 1; i > 0; i--) {{
            if (stack[i].tagName === tagName) {{
              stack.length = i;
              break;
            }}
          }}
        }} else if (tagName) {{
          const parent = stack[stack.length - 1];
          const isSVGTag = tagName === 'svg' || parent.inSVG;
          
          const el = isSVGTag ? document.createElementNS(svgNS, tagName) : document.createElement(tagName);

          let aMatch;
          attrRegex.lastIndex = 0;
          while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {{
            const aName = aMatch[1];
            if (aName === '/' || !aName) continue;
            const aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] !== undefined ? aMatch[4] : ''));
            if (aName.startsWith('on')) continue;
            if (aName === 'class') {{
              if (!isSVGTag) el.className = aVal;
              el.setAttribute('class', aVal);
            }} else if (aName === 'style') {{
              el.style.cssText = aVal;
              el.setAttribute('style', aVal);
            }} else if (aName === 'checked') {{
              el.checked = true;
            }} else if (aName === 'disabled') {{
              el.disabled = true;
            }} else if (aName === 'selected') {{
              el.selected = true;
            }} else if (aName === 'value' && (tagName === 'input' || tagName === 'textarea' || tagName === 'select')) {{
              el.value = aVal;
              el.setAttribute('value', aVal);
            }} else {{
              el.setAttribute(aName, aVal);
            }}
          }}

          parent.node.appendChild(el);

          if (!isSelfClosing) {{
            stack.push({{ node: el, inSVG: isSVGTag, tagName: tagName }});
          }}
        }}
      }}
      return frag;
    }}

    createSVG(svgString) {{
      if (!svgString) return null;
      const frag = this.safeParseHTML(svgString);
      return frag.querySelector('svg') || frag.firstElementChild || null;
    }}

    setSafeHTML(container, htmlString) {{
      if (!container) return;
      while (container.firstChild) {{
        container.removeChild(container.firstChild);
      }}
      if (!htmlString) return;
      const frag = this.safeParseHTML(htmlString);
      container.appendChild(frag);
    }}

    updatePetIcon(btn) {{
      const theme = this.storage.getTheme();
      let inner = '';
      if (theme === 'minimal') {{
        inner = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
        `;
      }} else if (theme === 'pixel-dino') {{
        inner = `
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="18" rx="6" fill="#14532d" stroke="#4ade80" stroke-width="1.5"/>
            <rect x="10" y="13" width="3" height="4" fill="#86efac" class="besing-pet-eye"/>
            <rect x="19" y="13" width="3" height="4" fill="#86efac" class="besing-pet-eye"/>
            <path d="M12 21h8" stroke="#86efac" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `;
      }} else if (theme === 'slime') {{
        inner = `
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M7 22C7 13 10 9 16 9C22 9 25 13 25 22C25 25 21 26 16 26C11 26 7 25 7 22Z" fill="#065f46" stroke="#34d399" stroke-width="1.5"/>
            <circle cx="12" cy="17" r="2" fill="#a7f3d0" class="besing-pet-eye"/>
            <circle cx="20" cy="17" r="2" fill="#a7f3d0" class="besing-pet-eye"/>
            <path d="M14 21C15 22 17 22 18 21" stroke="#a7f3d0" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      }} else {{
        // Cyber Pet (Default)
        inner = `
          <svg class="besing-pet-face" width="30" height="30" viewBox="0 0 32 32" fill="none">
            <path d="M7 10L11 14V11C11 9 13 7 16 7C19 7 21 9 21 11V14L25 10C26 9 27 10 27 12V21C27 24 24 26 21 26H11C8 26 5 24 5 21V12C5 10 6 9 7 10Z" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
            <ellipse class="besing-pet-eye" cx="11.5" cy="17" rx="2" ry="3" fill="#38bdf8"/>
            <ellipse class="besing-pet-eye" cx="20.5" cy="17" rx="2" ry="3" fill="#38bdf8"/>
            <path d="M14 21.5C15 22.5 17 22.5 18 21.5" stroke="#c084fc" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        `;
      }}
      const oldSvg = btn.querySelector('svg');
      if (oldSvg) oldSvg.remove();
      const node = this.createSVG(inner);
      if (node) {{
        btn.insertBefore(node, btn.firstChild);
      }} else {{
        this.setSafeHTML(btn, inner);
      }}
      this.updateBadge();
    }}

    setupDragging(btn) {{
      let lastToggleTime = 0;
      let isTouch = false;
      const doToggle = () => {{
        const now = Date.now();
        if (now - lastToggleTime < 350) return;
        lastToggleTime = now;
        this.toggleModal();
      }};

      const onStart = (e) => {{
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
        if (!isNaN(styleLeft) && !isNaN(styleTop)) {{
          this.initialLeft = styleLeft;
          this.initialTop = styleTop;
        }} else {{
          const rect = this.getLocalRect(btn);
          this.initialLeft = rect.left;
          this.initialTop = rect.top;
        }}
        this._dragScale = this.getViewportMetrics().scale;

        window.addEventListener('mousemove', onMove, {{ passive: false }});
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, {{ passive: false }});
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
      }};

      const onMove = (e) => {{
        if (!this.isDragging) return;
        const pt = e.touches ? e.touches[0] : e;
        if (!pt) return;
        const dx = pt.clientX - this.startX;
        const dy = pt.clientY - this.startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {{
          this.dragMoved = true;
          if (e.cancelable) e.preventDefault();
        }}

        // Pointer deltas are in zoomed page pixels; the widget lives in unzoomed local pixels.
        const s = this._dragScale || 1;
        const m = this.getViewportMetrics();
        const newL = Math.max(0, Math.min(m.width - 48, this.initialLeft + dx * s));
        const newT = Math.max(0, Math.min(m.height - 48, this.initialTop + dy * s));

        btn.style.left = `${{newL}}px`;
        btn.style.top = `${{newT}}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';

        if (this.menuWrapperEl) {{
          this.positionBubble(this.menuWrapperEl, this.menuWrapperEl.querySelector('.besing-bubble-panel'), this.menuWrapperEl.querySelector('.besing-bubble-arrow'));
        }}
      }};

      const onEnd = () => {{
        if (!this.isDragging) return;
        this.isDragging = false;
        btn.style.transition = '';

        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);

        // Only a real drag moves the saved position; a tap leaves it alone.
        if (this.dragMoved) {{
          const left = parseFloat(btn.style.left);
          const top = parseFloat(btn.style.top);
          if (!isNaN(left) && !isNaN(top)) {{
            this.storage.setWidgetPosition({{ x: Math.round(left), y: Math.round(top) }});
          }}
        }}
        this.checkEdgeDocking(btn);

        if (!this.dragMoved && isTouch) {{
          this._justTouchToggled = true;
          setTimeout(() => {{ this._justTouchToggled = false; }}, 600);
          doToggle();
        }}
      }};

      btn.addEventListener('mousedown', onStart);
      btn.addEventListener('touchstart', onStart, {{ passive: true }});
      btn.addEventListener('click', (e) => {{
        if (this.dragMoved || this._justTouchToggled) {{
          this.dragMoved = false;
          return;
        }}
        doToggle();
      }});
    }}

    checkEdgeDocking(btn) {{
      if (!btn) return;
      const m = this.getViewportMetrics();
      const clientW = m.width;
      const clientH = m.height;
      if (clientW < 200 || clientH < 200) return;

      // Measure unfolded: the fold transform would otherwise shift the rect toward the edge.
      btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
      const rect = this.getLocalRect(btn);
      const margin = 14;

      if (rect.right >= clientW - margin) {{
        btn.classList.add('folded-right');
      }} else if (rect.left <= margin) {{
        btn.classList.add('folded-left');
      }}

      if (rect.top <= margin) {{
        btn.classList.add('folded-top');
      }} else if (rect.bottom >= clientH - margin) {{
        btn.classList.add('folded-bottom');
      }}
    }}

    toggleModal() {{
      if (this.menuWrapperEl) {{
        this.closeModal();
      }} else {{
        this.openModal('extensions');
      }}
    }}

    openModal(view = 'extensions') {{
      if (this.disposed || !IS_TOP_FRAME) return;
      if (this.outsideClickHandler) {{
        document.removeEventListener('click', this.outsideClickHandler, true);
        document.removeEventListener('click', this.outsideClickHandler, false);
        this.outsideClickHandler = null;
      }}
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
      tagSpan.textContent = `v${{BESUpdater.CURRENT_VERSION}}`;
      titleGroup.appendChild(titleSpan);
      titleGroup.appendChild(tagSpan);
      logoGroup.appendChild(titleGroup);
      header.appendChild(logoGroup);

      const headerActions = document.createElement('div');
      headerActions.className = 'besing-header-actions';

      const settingsBtn = document.createElement('button');
      settingsBtn.className = `besing-btn-icon ${{this.currentView === 'settings' ? 'active' : ''}}`;
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

      closeBtn.onclick = (e) => {{
        e.stopPropagation();
        this.closeModal();
      }};
      expandBtn.onclick = (e) => {{
        e.stopPropagation();
        this.isExpanded = !this.isExpanded;
        panel.classList.toggle('is-expanded', this.isExpanded);
        this.positionBubble(wrapper, panel, arrow);
      }};
      settingsBtn.onclick = (e) => {{
        e.stopPropagation();
        this.currentView = this.currentView === 'settings' ? 'extensions' : 'settings';
        settingsBtn.classList.toggle('active', this.currentView === 'settings');
        this.renderBody();
      }};

      setTimeout(() => {{
        if (!this.menuWrapperEl || this.menuWrapperEl !== wrapper) return;
        this.outsideClickHandler = (e) => {{
          if (!this.menuWrapperEl) return;
          const path = e.composedPath ? e.composedPath() : [];
          if (!path.includes(wrapper) && (!this.widgetEl || !path.includes(this.widgetEl))) {{
            this.closeModal();
          }}
        }};
        document.addEventListener('click', this.outsideClickHandler);
      }}, 80);

      this.renderBody();
    }}

    positionBubble(wrapper, panel, arrow) {{
      if (panel) {{
        panel.style.removeProperty('max-height');
        panel.style.removeProperty('min-height');
      }}
      if (this.isExpanded) {{
        wrapper.style.left = '50%';
        wrapper.style.top = '50%';
        wrapper.style.bottom = 'auto';
        wrapper.style.right = 'auto';
        wrapper.style.transform = 'translate(-50%, -50%)';
        arrow.style.display = 'none';
        return;
      }}

      arrow.style.display = 'block';
      const margin = 14;
      const m = this.getViewportMetrics();
      const bubbleW = Math.min(390, Math.max(200, m.width - 28));

      if (this.widgetEl) {{
        const clientW = m.width;
        const clientH = m.height;
        const rect = this.getLocalRect(this.widgetEl);
        const center = rect.left + rect.width / 2;
        const left = Math.max(margin, Math.min(clientW - bubbleW - margin, center - bubbleW / 2));
        const isBottom = rect.top > clientH / 2;

        // Cap the panel to the space on its side of the widget so it never runs off screen.
        const available = isBottom ? rect.top - 10 - margin : clientH - rect.bottom - 10 - margin;
        if (panel) panel.style.setProperty('max-height', `${{Math.max(200, Math.round(available))}}px`, 'important');
        if (panel) panel.style.setProperty('min-height', `${{Math.min(380, Math.max(200, Math.round(available)))}}px`, 'important');

        if (isBottom) {{
          wrapper.style.bottom = `${{clientH - rect.top + 10}}px`;
          wrapper.style.top = 'auto';
          arrow.className = 'besing-bubble-arrow arrow-bottom';
        }} else {{
          wrapper.style.top = `${{rect.bottom + 10}}px`;
          wrapper.style.bottom = 'auto';
          arrow.className = 'besing-bubble-arrow arrow-top';
        }}

        wrapper.style.left = `${{left}}px`;
        wrapper.style.right = 'auto';
        wrapper.style.transform = 'none';

        const arrowX = Math.max(16, Math.min(bubbleW - 24, center - left - 7));
        arrow.style.left = `${{arrowX}}px`;
      }} else {{
        wrapper.style.right = '20px';
        wrapper.style.bottom = '80px';
        arrow.style.display = 'none';
      }}
    }}

    renderBody() {{
      const body = this.menuWrapperEl ? this.menuWrapperEl.querySelector('#besing-body') : null;
      if (!body) return;
      const prevScroll = body.scrollTop;
      const isSameView = this._prevRenderedView === this.currentView;
      this._prevRenderedView = this.currentView;
      try {{
        this.setSafeHTML(body, '');

      if (this.currentView === 'settings') {{
        const currentHost = window.location.hostname || 'localhost';
        const curTheme = this.storage.getTheme();

        this.setSafeHTML(body, `
          <div class="besing-settings-section">
            <div class="besing-theme-picker">
              <div class="besing-section-title">Display Pattern & Desktop Pet</div>
              <div class="besing-theme-grid">
                <button class="besing-theme-btn ${{curTheme==='cyber-pet'?'active':''}}" data-t="cyber-pet">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="5" y="8" width="22" height="18" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/><ellipse cx="11.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/><ellipse cx="20.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/></svg>
                  <span>Cyber Pet</span>
                </button>
                <button class="besing-theme-btn ${{curTheme==='slime'?'active':''}}" data-t="slime">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><path d="M7 22C7 13 10 9 16 9C22 9 25 13 25 22C25 25 21 26 16 26C11 26 7 25 7 22Z" fill="#065f46" stroke="#34d399" stroke-width="2"/></svg>
                  <span>Cozy Slime</span>
                </button>
                <button class="besing-theme-btn ${{curTheme==='pixel-dino'?'active':''}}" data-t="pixel-dino">
                  <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="6" y="8" width="20" height="18" rx="6" fill="#14532d" stroke="#4ade80" stroke-width="2"/></svg>
                  <span>Pixel Dino</span>
                </button>
                <button class="besing-theme-btn ${{curTheme==='minimal'?'active':''}}" data-t="minimal">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
                  <span>Minimal</span>
                </button>
              </div>
            </div>

            <div class="besing-update-card">
              <div class="besing-update-header">
                <span class="besing-section-title">Update Channel</span>
                <span class="besing-status-pill connected" id="besing-update-pill">
                  <span id="besing-update-pill-text">v${{BESUpdater.CURRENT_VERSION}}</span>
                </span>
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">
                ${{BESUpdater.isStableLoader() ? 'Mode: <strong style="color:#38bdf8;">BESing Stable (Bootstrapper)</strong> (Automatic silent updates)' : 'Mode: <strong style="color:#a78bfa;">BESing Packed (Standalone)</strong> (Updates via Userscript Manager)'}}
              </div>
              ${{(!BESUpdater.isStableLoader() && ((typeof window !== 'undefined' && (window.__BESING_ENVIRONMENT__ === 'stable-loader' || typeof window.__BESING_AUTO_UPDATE__ === 'function')) || (typeof unsafeWindow !== 'undefined' && (unsafeWindow.__BESING_ENVIRONMENT__ === 'stable-loader' || typeof unsafeWindow.__BESING_AUTO_UPDATE__ === 'function')))) ? `
                <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#fca5a5;line-height:1.4;">
                  ⚠️ <strong>Duplicate Active:</strong> "BESing Stable" bootstrapper is also running on this page. Please disable "BESing Stable" in your userscript manager to prevent conflicts.
                </div>
              ` : ''}}
              <div class="besing-update-actions">
                <button class="besing-btn-sync" id="besing-btn-check-update" style="flex:1;">
                  ${{BESUpdater.isStableLoader() ? 'Check & Auto-Update Now' : 'Check Updates Now'}}
                </button>
              </div>
              <div class="besing-update-msg" id="besing-update-msg">
                ${{BESUpdater.isStableLoader() ? 'Updates download and apply automatically in background.' : 'Checks against Greasy Fork / GitHub releases.'}}
              </div>
            </div>

            <div class="besing-update-card" style="background:rgba(148,163,184,0.05);border-color:rgba(148,163,184,0.2);">
              <div class="besing-update-header">
                <span class="besing-section-title">Recent Page Loads</span>
                <button type="button" class="besing-btn-sub-action" id="besing-btn-clear-boot-log">Clear</button>
              </div>
              <div style="font-size:10px;color:#94a3b8;line-height:1.35;">
                Each page load BESing ran on, newest first. If a load you made is missing, your userscript manager never started BESing on it. "Stopped" means BESing started but the icon never appeared. The debug log holds the last ${{BOOT_LOG_LIMIT}} loads with timings and errors for a bug report.
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="besing-btn-sub-action" id="besing-btn-copy-boot-log" style="flex:1;min-height:34px;font-size:11px;color:#38bdf8;border-color:rgba(56,189,248,0.3);">Copy Debug Log</button>
                ${{navigator.share ? '<button type="button" class="besing-btn-sub-action" id="besing-btn-share-boot-log" style="flex:1;min-height:34px;font-size:11px;">Share</button>' : ''}}
                <button type="button" class="besing-btn-sub-action" id="besing-btn-view-boot-log" style="flex:1;min-height:34px;font-size:11px;">View Full Screen</button>
              </div>
              <div id="besing-boot-log-msg" style="font-size:10px;color:#34d399;display:none;"></div>
              <div id="besing-boot-log-list" style="display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:#cbd5e1;">Loading...</div>
            </div>

            <div class="besing-site-card">
              <div class="besing-site-card-header">
                <div>
                  <div class="besing-section-title" style="color:#38bdf8;">Current Website</div>
                  <div class="besing-current-domain">${{currentHost}}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="font-size:11px;color:${{this.storage.isCurrentBlocked() ? '#f87171' : '#94a3b8'}};">${{this.storage.isCurrentBlocked() ? 'Site Disabled' : 'Disable on this site'}}</span>
                  <label class="besing-switch" title="Disable all scripts on ${{currentHost}}">
                    <input type="checkbox" id="besing-btn-turn-off-site" ${{this.storage.isCurrentBlocked() ? 'checked' : ''}}>
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
                  ${{this.modules.map(mod => `<option value="${{mod.id}}">${{mod.name}}</option>`).join('')}}
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

        body.querySelectorAll('.besing-theme-btn').forEach(btn => {{
          btn.onclick = async () => {{
            const t = btn.getAttribute('data-t');
            await this.storage.setTheme(t);
            this.updatePetIcon(this.widgetEl);
            body.querySelectorAll('.besing-theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          }};
        }});

        const bootLogList = body.querySelector('#besing-boot-log-list');
        const bootLogMsg = body.querySelector('#besing-boot-log-msg');
        // Built ahead of the tap: iOS only allows clipboard writes and sharing during the tap
        // itself, and awaiting storage first would use that window up.
        let bootLogReport = '';
        const renderBootLog = async () => {{
          if (!bootLogList) return;
          const entries = await BESBootLog.read();
          bootLogReport = await BESBootLog.buildReport();
          bootLogList.textContent = '';
          if (!entries.length) {{
            bootLogList.textContent = 'No page loads recorded yet.';
            return;
          }}
          entries.forEach(e => {{
            const s = e.stages || {{}};
            const when = new Date(e.t || 0);
            const pad = (n) => String(n).padStart(2, '0');
            const time = `${{pad(when.getMonth() + 1)}}-${{pad(when.getDate())}} ${{pad(when.getHours())}}:${{pad(when.getMinutes())}}`;
            const status = BESBootLog.statusOf(e);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
            const left = document.createElement('span');
            left.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            left.textContent = `${{time}} ${{e.host || ''}}`;
            const right = document.createElement('span');
            right.style.cssText = `flex-shrink:0;color:${{s.mounted !== undefined ? '#34d399' : (s.blocked !== undefined ? '#94a3b8' : '#fbbf24')}};`;
            right.textContent = e.id === (BESBootLog.entry && BESBootLog.entry.id) ? `${{status}} (this page)` : status;
            row.appendChild(left);
            row.appendChild(right);
            bootLogList.appendChild(row);
          }});
        }};
        renderBootLog();
        const showBootLogMsg = (text, color) => {{
          if (!bootLogMsg) return;
          bootLogMsg.textContent = text;
          bootLogMsg.style.color = color;
          bootLogMsg.style.display = 'block';
        }};
        const copyBootLogBtn = body.querySelector('#besing-btn-copy-boot-log');
        if (copyBootLogBtn) {{
          copyBootLogBtn.onclick = async () => {{
            if (!bootLogReport) {{
              // Report not ready yet, so this tap cannot copy; the viewer's own Copy button can.
              openBootLogViewer(await BESBootLog.buildReport());
              return;
            }}
            const report = bootLogReport;
            const method = await copyTextToClipboard(report);
            BESBootLog.event(`log copy from settings: ${{method || 'failed'}}`);
            if (method) {{
              showBootLogMsg('Debug log copied. Paste it into your message.', '#34d399');
            }} else {{
              showBootLogMsg('This browser blocked copying, so the log opened full screen. Try Share there.', '#fbbf24');
              openBootLogViewer(report);
            }}
            renderBootLog();
          }};
        }}
        const shareBootLogBtn = body.querySelector('#besing-btn-share-boot-log');
        if (shareBootLogBtn) {{
          shareBootLogBtn.onclick = async () => {{
            if (!bootLogReport) {{
              openBootLogViewer(await BESBootLog.buildReport());
              return;
            }}
            const result = await shareText('BESing debug log', bootLogReport);
            if (result === 'unavailable') {{
              showBootLogMsg('Sharing is not available here, so the log opened full screen.', '#fbbf24');
              openBootLogViewer(bootLogReport);
            }}
          }};
        }}
        const viewBootLogBtn = body.querySelector('#besing-btn-view-boot-log');
        if (viewBootLogBtn) {{
          viewBootLogBtn.onclick = async () => {{
            openBootLogViewer(bootLogReport || await BESBootLog.buildReport());
          }};
        }}
        const clearBootLogBtn = body.querySelector('#besing-btn-clear-boot-log');
        if (clearBootLogBtn) {{
          clearBootLogBtn.onclick = async () => {{
            await BESBootLog.clear();
            if (bootLogMsg) bootLogMsg.style.display = 'none';
            renderBootLog();
          }};
        }}

        const checkBtn = body.querySelector('#besing-btn-check-update');
        const updateMsg = body.querySelector('#besing-update-msg');
        checkBtn.onclick = async () => {{
          checkBtn.disabled = true;
          updateMsg.textContent = 'Checking for updates...';
          try {{
            const res = await this.updater.checkForUpdates(true);
            if (res.ok) {{
              if (res.hasUpdate) {{
                if (res.isStableLoader && res.autoUpdated) {{
                  this.setSafeHTML(updateMsg, `<span style="color:#10b981;font-weight:700;">✅ Auto-Updated to v${{res.remoteVersion}}!</span> The latest code is installed. <button id="besing-btn-reload-now" style="margin-left:8px;padding:3px 8px;font-size:11px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reload Page</button> to activate.`);
                  const rBtn = body.querySelector('#besing-btn-reload-now');
                  if (rBtn) rBtn.onclick = () => window.location.reload();
                }} else {{
                  this.setSafeHTML(updateMsg, `<span style="color:#a78bfa;font-weight:700;">Update found!</span> v${{res.remoteVersion}} available. <a href="${{res.downloadUrl}}" target="_blank" style="color:#38bdf8;text-decoration:underline;">Click here to install update via Userscript Manager</a>.`);
                }}
              }} else {{
                updateMsg.textContent = `✅ BESing is up to date (v${{res.currentVersion}}).`;
              }}
            }} else {{
              updateMsg.textContent = `Check failed: ${{res.error}}`;
            }}
          }} catch (err) {{
            updateMsg.textContent = `Error: ${{err.message}}`;
          }} finally {{
            checkBtn.disabled = false;
          }}
        }};

        body.querySelector('#besing-btn-turn-off-site').onchange = async (e) => {{
          const val = e.target.checked;
          await this.storage.setSiteDisabledAll(currentHost, val);
          this.refreshCurrentSiteModules();
          if (!val) this.startHeartbeat();
          renderSiteRulesList();
        }};

        // Groups start collapsed except the current site; the open set survives re-renders.
        const expandedHosts = new Set([currentHost.toLowerCase()]);
        const renderSiteRulesList = () => {{
          const container = body.querySelector('#besing-site-rules-container');
          const countEl = body.querySelector('#besing-rules-count');
          if (!container) return;
          this.setSafeHTML(container, '');
          const allRules = this.storage.getAllSiteRules();
          const hosts = Object.keys(allRules).sort();
          if (countEl) countEl.textContent = hosts.length;

          if (!hosts.length) {{
            this.setSafeHTML(container, '<div class="besing-empty-state">No site-specific rules configured.<br><span style="font-size:10px;color:#64748b;">Set a script to "SITE" in the main list to enable it for a single site.</span></div>');
            return;
          }}

          hosts.forEach(host => {{
            const rule = allRules[host];
            const group = document.createElement('div');
            group.className = expandedHosts.has(host) ? 'besing-site-group' : 'besing-site-group collapsed';

            let ruleCount = 0;
            if (rule.disableAll) ruleCount++;
            if (rule.scripts) ruleCount += Object.keys(rule.scripts).length;
            if (rule.configs) {{
              Object.keys(rule.configs).forEach(sid => {{
                if (!rule.scripts || rule.scripts[sid] === undefined) ruleCount++;
              }});
            }}

            const groupHeader = document.createElement('div');
            groupHeader.className = 'besing-site-group-header';
            this.setSafeHTML(groupHeader, `
              <div class="besing-site-group-title">
                <svg class="besing-site-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span class="besing-site-host">${{host}}</span>
                <span class="besing-site-rule-count">${{ruleCount}} configured</span>
              </div>
              <button type="button" class="besing-btn-del-site" title="Remove all rules for ${{host}}">Remove Site</button>
            `);

            // Collapsible dropdown toggle: click header to expand/collapse rules
            groupHeader.onclick = (e) => {{
              if (e.target.closest('.besing-btn-del-site')) return;
              const collapsed = group.classList.toggle('collapsed');
              if (collapsed) expandedHosts.delete(host);
              else expandedHosts.add(host);
            }};

            groupHeader.querySelector('.besing-btn-del-site').onclick = async (e) => {{
              e.stopPropagation();
              await this.storage.removeSiteRule(host, 'all');
              renderSiteRulesList();
              this.refreshCurrentSiteModules();
            }};
            group.appendChild(groupHeader);

            const rulesList = document.createElement('div');
            rulesList.className = 'besing-site-subrules';

            if (rule.disableAll) {{
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
              row.querySelector('input').onchange = async (e) => {{
                await this.storage.toggleSiteRule(host, 'disableAll', e.target.checked);
                renderSiteRulesList();
                this.refreshCurrentSiteModules();
              }};
              row.querySelector('.besing-rule-remove').onclick = async (e) => {{
                e.stopPropagation();
                await this.storage.removeSiteRule(host, 'disableAll');
                renderSiteRulesList();
                this.refreshCurrentSiteModules();
              }};
              rulesList.appendChild(row);
            }}

            if (rule.scripts) {{
              Object.keys(rule.scripts).forEach(scriptId => {{
                const isEnabled = !!rule.scripts[scriptId];
                const m = this.modules.find(mod => mod.id === scriptId) || {{ name: scriptId }};
                const row = document.createElement('div');
                row.className = 'besing-site-rule-row';
                this.setSafeHTML(row, `
                  <div class="besing-site-rule-info">
                    <span class="besing-site-rule-name">${{m.name}}</span>
                    <span class="besing-site-rule-tag" style="${{isEnabled ? 'background:rgba(56,189,248,0.15);color:#38bdf8;' : 'background:rgba(245,158,11,0.15);color:#fbbf24;'}}">${{isEnabled ? 'Site ON' : 'Excluded (OFF)'}}</span>
                  </div>
                  <div class="besing-site-rule-actions">
                    <label class="besing-switch besing-switch-sm" title="Toggle between Site ON and Excluded (OFF)">
                      <input type="checkbox" ${{isEnabled ? 'checked' : ''}}>
                      <span class="besing-slider"></span>
                    </label>
                    <button class="besing-rule-remove" title="Remove rule">✕</button>
                  </div>
                `);
                row.querySelector('input').onchange = async (e) => {{
                  await this.storage.setSiteOverride(scriptId, host, e.target.checked ? 'site' : 'site-off');
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                }};
                row.querySelector('.besing-rule-remove').onclick = async (e) => {{
                  e.stopPropagation();
                  await this.storage.removeSiteOverride(scriptId, host);
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                }};
                rulesList.appendChild(row);
              }});
            }}

            if (rule.configs) {{
              Object.keys(rule.configs).forEach(scriptId => {{
                if (rule.scripts && rule.scripts[scriptId] !== undefined) return;
                const m = this.modules.find(mod => mod.id === scriptId) || {{ name: scriptId }};
                const row = document.createElement('div');
                row.className = 'besing-site-rule-row';
                this.setSafeHTML(row, `
                  <div class="besing-site-rule-info">
                    <span class="besing-site-rule-name">${{m.name}}</span>
                    <span class="besing-site-rule-tag" style="background:rgba(167,139,250,0.15);color:#a78bfa;">Custom Settings</span>
                  </div>
                  <div class="besing-site-rule-actions">
                    <button class="besing-rule-remove" title="Reset site settings">✕</button>
                  </div>
                `);
                row.querySelector('.besing-rule-remove').onclick = async (e) => {{
                  e.stopPropagation();
                  delete rule.configs[scriptId];
                  this.storage.cleanupSiteRule(host);
                  await BESAdapter.set('site_rules', this.storage.siteRules);
                  renderSiteRulesList();
                  this.refreshCurrentSiteModules();
                }};
                rulesList.appendChild(row);
              }});
            }}

            if (ruleCount === 0) {{
              const emptyRow = document.createElement('div');
              emptyRow.className = 'besing-site-rule-row';
              emptyRow.style.color = '#64748b';
              emptyRow.style.fontSize = '11px';
              emptyRow.style.padding = '6px 0';
              emptyRow.style.fontStyle = 'italic';
              emptyRow.textContent = 'No active rules configured for this site.';
              rulesList.appendChild(emptyRow);
            }}

            group.appendChild(rulesList);
            container.appendChild(group);
          }});
        }};
        renderSiteRulesList();

        const btnAddSiteRule = body.querySelector('#besing-settings-btn-add-rule');
        if (btnAddSiteRule) {{
          btnAddSiteRule.onclick = async () => {{
            const inputH = body.querySelector('#besing-settings-new-host');
            const selectS = body.querySelector('#besing-settings-new-script');
            const selectM = body.querySelector('#besing-settings-new-mode');
            const rawH = (inputH ? inputH.value : '').trim().toLowerCase().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '');
            if (!rawH) return;
            const scriptId = selectS ? selectS.value : (this.modules[0] ? this.modules[0].id : '');
            const modeVal = selectM ? selectM.value : 'site';
            await this.storage.setSiteOverride(scriptId, rawH, modeVal);
            inputH.value = '';
            renderSiteRulesList();
            this.refreshCurrentSiteModules();
          }};
        }}

      }} else if (this.currentView === 'script-config') {{
        this.renderScriptConfig(body);
      }} else {{
        // Extensions View: 3-stage toggles (OFF / SITE / ON)
        this.setSafeHTML(body, `
          <div class="besing-search-wrap">
            <svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="besing-search-input" placeholder="Search installed scripts..." value="${{this.searchQuery}}">
          </div>
          <div class="besing-ext-list" id="besing-ext-container"></div>
        `);

        const searchInput = body.querySelector('.besing-search-input');
        const extContainer = body.querySelector('#besing-ext-container');

        const renderCards = () => {{
          const prevScroll = body ? body.scrollTop : 0;
          this.setSafeHTML(extContainer, '');
          const q = this.searchQuery;
          const currentHost = this.storage.getCurrentHost();
          const filtered = this.modules.filter(m => {{
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
          }});

          const header = document.createElement('div');
          header.className = 'besing-section-heading';
          this.setSafeHTML(header, `
            <span>Installed Scripts</span>
            <span class="besing-pill-count">${{filtered.length}}</span>
          `);
          extContainer.appendChild(header);

          if (!filtered.length) {{
            const empty = document.createElement('div');
            empty.className = 'besing-empty-state';
            empty.textContent = q ? 'No scripts match your search.' : 'No scripts found.';
            extContainer.appendChild(empty);
            if (body && prevScroll > 0) body.scrollTop = prevScroll;
            return;
          }}

          filtered.forEach(m => {{
            const card = document.createElement('div');
            card.className = 'besing-ext-card';
            card.setAttribute('data-id', m.id);
            let currentMode = this.storage.getScriptMode(m.id, currentHost); // 'off' | 'site' | 'site-off' | 'on'

            let rotatorText = 'off';
            let rotatorTitle = 'State: OFF. Click to turn ON globally';
            if (currentMode === 'on') {{
              rotatorText = 'on';
              rotatorTitle = 'State: GLOBAL ON. Click to activate on THIS SITE ONLY';
            }} else if (currentMode === 'site') {{
              rotatorText = 'site on';
              rotatorTitle = `State: SITE ON (${{currentHost}}). Click to turn OFF globally`;
            }} else if (currentMode === 'site-off') {{
              rotatorText = 'site off';
              rotatorTitle = `State: EXCLUDED on ${{currentHost}}. Click to turn OFF globally`;
            }}

            this.setSafeHTML(card, `
              <div class="besing-ext-info-group">
                <div class="besing-ext-icon">${{m.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}}</div>
                <div class="besing-ext-meta">
                  <div class="besing-ext-title-row">
                    <span class="besing-ext-name" title="${{m.name}} • v${{m.version || '1.0.0'}} • ${{m.category || 'General'}}">${{m.name}}</span>
                  </div>
                  <p class="besing-ext-desc">${{m.description || ''}}</p>
                </div>
              </div>
              <div class="besing-ext-actions">
                <button type="button" class="besing-btn-script-gear" data-script-id="${{m.id}}" title="Configure ${{m.name}}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button type="button" class="besing-rotator-toggle mode-${{currentMode}}" data-script-id="${{m.id}}" title="${{rotatorTitle}}">
                  <span class="besing-rotator-knob"></span>
                  <span class="besing-rotator-text">${{rotatorText}}</span>
                </button>
              </div>
            `);

            const rotatorBtn = card.querySelector('.besing-rotator-toggle');
            rotatorBtn.onclick = async (e) => {{
              e.stopPropagation();
              let nextMode = 'on';
              if (currentMode === 'off') {{
                nextMode = 'on';
              }} else if (currentMode === 'on') {{
                nextMode = 'site';
              }} else if (currentMode === 'site') {{
                nextMode = 'off';
              }} else if (currentMode === 'site-off') {{
                nextMode = 'off';
              }}
              currentMode = nextMode;
              await this.storage.setScriptMode(m.id, nextMode, currentHost);

              // Update toggle state in-place to prevent resetting scroll position to top
              rotatorBtn.className = `besing-rotator-toggle mode-${{nextMode}}`;
              let rText = 'off';
              let rTitle = 'State: OFF. Click to turn ON globally';
              if (nextMode === 'on') {{
                rText = 'on';
                rTitle = 'State: GLOBAL ON. Click to activate on THIS SITE ONLY';
              }} else if (nextMode === 'site') {{
                rText = 'site on';
                rTitle = `State: SITE ON (${{currentHost}}). Click to turn OFF globally`;
              }} else if (nextMode === 'site-off') {{
                rText = 'site off';
                rTitle = `State: EXCLUDED on ${{currentHost}}. Click to turn OFF globally`;
              }}
              rotatorBtn.title = rTitle;
              const textSpan = rotatorBtn.querySelector('.besing-rotator-text');
              if (textSpan) textSpan.textContent = rText;

              this.refreshCurrentSiteModules();
            }};

            const btnGear = card.querySelector('.besing-btn-script-gear');
            if (btnGear) {{
              btnGear.onclick = (e) => {{
                e.stopPropagation();
                this.openScriptConfig(m.id);
              }};
            }}

            const infoGroup = card.querySelector('.besing-ext-info-group');
            if (infoGroup) {{
              infoGroup.style.cursor = 'pointer';
              infoGroup.title = 'Click to open configuration for ' + m.name;
              infoGroup.onclick = (e) => {{
                e.stopPropagation();
                this.openScriptConfig(m.id);
              }};
            }}

            extContainer.appendChild(card);
          }});

          if (body && prevScroll > 0) body.scrollTop = prevScroll;
          requestAnimationFrame(() => {{
            if (body && prevScroll > 0) body.scrollTop = prevScroll;
          }});
        }};

        if (searchInput) {{
          searchInput.oninput = (e) => {{
            this.searchQuery = e.target.value.toLowerCase().trim();
            renderCards();
          }};
        }}

        renderCards();
      }}
    }} catch (err) {{
      console.error('[BESing] Error rendering menu body:', err);
      this.setSafeHTML(body, `
        <div class="besing-empty-state" style="color:#fca5a5;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.05);padding:16px;">
          <div style="font-weight:700;margin-bottom:6px;">Failed to render script menu</div>
          <div style="font-size:11px;color:#94a3b8;font-family:monospace;">${{err.message || err}}</div>
          <button type="button" id="besing-btn-retry-render" style="margin-top:10px;padding:4px 10px;font-size:11px;background:#38bdf8;color:#0f172a;border:none;border-radius:6px;cursor:pointer;font-weight:700;">Retry</button>
        </div>
      `);
      const retryBtn = body.querySelector('#besing-btn-retry-render');
      if (retryBtn) retryBtn.onclick = () => this.renderBody();
    }}
    if (isSameView && prevScroll > 0) {{
      body.scrollTop = prevScroll;
    }}
  }}

    renderScriptConfig(body) {{
      const m = this.modules.find(mod => mod.id === this.activeConfigScriptId);
      if (!m) {{
        this.currentView = 'extensions';
        this.renderBody();
        return;
      }}

      const currentHost = this.storage.getCurrentHost();
      const currentMode = this.storage.getScriptMode(m.id, currentHost);
      const cfg = this.storage.getScriptConfig(m.id, currentHost);

      const isGloballyOn = !!this.storage.enabledScripts[m.id];
      let scopeNotice = '';
      if (currentMode === 'site') {{
        scopeNotice = `
          <div class="besing-config-scope site">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>
            <div><strong>Site-Only Config (${{currentHost}}):</strong> Settings are saved exclusively for this site and bypass global settings. Switching to OFF wipes this site's custom settings.</div>
          </div>
        `;
      }} else if (currentMode === 'site-off') {{
        scopeNotice = `
          <div class="besing-config-scope site-off">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <div><strong style="color:#fbbf24;">Excluded on ${{currentHost}}:</strong> Disabled specifically on this website, while remaining globally active on other sites.</div>
          </div>
        `;
      }} else if (currentMode === 'on') {{
        scopeNotice = `
          <div class="besing-config-scope global">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>
            <div><strong>Global Config:</strong> Saved globally across all websites (unless a site-only override exists).</div>
          </div>
        `;
      }} else {{
        scopeNotice = `
          <div class="besing-config-scope off">
            <div>⚪ <strong>Script is currently OFF.</strong> Switch toggle to <strong>${{isGloballyOn ? 'ON (GLOBAL)' : 'SITE ONLY'}}</strong> to activate.</div>
          </div>
        `;
      }}

      let specificControls = '';

      if (m.id === 'text-size-control') {{
        const curZoom = Math.max(70, Math.min(400, Number(cfg.fontSizePercent) || 125));
        const curMode = cfg.mode || 'hybrid';
        const presets = [100, 115, 125, 150, 175, 200, 250, 300];
        const presetsHtml = presets.map(p => `
          <button type="button" class="besing-zoom-pill ${{curZoom === p ? 'active' : ''}}" data-zoom="${{p}}">${{p}}%</button>
        `).join('');

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-zoom-hero">
              <div class="besing-zoom-val" id="besing-zoom-val">${{curZoom}}%</div>
              <div class="besing-zoom-desc">Active Text & Page Scale (Supports beyond 200% system max)</div>
            </div>

            <div class="besing-zoom-slider-row">
              <button type="button" class="besing-stepper-btn" id="btn-zoom-minus" title="Decrease">−</button>
              <input type="range" class="besing-slider-range" id="zoom-range" min="80" max="350" step="5" value="${{curZoom}}">
              <button type="button" class="besing-stepper-btn" id="btn-zoom-plus" title="Increase">+</button>
            </div>

            <div class="besing-section-title" style="margin-top:10px;">Scale Presets</div>
            <div class="besing-preset-row">
              ${{presetsHtml}}
            </div>

            <div class="besing-section-title" style="margin-top:10px;">Scaling Mode</div>
            <div class="besing-segmented-group" id="group-text-size-mode" style="margin-top:4px;">
              <button type="button" class="besing-segmented-btn ${{curMode === 'hybrid' ? 'active' : ''}}" data-mode="hybrid" title="Page zoom with paragraph unlock (Recommended)">⚡ Smart Hybrid</button>
              <button type="button" class="besing-segmented-btn ${{curMode === 'text-only' ? 'active' : ''}}" data-mode="text-only" title="Scales paragraphs and headings directly without altering page width">📖 Text Only</button>
              <button type="button" class="besing-segmented-btn ${{curMode === 'zoom' ? 'active' : ''}}" data-mode="zoom" title="Full layout and element zoom">🔍 Page Zoom</button>
            </div>

            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
              <button type="button" class="besing-btn-sub-action" id="btn-reset-zoom">Reset to 100%</button>
              <span style="font-size:10px;color:#64748b;">Counter-zoomed widget stays crisp</span>
            </div>
          </div>
        `;
      }} else if (m.id === 'color-change') {{
        const curBrightness = Math.max(-100, Math.min(100, Number(cfg.brightness) || 0));
        const curPreset = cfg.preset || 'eye-protect';
        const customColor = cfg.customColor || '#cce8cf';
        const curTextColor = cfg.textColor || 'default';
        const customTextColor = cfg.customTextColor || '#ffffff';

        const presets = [
          {{ key: 'none', name: 'Original', color: 'transparent', border: '#475569' }},
          {{ key: 'eye-protect', name: 'Eye Protect', color: '#cce8cf', border: '#86efac' }},
          {{ key: 'old-paper', name: 'Old Paper', color: '#f4ecd8', border: '#fcd34d' }},
          {{ key: 'dark', name: 'Dark Mode', color: '#18181b', border: '#38bdf8' }},
          {{ key: 'soft-sepia', name: 'Soft Sepia', color: '#eee4cd', border: '#d97706' }},
          {{ key: 'cool-mint', name: 'Cool Mint', color: '#e0f2fe', border: '#7dd3fc' }}
        ];

        const textPresets = [
          {{ key: 'default', name: 'Original', color: 'transparent', border: '#475569' }},
          {{ key: 'white', name: 'Pure White', color: '#ffffff', border: '#f8fafc' }},
          {{ key: 'black', name: 'Deep Black', color: '#0f172a', border: '#0f172a' }},
          {{ key: 'charcoal', name: 'Charcoal', color: '#334155', border: '#64748b' }},
          {{ key: 'gray', name: 'Soft Gray', color: '#94a3b8', border: '#94a3b8' }},
          {{ key: 'amber', name: 'Warm Cream', color: '#fef3c7', border: '#fde68a' }}
        ];

        const presetsHtml = presets.map(p => `
          <button type="button" class="besing-preset-card besing-bg-preset-card ${{curPreset === p.key ? 'active' : ''}}" data-preset="${{p.key}}">
            <span class="besing-preset-swatch" style="background:${{p.color}};border-color:${{p.border}}"></span>
            <span class="besing-preset-label">${{p.name}}</span>
          </button>
        `).join('');

        const textPresetsHtml = textPresets.map(p => `
          <button type="button" class="besing-preset-card besing-text-preset-card ${{curTextColor === p.key ? 'active' : ''}}" data-text-color="${{p.key}}">
            <span class="besing-preset-swatch" style="background:${{p.color}};border-color:${{p.border}}"></span>
            <span class="besing-preset-label">${{p.name}}</span>
          </button>
        `).join('');

        let bLabel = '🎯 Normal (Original Site BG)';
        if (curBrightness < 0) bLabel = `☀️ Lighter (+${{Math.abs(curBrightness)}}%)`;
        else if (curBrightness > 0) bLabel = `🌙 Deep Dark (+${{curBrightness}}%)`;

        let curTextColorName = 'Original';
        if (curTextColor === 'custom') curTextColorName = `Custom (${{customTextColor}})`;
        else {{
          const found = textPresets.find(p => p.key === curTextColor);
          if (found) curTextColorName = found.name;
        }}

        specificControls = `
          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Site BG Brightness Dragger</span>
              <span class="besing-brightness-badge" id="brightness-badge">${{bLabel}}</span>
            </div>
            <p style="font-size:10px;color:#94a3b8;line-height:1.35;margin-bottom:6px;">
              Adjusts brightness directly on top of the current website-set background (e.g. blue becomes light blue dragging left, deep navy and dark dragging right).
            </p>
            <div class="besing-brightness-labels">
              <span>☀️ Lighter (Drag Left)</span>
              <span>🌙 Deep / Dark (Drag Right)</span>
            </div>
            <input type="range" class="besing-slider-range brightness-range" id="brightness-range" min="-100" max="100" step="2" value="${{curBrightness}}">
            <div class="besing-range-ticks">
              <span>−100% (Light)</span>
              <span class="tick-center">0% (Normal)</span>
              <span>+100% (Dark)</span>
            </div>
          </div>

          <div class="besing-config-section" style="margin-top:10px;">
            <div class="besing-section-title">Background Tone Presets</div>
            <div class="besing-preset-grid">
              ${{presetsHtml}}
            </div>

            <div class="besing-custom-color-row">
              <label class="besing-custom-color-label">Custom Tone:</label>
              <input type="color" id="custom-color-picker" value="${{customColor}}">
              <input type="text" id="custom-color-hex" class="besing-input-sm" value="${{customColor}}">
              <button type="button" class="besing-btn-sub-action" id="btn-apply-custom-color">Apply Custom Tone</button>
            </div>
          </div>

          <div class="besing-config-section" style="margin-top:10px;">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Text Color Presets</span>
              <span class="besing-brightness-badge" id="text-color-badge">${{curTextColorName}}</span>
            </div>
            <p style="font-size:10px;color:#94a3b8;line-height:1.35;margin-bottom:6px;">
              Forces high-contrast text color across reading content, novel chapters, paragraphs, and headings to maintain clarity against custom background tones.
            </p>
            <div class="besing-preset-grid">
              ${{textPresetsHtml}}
            </div>

            <div class="besing-custom-color-row">
              <label class="besing-custom-color-label">Custom Text:</label>
              <input type="color" id="custom-text-color-picker" value="${{customTextColor}}">
              <input type="text" id="custom-text-color-hex" class="besing-input-sm" value="${{customTextColor}}">
              <button type="button" class="besing-btn-sub-action" id="btn-apply-custom-text">Apply Text Color</button>
            </div>

            <div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" class="besing-btn-sub-action" id="btn-reset-bg">Reset All Colors & Brightness</button>
            </div>
          </div>
        `;
      }} else if (m.id === 'force-copy') {{
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
                  <input type="checkbox" id="chk-allow-select" ${{allowSelect ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Force Allow Copy & Cut</div>
                  <div class="besing-toggle-desc">Bypasses Ctrl+C, Ctrl+X, and clipboard prevention listeners</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-copy" ${{allowCopy ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Force Allow Paste</div>
                  <div class="besing-toggle-desc">Permits pasting into protected password & text inputs</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-paste" ${{allowPaste ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Allow Right-Click Context Menu</div>
                  <div class="besing-toggle-desc">Bypasses right-click blocking event listeners</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-allow-context" ${{allowContextMenu ? 'checked' : ''}}>
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
      }} else if (m.id === 'ad-cleaner') {{
        const enableAutoClean = cfg.enableAutoClean !== false;
        const blockedSelectors = Array.isArray(cfg.blockedSelectors) ? cfg.blockedSelectors : [];
        let blockedListHtml = '';
        if (blockedSelectors.length === 0) {{
          blockedListHtml = `<div class="besing-zapped-empty">No custom elements zapped on this site yet.</div>`;
        }} else {{
          blockedListHtml = blockedSelectors.map((sel, idx) => `
            <div class="besing-zapped-item">
              <code class="besing-zapped-selector" title="${{sel}}">${{sel}}</code>
              <button type="button" class="besing-btn-restore-zapped" data-index="${{idx}}" title="Restore (unblock) this element">✕</button>
            </div>
          `).join('');
        }}

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
                <input type="checkbox" id="chk-auto-clean" ${{enableAutoClean ? 'checked' : ''}}>
                <span class="besing-slider"></span>
              </label>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row" style="margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#cbd5e1;">Zapped Elements on this Website (${{blockedSelectors.length}})</span>
              ${{blockedSelectors.length > 0 ? '<button type="button" class="besing-btn-sub-action" id="btn-clear-zapped" style="color:#f87171;">Clear All</button>' : ''}}
            </div>
            <div class="besing-zapped-list">
              ${{blockedListHtml}}
            </div>
          </div>
        `;
      }} else if (m.id === 'pagestream') {{
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
              <span class="besing-shortcut-badge" id="badge-when-load">${{whenToLoad === 'start' ? 'Start (15%)' : (whenToLoad === 'half point' ? 'Half Point (50%)' : 'Bottom (90%)')}}</span>
            </div>
            <div class="besing-segmented-group" id="group-when-load" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${{whenToLoad === 'start' ? 'active' : ''}}" data-when="start">Start</button>
              <button type="button" class="besing-segmented-btn ${{whenToLoad === 'half point' ? 'active' : ''}}" data-when="half point">Half Point (50%)</button>
              <button type="button" class="besing-segmented-btn ${{whenToLoad === 'bottom' ? 'active' : ''}}" data-when="bottom">Bottom (90%)</button>
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
                <span class="besing-stepper-val" id="val-preload-pages">${{preloadPages}}</span>
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
                <input type="checkbox" id="chk-stream-history" ${{enableHistory ? 'checked' : ''}}>
                <span class="besing-slider"></span>
              </label>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Streaming Engine Mode</span>
            </div>
            <div class="besing-segmented-group" id="group-stream-mode" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${{streamMode === 'auto' ? 'active' : ''}}" data-mode="auto">Smart Auto</button>
              <button type="button" class="besing-segmented-btn ${{streamMode === 'splice' ? 'active' : ''}}" data-mode="splice">Fetch & Splice</button>
              <button type="button" class="besing-segmented-btn ${{streamMode === 'click' ? 'active' : ''}}" data-mode="click">Auto Click</button>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row" style="margin-bottom:6px;">
              <span class="besing-section-title">Custom Selector Overrides</span>
              <span style="font-size:10px;color:#64748b;">Optional</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <input type="text" class="besing-test-input" id="input-custom-next" placeholder="Next link selector (e.g. a.next, #next_page)" value="${{customNextSelector}}">
              <input type="text" class="besing-test-input" id="input-custom-page" placeholder="Content container selector (e.g. #content, article)" value="${{customPageSelector}}">
              <button type="button" class="besing-btn-sub-action" id="btn-save-selectors" style="align-self:flex-end;">Save Custom Selectors</button>
            </div>
          </div>
        `;
      }} else if (m.id === 'rest-reminder') {{
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
              <span class="besing-shortcut-badge" id="badge-reminder-interval">${{intervalMinutes}} min</span>
            </div>
            <div class="besing-segmented-group" id="group-reminder-preset" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${{activePreset === '20' ? 'active' : ''}}" data-preset="20">20m (Default)</button>
              <button type="button" class="besing-segmented-btn ${{activePreset === '45' ? 'active' : ''}}" data-preset="45">45m</button>
              <button type="button" class="besing-segmented-btn ${{activePreset === '60' ? 'active' : ''}}" data-preset="60">60m</button>
              <button type="button" class="besing-segmented-btn ${{activePreset === 'custom' ? 'active' : ''}}" data-preset="custom">Custom</button>
            </div>
            <p style="font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.3;">
              When the time is up, a chat bubble pops up on the icon with Repeat and Off buttons. It remains until you choose an action. One timer is shared by every tab and site: Repeat or Off on any page applies everywhere within a few seconds.
            </p>
          </div>

          <div class="besing-config-section" id="section-custom-minutes" style="${{activePreset === 'custom' ? 'display:block;' : 'display:none;'}}">
            <div class="besing-toggle-row">
              <div>
                <div class="besing-toggle-title">Custom Duration (Minutes)</div>
                <div class="besing-toggle-desc">Set repeating rest interval (1–240 minutes)</div>
              </div>
              <div class="besing-stepper-row">
                <button type="button" class="besing-stepper-btn" id="btn-custom-minus">−</button>
                <input type="number" class="besing-test-input" id="input-custom-min" min="1" max="240" value="${{customMinutes}}" style="width:58px;padding:3px 6px;text-align:center;font-weight:700;font-family:monospace;color:#38bdf8;">
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
      }} else if (m.id === 'grok-exporter') {{
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
            <p style="font-size:11px;color:#cbd5e1;line-height:1.4;margin:0;" id="grok-export-status">${{statusText}}</p>
            <div style="display:flex;gap:8px;">
              <button type="button" class="besing-btn-zapper-launch" id="btn-grok-copy" ${{disabledAttr}} style="flex:1;background:linear-gradient(135deg, rgba(56,189,248,0.2), rgba(99,102,241,0.25));border:1px solid rgba(56,189,248,0.4);color:#38bdf8;box-shadow:none;${{disabledStyle}}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Copy Full Chat</span>
              </button>
              <button type="button" class="besing-btn-zapper-launch" id="btn-grok-download" ${{disabledAttr}} style="flex:1;background:linear-gradient(135deg, rgba(16,185,129,0.2), rgba(20,184,166,0.25));border:1px solid rgba(16,185,129,0.4);color:#34d399;box-shadow:none;${{disabledStyle}}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span id="grok-download-label">${{exportFormat === 'markdown' ? 'Download .md' : 'Download .txt'}}</span>
              </button>
            </div>
          </div>

          <div class="besing-config-section">
            <div class="besing-section-header-row">
              <span class="besing-section-title">Output Format</span>
            </div>
            <div class="besing-segmented-group" id="group-grok-format" style="margin-top:8px;">
              <button type="button" class="besing-segmented-btn ${{exportFormat === 'text' ? 'active' : ''}}" data-format="text">Plain Text</button>
              <button type="button" class="besing-segmented-btn ${{exportFormat === 'markdown' ? 'active' : ''}}" data-format="markdown">Markdown</button>
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
                  <input type="checkbox" id="chk-grok-floating" ${{showFloatingButtons ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Thinking</div>
                  <div class="besing-toggle-desc">Adds Grok's reasoning trace as a collapsible block when available</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-thinking" ${{includeThinking ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Timestamps</div>
                  <div class="besing-toggle-desc">Adds the send time next to each message heading</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-timestamps" ${{includeTimestamps ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>

              <div class="besing-toggle-row">
                <div>
                  <div class="besing-toggle-title">Include Web Sources</div>
                  <div class="besing-toggle-desc">Lists the web search results Grok used under each answer</div>
                </div>
                <label class="besing-switch besing-switch-sm">
                  <input type="checkbox" id="chk-grok-sources" ${{includeSources ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>
            </div>
          </div>
        `;
      }} else {{
        specificControls = `
          <div class="besing-config-section">
            <p style="font-size:11px;color:#94a3b8;line-height:1.4;">${{m.description || 'No additional custom options for this script.'}}</p>
            <div style="margin-top:12px;font-size:10px;color:#64748b;">
              Author: ${{m.author || 'BESing Team'}} | Category: ${{m.category || 'General'}}
            </div>
          </div>
        `;
      }}

      let triButtonsHtml = '';
      if (isGloballyOn) {{
        triButtonsHtml = `
          <button type="button" class="besing-tri-btn ${{currentMode === 'off' ? 'active active-off' : ''}}" data-mode="off" title="Turn OFF globally on all sites">OFF (ALL)</button>
          <button type="button" class="besing-tri-btn ${{currentMode === 'site-off' ? 'active active-site-off' : ''}}" data-mode="site-off" title="Disable only on ${{currentHost}}">OFF (SITE)</button>
          <button type="button" class="besing-tri-btn ${{currentMode === 'on' ? 'active active-on' : ''}}" data-mode="on" title="Active on all sites">ON (GLOBAL)</button>
        `;
      }} else {{
        triButtonsHtml = `
          <button type="button" class="besing-tri-btn ${{currentMode === 'off' ? 'active active-off' : ''}}" data-mode="off" title="Turn OFF completely">OFF</button>
          <button type="button" class="besing-tri-btn ${{currentMode === 'site' ? 'active active-site' : ''}}" data-mode="site" title="Active only on ${{currentHost}}">SITE ONLY</button>
          <button type="button" class="besing-tri-btn ${{currentMode === 'on' ? 'active active-on' : ''}}" data-mode="on" title="Turn ON globally across all sites">ON (GLOBAL)</button>
        `;
      }}

      this.setSafeHTML(body, `
        <div class="besing-secondary-header">
          <div class="besing-secondary-top-bar">
            <button type="button" class="besing-btn-back" id="besing-btn-back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              <span>All Scripts</span>
            </button>
            <div class="besing-tri-toggle" title="Status on ${{currentHost}}">
              ${{triButtonsHtml}}
            </div>
          </div>
          <div class="besing-secondary-title-group">
            <div class="besing-ext-icon sm">${{m.icon || ''}}</div>
            <div class="besing-secondary-meta">
              <span class="besing-secondary-title">${{m.name}}</span>
              <span class="besing-ext-ver" style="font-size:10px;color:#94a3b8;">v${{m.version || '1.0.0'}} • ${{m.category || 'General'}}</span>
            </div>
          </div>
        </div>

        ${{scopeNotice}}

        <div class="besing-secondary-content" style="display:flex;flex-direction:column;gap:10px;">
          ${{specificControls}}
        </div>
      `);

      // Bind Back Button
      const btnBack = body.querySelector('#besing-btn-back');
      if (btnBack) {{
        btnBack.onclick = () => {{
          this.currentView = 'extensions';
          this.renderBody();
        }};
      }}

      // Bind Tri-Toggle in Secondary Menu
      const btnOff = body.querySelector('[data-mode="off"]');
      const btnSite = body.querySelector('[data-mode="site"]');
      const btnSiteOff = body.querySelector('[data-mode="site-off"]');
      const btnOn = body.querySelector('[data-mode="on"]');

      const handleModeChange = async (newMode) => {{
        await this.storage.setScriptMode(m.id, newMode, currentHost);
        this.refreshCurrentSiteModules();
        this.renderBody();
      }};

      if (btnOff) btnOff.onclick = (e) => {{ e.stopPropagation(); handleModeChange('off'); }};
      if (btnSite) btnSite.onclick = (e) => {{ e.stopPropagation(); handleModeChange('site'); }};
      if (btnSiteOff) btnSiteOff.onclick = (e) => {{ e.stopPropagation(); handleModeChange('site-off'); }};
      if (btnOn) btnOn.onclick = (e) => {{ e.stopPropagation(); handleModeChange('on'); }};

      // Bind Handlers
      if (m.id === 'text-size-control') {{
        const zoomVal = body.querySelector('#besing-zoom-val');
        const zoomRange = body.querySelector('#zoom-range');
        const btnMinus = body.querySelector('#btn-zoom-minus');
        const btnPlus = body.querySelector('#btn-zoom-plus');
        const btnReset = body.querySelector('#btn-reset-zoom');

        const updateZoom = async (val) => {{
          const clamped = Math.max(80, Math.min(350, Math.round(val)));
          if (zoomVal) zoomVal.textContent = `${{clamped}}%`;
          if (zoomRange) zoomRange.value = clamped;
          body.querySelectorAll('.besing-zoom-pill').forEach(btn => {{
            btn.classList.toggle('active', Number(btn.getAttribute('data-zoom')) === clamped);
          }});
          await this.applyScriptConfig(m.id, {{ fontSizePercent: clamped }});
        }};

        if (zoomRange) {{
          zoomRange.oninput = (e) => updateZoom(e.target.value);
        }}
        if (btnMinus) {{
          btnMinus.onclick = () => updateZoom(Number(zoomRange.value) - 10);
        }}
        if (btnPlus) {{
          btnPlus.onclick = () => updateZoom(Number(zoomRange.value) + 10);
        }}
        if (btnReset) {{
          btnReset.onclick = () => updateZoom(100);
        }}
        body.querySelectorAll('.besing-zoom-pill').forEach(btn => {{
          btn.onclick = () => updateZoom(Number(btn.getAttribute('data-zoom')));
        }});

        const groupTextMode = body.querySelector('#group-text-size-mode');
        if (groupTextMode) {{
          groupTextMode.querySelectorAll('.besing-segmented-btn').forEach(btn => {{
            btn.onclick = async () => {{
              const modeVal = btn.getAttribute('data-mode');
              groupTextMode.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              await this.applyScriptConfig(m.id, {{ mode: modeVal }});
            }};
          }});
        }}
      }} else if (m.id === 'color-change') {{
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

        const updateBrightness = async (val) => {{
          const b = Number(val);
          if (bBadge) {{
            if (b < 0) bBadge.textContent = `☀️ Lighter (+${{Math.abs(b)}}%)`;
            else if (b > 0) bBadge.textContent = `🌙 Deep Dark (+${{b}}%)`;
            else bBadge.textContent = '🎯 Normal (Original BG)';
          }}
          await this.applyScriptConfig(m.id, {{ brightness: b }});
        }};

        if (bRange) {{
          bRange.oninput = (e) => updateBrightness(e.target.value);
        }}

        body.querySelectorAll('.besing-bg-preset-card').forEach(card => {{
          card.onclick = async () => {{
            const pKey = card.getAttribute('data-preset');
            body.querySelectorAll('.besing-bg-preset-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            await this.applyScriptConfig(m.id, {{ preset: pKey }});
          }};
        }});

        if (customPicker && customHex) {{
          customPicker.oninput = (e) => {{
            customHex.value = e.target.value;
          }};
          if (btnApplyCustom) {{
            btnApplyCustom.onclick = async () => {{
              const col = customHex.value.trim() || '#cce8cf';
              body.querySelectorAll('.besing-bg-preset-card').forEach(c => c.classList.remove('active'));
              await this.applyScriptConfig(m.id, {{ preset: 'custom', customColor: col }});
            }};
          }}
        }}

        body.querySelectorAll('.besing-text-preset-card').forEach(card => {{
          card.onclick = async () => {{
            const tKey = card.getAttribute('data-text-color');
            body.querySelectorAll('.besing-text-preset-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            if (tBadge) {{
              const names = {{ default: 'Original', white: 'Pure White', black: 'Deep Black', charcoal: 'Charcoal', gray: 'Soft Gray', amber: 'Warm Cream' }};
              tBadge.textContent = names[tKey] || tKey;
            }}
            await this.applyScriptConfig(m.id, {{ textColor: tKey }});
          }};
        }});

        if (customTextPicker && customTextHex) {{
          customTextPicker.oninput = (e) => {{
            customTextHex.value = e.target.value;
          }};
          if (btnApplyCustomText) {{
            btnApplyCustomText.onclick = async () => {{
              const col = customTextHex.value.trim() || '#ffffff';
              body.querySelectorAll('.besing-text-preset-card').forEach(c => c.classList.remove('active'));
              if (tBadge) tBadge.textContent = `Custom (${{col}})`;
              await this.applyScriptConfig(m.id, {{ textColor: 'custom', customTextColor: col }});
            }};
          }}
        }}

        if (btnResetBg) {{
          btnResetBg.onclick = async () => {{
            if (bRange) bRange.value = 0;
            updateBrightness(0);
            body.querySelectorAll('.besing-bg-preset-card').forEach(c => {{
              c.classList.toggle('active', c.getAttribute('data-preset') === 'none');
            }});
            body.querySelectorAll('.besing-text-preset-card').forEach(c => {{
              c.classList.toggle('active', c.getAttribute('data-text-color') === 'default');
            }});
            if (tBadge) tBadge.textContent = 'Original';
            await this.applyScriptConfig(m.id, {{ brightness: 0, preset: 'none', textColor: 'default' }});
          }};
        }}
      }} else if (m.id === 'force-copy') {{
        const chkSelect = body.querySelector('#chk-allow-select');
        const chkCopy = body.querySelector('#chk-allow-copy');
        const chkPaste = body.querySelector('#chk-allow-paste');
        const chkContext = body.querySelector('#chk-allow-context');

        const saveForceCopy = async () => {{
          await this.applyScriptConfig(m.id, {{
            allowSelect: !!(chkSelect && chkSelect.checked),
            allowCopy: !!(chkCopy && chkCopy.checked),
            allowPaste: !!(chkPaste && chkPaste.checked),
            allowContextMenu: !!(chkContext && chkContext.checked)
          }});
        }};

        if (chkSelect) chkSelect.onchange = saveForceCopy;
        if (chkCopy) chkCopy.onchange = saveForceCopy;
        if (chkPaste) chkPaste.onchange = saveForceCopy;
        if (chkContext) chkContext.onchange = saveForceCopy;
      }} else if (m.id === 'ad-cleaner') {{
        const btnLaunch = body.querySelector('#btn-launch-zapper');
        const chkAutoClean = body.querySelector('#chk-auto-clean');
        const btnClearAll = body.querySelector('#btn-clear-zapped');

        if (btnLaunch) {{
          btnLaunch.onclick = () => {{
            this.closeModal();
            const currentHost = this.storage.getCurrentHost();
            const currentCfg = this.storage.getScriptConfig(m.id, currentHost);
            if (typeof m.init === 'function' && !m.running) {{
              m.init(currentCfg);
              m.running = true;
            }}
            if (typeof m.startZapper === 'function') {{
              m.startZapper(async (sel, currentList) => {{
                await this.applyScriptConfig(m.id, {{ blockedSelectors: currentList }});
              }});
            }}
          }};
        }}

        if (chkAutoClean) {{
          chkAutoClean.onchange = async () => {{
            await this.applyScriptConfig(m.id, {{ enableAutoClean: chkAutoClean.checked }});
          }};
        }}

        if (btnClearAll) {{
          btnClearAll.onclick = async () => {{
            await this.applyScriptConfig(m.id, {{ blockedSelectors: [] }});
            this.renderBody();
          }};
        }}

        body.querySelectorAll('.besing-btn-restore-zapped').forEach(btn => {{
          btn.onclick = async (e) => {{
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-index'));
            const currentHost = this.storage.getCurrentHost();
            const currentCfg = this.storage.getScriptConfig(m.id, currentHost);
            const list = Array.isArray(currentCfg.blockedSelectors) ? [...currentCfg.blockedSelectors] : [];
            if (idx >= 0 && idx < list.length) {{
              list.splice(idx, 1);
              await this.applyScriptConfig(m.id, {{ blockedSelectors: list }});
              this.renderBody();
            }}
          }};
        }});
      }} else if (m.id === 'pagestream') {{
        // "When to load" 3-state buttons
        const groupWhen = body.querySelector('#group-when-load');
        const badgeWhen = body.querySelector('#badge-when-load');
        if (groupWhen) {{
          groupWhen.querySelectorAll('.besing-segmented-btn').forEach(btn => {{
            btn.onclick = async () => {{
              const whenVal = btn.getAttribute('data-when');
              groupWhen.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (badgeWhen) {{
                badgeWhen.textContent = whenVal === 'start' ? 'Start (15%)' : (whenVal === 'half point' ? 'Half Point (50%)' : 'Bottom (90%)');
              }}
              await this.applyScriptConfig(m.id, {{ whenToLoad: whenVal }});
            }};
          }});
        }}

        // Preload stepper
        const btnPreMinus = body.querySelector('#btn-preload-minus');
        const btnPrePlus = body.querySelector('#btn-preload-plus');
        const valPreload = body.querySelector('#val-preload-pages');
        const updatePreload = async (newVal) => {{
          const clamped = Math.max(0, Math.min(5, newVal));
          if (valPreload) valPreload.textContent = clamped;
          await this.applyScriptConfig(m.id, {{ preloadPages: clamped }});
        }};
        if (btnPreMinus && valPreload) {{
          btnPreMinus.onclick = () => updatePreload(Number(valPreload.textContent) - 1);
        }}
        if (btnPrePlus && valPreload) {{
          btnPrePlus.onclick = () => updatePreload(Number(valPreload.textContent) + 1);
        }}

        // History sync checkbox
        const chkHistory = body.querySelector('#chk-stream-history');
        if (chkHistory) {{
          chkHistory.onchange = async () => {{
            await this.applyScriptConfig(m.id, {{ enableHistory: chkHistory.checked }});
          }};
        }}

        // Streaming mode buttons
        const groupMode = body.querySelector('#group-stream-mode');
        if (groupMode) {{
          groupMode.querySelectorAll('.besing-segmented-btn').forEach(btn => {{
            btn.onclick = async () => {{
              const modeVal = btn.getAttribute('data-mode');
              groupMode.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              await this.applyScriptConfig(m.id, {{ mode: modeVal }});
            }};
          }});
        }}

        // Custom selectors
        const btnSaveSelectors = body.querySelector('#btn-save-selectors');
        const inNext = body.querySelector('#input-custom-next');
        const inPage = body.querySelector('#input-custom-page');
        if (btnSaveSelectors && inNext && inPage) {{
          btnSaveSelectors.onclick = async () => {{
            await this.applyScriptConfig(m.id, {{
              customNextSelector: inNext.value.trim(),
              customPageSelector: inPage.value.trim()
            }});
            btnSaveSelectors.textContent = 'Saved!';
            setTimeout(() => {{ btnSaveSelectors.textContent = 'Save Custom Selectors'; }}, 1500);
          }};
        }}
      }} else if (m.id === 'rest-reminder') {{
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
        const formatRemaining = (ms) => {{
          const total = Math.max(0, Math.ceil(ms / 1000));
          const h = Math.floor(total / 3600);
          const mm = Math.floor((total % 3600) / 60);
          const ss = total % 60;
          const pad = (n) => String(n).padStart(2, '0');
          return h > 0 ? `${{h}}:${{pad(mm)}}:${{pad(ss)}}` : `${{mm}}:${{pad(ss)}}`;
        }};
        const paintCountdown = () => {{
          if (!badgeRemaining || !badgeRemaining.isConnected) {{
            if (countdownTimer) clearInterval(countdownTimer);
            countdownTimer = null;
            return;
          }}
          const due = reminderState && !reminderState.off ? Number(reminderState.due) : 0;
          if (!m.running) {{
            badgeRemaining.textContent = 'Off';
            if (txtDue) txtDue.textContent = 'Rest Reminder is off on this site. Switch it on to start the timer.';
          }} else if (!due) {{
            badgeRemaining.textContent = 'Off';
            if (txtDue) txtDue.textContent = 'No reminder is scheduled.';
          }} else if (due <= Date.now()) {{
            badgeRemaining.textContent = 'Now';
            if (txtDue) txtDue.textContent = 'Time for a break. Use Repeat or Off on the chat bubble.';
          }} else {{
            badgeRemaining.textContent = formatRemaining(due - Date.now());
            const at = new Date(due);
            if (txtDue) txtDue.textContent = `Due at ${{String(at.getHours()).padStart(2, '0')}}:${{String(at.getMinutes()).padStart(2, '0')}}, shared by every tab and site.`;
          }}
        }};
        const refreshReminderState = async () => {{
          try {{
            const shared = await this.readSharedState(m.SHARED_KEY || 'rest_reminder', null);
            if (shared) reminderState = shared;
          }} catch (e) {{}}
          paintCountdown();
        }};
        if (badgeRemaining) {{
          let ticks = 0;
          paintCountdown();
          refreshReminderState();
          countdownTimer = setInterval(() => {{
            if (++ticks % 5 === 0) refreshReminderState();
            else paintCountdown();
          }}, 1000);
        }}

        const updateInterval = async (preset, minutes) => {{
          const clamped = Math.max(1, Math.min(240, Number(minutes) || 20));
          if (badgeInterval) badgeInterval.textContent = `${{clamped}} min`;
          if (inCustomMin && preset === 'custom') inCustomMin.value = clamped;
          if (secCustom) secCustom.style.display = preset === 'custom' ? 'block' : 'none';

          await this.applyScriptConfig(m.id, {{
            activePreset: preset,
            intervalMinutes: clamped,
            customMinutes: preset === 'custom' ? clamped : (Number(inCustomMin?.value) || 30)
          }});
          // A new interval starts a new cycle; show it once the shared state is written.
          setTimeout(refreshReminderState, 300);
        }};

        if (groupPreset) {{
          groupPreset.querySelectorAll('.besing-segmented-btn').forEach(btn => {{
            btn.onclick = async () => {{
              const pVal = btn.getAttribute('data-preset');
              groupPreset.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (pVal === 'custom') {{
                const custVal = Number(inCustomMin?.value) || 30;
                await updateInterval('custom', custVal);
              }} else {{
                await updateInterval(pVal, Number(pVal));
              }}
            }};
          }});
        }}

        if (btnMinus && inCustomMin) {{
          btnMinus.onclick = async () => {{
            const nextVal = Math.max(1, (Number(inCustomMin.value) || 30) - 5);
            inCustomMin.value = nextVal;
            await updateInterval('custom', nextVal);
          }};
        }}

        if (btnPlus && inCustomMin) {{
          btnPlus.onclick = async () => {{
            const nextVal = Math.min(240, (Number(inCustomMin.value) || 30) + 5);
            inCustomMin.value = nextVal;
            await updateInterval('custom', nextVal);
          }};
        }}

        if (inCustomMin) {{
          inCustomMin.onchange = async () => {{
            const val = Math.max(1, Math.min(240, Number(inCustomMin.value) || 20));
            inCustomMin.value = val;
            await updateInterval('custom', val);
          }};
        }}

        if (btnTest) {{
          btnTest.onclick = () => {{
            this.closeModal();
            if (typeof m.showReminderChatBox === 'function') {{
              m.showReminderChatBox({{ preview: true }});
            }}
          }};
        }}
      }} else if (m.id === 'grok-exporter') {{
        const btnCopy = body.querySelector('#btn-grok-copy');
        const btnDownload = body.querySelector('#btn-grok-download');
        const statusEl = body.querySelector('#grok-export-status');
        const currentCfg = () => this.storage.getScriptConfig(m.id, this.storage.getCurrentHost());

        const runExport = async (btn, action) => {{
          if (!btn || btn.disabled || typeof m[action] !== 'function') return;
          const label = btn.querySelector('span');
          const original = label ? label.textContent : '';
          btn.disabled = true;
          if (label) label.textContent = 'Working...';
          const result = await m[action](currentCfg());
          btn.disabled = false;
          if (label) label.textContent = original;
          if (statusEl && result) {{
            const verb = action === 'copyConversation' ? 'Copied' : 'Downloaded';
            const branchNote = result.branchCount > 1 ? ` (current branch of ${{result.branchCount}})` : '';
            statusEl.textContent = `${{verb}} ${{result.messageCount}} messages from "${{result.title}}"${{branchNote}}.`;
          }}
        }};

        if (btnCopy) btnCopy.onclick = () => runExport(btnCopy, 'copyConversation');
        if (btnDownload) btnDownload.onclick = () => runExport(btnDownload, 'downloadConversation');

        const bindToggle = (selector, key) => {{
          const chk = body.querySelector(selector);
          if (chk) {{
            chk.onchange = async () => {{
              await this.applyScriptConfig(m.id, {{ [key]: chk.checked }});
            }};
          }}
        }};
        const groupFormat = body.querySelector('#group-grok-format');
        const downloadLabel = body.querySelector('#grok-download-label');
        if (groupFormat) {{
          groupFormat.querySelectorAll('.besing-segmented-btn').forEach(btn => {{
            btn.onclick = async () => {{
              const formatVal = btn.getAttribute('data-format');
              groupFormat.querySelectorAll('.besing-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (downloadLabel) downloadLabel.textContent = formatVal === 'markdown' ? 'Download .md' : 'Download .txt';
              await this.applyScriptConfig(m.id, {{ format: formatVal }});
            }};
          }});
        }}
        bindToggle('#chk-grok-floating', 'showFloatingButtons');
        bindToggle('#chk-grok-thinking', 'includeThinking');
        bindToggle('#chk-grok-timestamps', 'includeTimestamps');
        bindToggle('#chk-grok-sources', 'includeSources');
      }}
    }}

    closeModal() {{
      if (this.outsideClickHandler) {{
        document.removeEventListener('click', this.outsideClickHandler, true);
        document.removeEventListener('click', this.outsideClickHandler, false);
        this.outsideClickHandler = null;
      }}
      if (this.menuWrapperEl) {{
        this.menuWrapperEl.remove();
        this.menuWrapperEl = null;
      }}
      if (this.storage.isCurrentBlocked()) {{
        this.teardown();
      }}
    }}

    injectStyles(shadow) {{
      const style = document.createElement('style');
      style.textContent = `
        :host {{ all: initial; position: fixed !important; top: 0 !important; left: 0 !important; width: var(--besing-host-w, 0px) !important; height: var(--besing-host-h, 0px) !important; transform: var(--besing-host-transform, none) !important; transform-origin: 0 0 !important; z-index: 2147483647 !important; pointer-events: none !important; overflow: visible !important; display: block !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }}
        *, *::before, *::after {{ box-sizing: border-box !important; margin: 0; padding: 0; }}
        svg {{ display: block !important; overflow: visible !important; flex-shrink: 0 !important; }}
        svg:not(:root) {{ overflow: visible !important; }}
        .besing-trigger {{ position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483647; pointer-events: auto; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }}
        @media (hover: hover) {{ .besing-trigger:hover {{ transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); }} }}
        .besing-trigger:active {{ cursor: grabbing; transform: scale(0.95); }}
        .besing-trigger.folded-left {{ transform: translateX(-24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-right {{ transform: translateX(24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-top {{ transform: translateY(-24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-bottom {{ transform: translateY(24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-top.folded-left {{ transform: translate(-24px, -24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-top.folded-right {{ transform: translate(24px, -24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-bottom.folded-left {{ transform: translate(-24px, 24px) !important; opacity: 0.88; }}
        .besing-trigger.folded-bottom.folded-right {{ transform: translate(24px, 24px) !important; opacity: 0.88; }}
        @media (hover: hover) {{ .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover {{ transform: translate(0, 0) scale(1.08) !important; opacity: 1 !important; }} }}
        .besing-trigger.folded-right::before {{ content: ""; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-left::after {{ content: ""; position: absolute; right: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-top:not(.folded-right)::before, .besing-trigger.folded-top.folded-right::after {{ content: ""; position: absolute; bottom: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-bottom:not(.folded-left)::after, .besing-trigger.folded-bottom.folded-left::before {{ content: ""; position: absolute; top: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.redirect-alert {{ border-color: #ef4444 !important; box-shadow: 0 0 20px rgba(239, 68, 68, 0.9), 0 0 35px rgba(239, 68, 68, 0.6) !important; }}
        .besing-trigger.redirect-alert::before, .besing-trigger.redirect-alert::after {{ background: #ef4444 !important; box-shadow: 0 0 16px #ef4444, 0 0 26px #ef4444 !important; animation: besingBarBlink 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite !important; }}
        @keyframes besingBarBlink {{ 0%, 100% {{ opacity: 1; transform: scale(1.15); }} 50% {{ opacity: 0.15; transform: scale(0.85); }} }}
        .besing-trigger.besing-pulse-alert {{ border-color: #38bdf8 !important; box-shadow: 0 0 25px rgba(56, 189, 248, 1), 0 0 50px rgba(99, 102, 241, 0.8) !important; animation: besingPulsePop 0.6s cubic-bezier(0.16, 1, 0.3, 1) 3 !important; }}
        @keyframes besingPulsePop {{ 0%, 100% {{ transform: scale(1); }} 50% {{ transform: scale(1.35); }} }}
        .besing-badge-count {{ position: absolute; top: -2px; right: -2px; background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; font-size: 10px; font-weight: 700; height: 18px; min-width: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 2px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }}
        .besing-pet-eye {{ transform-origin: center; animation: petBlink 4.5s infinite; }}
        @media (hover: hover) {{ .besing-pet-face:hover .besing-pet-eye {{ animation: none; transform: scaleY(0.2) translateY(1px); }} }}
        @keyframes petBlink {{ 0%, 93%, 100% {{ transform: scaleY(1); }} 96% {{ transform: scaleY(0.1); }} }}
        .besing-bubble-wrapper {{ position: fixed; z-index: 2147483647; pointer-events: auto; animation: besingBubblePop 0.22s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-bubble-arrow {{ position: absolute; width: 14px; height: 14px; background: #0d1322; border: 1px solid rgba(255, 255, 255, 0.14); transform: rotate(45deg); z-index: 2; }}
        .besing-bubble-arrow.arrow-bottom {{ bottom: -7px; border-top: none; border-left: none; }}
        .besing-bubble-arrow.arrow-top {{ top: -7px; border-bottom: none; border-right: none; }}
        .besing-bubble-panel {{ width: 390px !important; min-width: min(360px, calc(var(--besing-vw, 100vw) - 28px)) !important; max-width: calc(var(--besing-vw, 100vw) - 28px) !important; min-height: min(380px, calc(var(--besing-vh, 100vh) - 90px)) !important; max-height: min(520px, calc(var(--besing-vh, 100vh) - 90px)) !important; background: linear-gradient(180deg, rgba(16, 23, 38, 0.98) 0%, rgba(9, 13, 22, 0.99) 100%) !important; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.13) !important; border-radius: 18px !important; box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.75), 0 0 30px rgba(99, 102, 241, 0.16) !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; color: #e2e8f0 !important; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-bubble-panel.is-expanded {{ width: 540px !important; min-height: min(500px, calc(var(--besing-vh, 100vh) - 28px)) !important; max-height: calc(var(--besing-vh, 100vh) * 0.8) !important; }}
        .besing-header {{ min-height: 54px !important; height: 54px !important; padding: 14px 18px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important; background: rgba(255, 255, 255, 0.02) !important; flex-shrink: 0 !important; }}
        .besing-logo-group {{ display: flex !important; align-items: center !important; gap: 10px !important; flex-shrink: 0 !important; }}
        .besing-logo-icon {{ width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; border-radius: 8px !important; background: linear-gradient(135deg, #6366f1, #3b82f6) !important; display: flex !important; align-items: center !important; justify-content: center !important; color: #ffffff !important; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4) !important; flex-shrink: 0 !important; }}
        .besing-title {{ font-size: 14px; font-weight: 700; color: #f8fafc; }}
        .besing-tag {{ font-size: 10px; font-weight: 600; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.3); }}
        .besing-header-actions {{ display: flex !important; align-items: center !important; gap: 6px !important; flex-shrink: 0 !important; }}
        .besing-btn-icon {{ background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-icon:hover {{ background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.2); color: #ffffff; transform: translateY(-1px); }}
        .besing-btn-icon.active {{ background: rgba(99, 102, 241, 0.35); border-color: rgba(129, 140, 248, 0.5); color: #c7d2fe; }}
        .besing-body {{ padding: 14px 18px !important; overflow-y: auto !important; flex: 1 1 auto !important; min-height: 280px !important; display: flex !important; flex-direction: column !important; gap: 12px !important; }}
        .besing-search-wrap {{ position: relative; display: flex; align-items: center; }}
        .besing-search-icon {{ position: absolute; left: 12px; color: #64748b; pointer-events: none; }}
        .besing-search-input {{ width: 100%; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 8px 12px 8px 34px; color: #f1f5f9; font-size: 13px; outline: none; transition: border-color 0.2s, background 0.2s; }}
        .besing-search-input:focus {{ border-color: #6366f1; background: rgba(15, 23, 42, 0.9); box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25); }}
        .besing-search-input::placeholder {{ color: #64748b; }}
        .besing-ext-list {{ display: flex; flex-direction: column; gap: 8px; }}
        .besing-ext-card {{ background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; transition: all 0.2s ease; }}
        .besing-ext-card:hover {{ background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.13); transform: translateY(-1px); }}
        .besing-ext-info-group {{ display: flex; gap: 10px; align-items: flex-start; flex: 1; }}
        .besing-ext-icon {{ width: 32px; height: 32px; border-radius: 8px; background: rgba(99, 102, 241, 0.12); color: #818cf8; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid rgba(99, 102, 241, 0.2); }}
        .besing-ext-meta {{ display: flex; flex-direction: column; gap: 2px; }}
        .besing-ext-title-row {{ display: flex; align-items: center; gap: 6px; }}
        .besing-ext-name {{ font-size: 13px; font-weight: 600; color: #f1f5f9; }}
        .besing-ext-ver {{ font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; }}
        .besing-ext-desc {{ font-size: 11px; color: #94a3b8; line-height: 1.35; }}
        .besing-switch {{ position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }}
        .besing-switch input {{ opacity: 0; width: 0; height: 0; }}
        .besing-slider {{ position: absolute; cursor: pointer; inset: 0; background-color: #334155; transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 22px; }}
        .besing-slider::before {{ position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: #ffffff; transition: 0.25s cubic-bezier(0.16, 1, 0.3, 1); border-radius: 50%; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }}
        .besing-switch input:checked + .besing-slider {{ background-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35); }}
        .besing-switch input:checked + .besing-slider::before {{ transform: translateX(18px); }}
        .besing-settings-section {{ display: flex; flex-direction: column; gap: 14px; }}
        .besing-theme-picker {{ background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }}
        .besing-section-title {{ font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }}
        .besing-theme-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }}
        .besing-theme-btn {{ background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #cbd5e1; font-size: 11px; cursor: pointer; transition: all 0.15s ease; }}
        .besing-theme-btn:hover {{ background: rgba(255, 255, 255, 0.08); border-color: rgba(99, 102, 241, 0.4); }}
        .besing-theme-btn.active {{ background: rgba(99, 102, 241, 0.2); border-color: #818cf8; color: #f8fafc; box-shadow: 0 0 10px rgba(99, 102, 241, 0.25); }}
        .besing-rotator-toggle {{ position: relative; width: 62px; height: 24px; border-radius: 12px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; outline: none; transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); flex-shrink: 0; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4); }}
        .besing-rotator-toggle:hover {{ filter: brightness(1.1); transform: scale(1.02); }}
        .besing-rotator-toggle.mode-off {{ background-color: #334155; }}
        .besing-rotator-toggle.mode-off .besing-rotator-knob {{ position: absolute; left: 3px; width: 18px; height: 18px; border-radius: 50%; background-color: #ffffff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-rotator-toggle.mode-off .besing-rotator-text {{ display: none; }}
        .besing-rotator-toggle.mode-on {{ background-color: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35), inset 0 1px 2px rgba(0, 0, 0, 0.2); }}
        .besing-rotator-toggle.mode-on .besing-rotator-knob {{ position: absolute; left: 3px; transform: translateX(38px); width: 18px; height: 18px; border-radius: 50%; background-color: #ffffff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-rotator-toggle.mode-on .besing-rotator-text {{ display: none; }}
        .besing-rotator-toggle.mode-site {{ background: linear-gradient(135deg, #0284c7, #2563eb); box-shadow: 0 0 10px rgba(56, 189, 248, 0.35), inset 0 1px 2px rgba(0, 0, 0, 0.2); }}
        .besing-rotator-toggle.mode-site .besing-rotator-knob {{ display: none; }}
        .besing-rotator-toggle.mode-site .besing-rotator-text {{ display: block; color: #ffffff; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; user-select: none; pointer-events: none; }}
        .besing-site-card {{ background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }}
        .besing-site-card-header {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-current-domain {{ font-size: 12px; font-weight: 600; color: #38bdf8; font-family: monospace; }}
        .besing-site-rules-wrap {{ display: flex; flex-direction: column; gap: 8px; }}
        .besing-site-rules-list {{ display: flex; flex-direction: column; gap: 8px; }}
        .besing-site-group {{ flex-shrink: 0; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; overflow: hidden; }}
        .besing-site-group-header {{ padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; user-select: none; transition: background 0.15s ease; }}
        .besing-site-group-header:hover {{ background: rgba(255, 255, 255, 0.06); }}
        .besing-site-chevron {{ transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); color: #94a3b8; flex-shrink: 0; }}
        .besing-site-group.collapsed .besing-site-chevron {{ transform: rotate(-90deg); }}
        .besing-site-group.collapsed .besing-site-subrules {{ display: none; }}
        .besing-site-group.collapsed .besing-site-group-header {{ border-bottom: none; }}
        .besing-site-rule-count {{ font-size: 10px; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 6px; border-radius: 999px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
        .besing-site-group-title {{ display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; font-weight: 700; color: #f1f5f9; font-family: monospace; }}
        .besing-site-host {{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
        .besing-site-rule-count, .besing-btn-del-site {{ flex-shrink: 0; white-space: nowrap; }}
        .besing-btn-del-site {{ background: transparent; border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 5px; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-del-site:hover {{ background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }}
        .besing-site-subrules {{ display: flex; flex-direction: column; padding: 4px 10px; }}
        .besing-site-rule-row {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }}
        .besing-site-rule-row:last-child {{ border-bottom: none; }}
        .besing-site-rule-info {{ display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }}
        .besing-site-rule-name {{ font-size: 11px; font-weight: 500; color: #e2e8f0; }}
        .besing-site-rule-tag {{ font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px; }}
        .besing-site-rule-actions {{ display: flex; align-items: center; gap: 6px; flex-shrink: 0; }}
        .besing-switch-sm {{ width: 32px; height: 18px; }}
        .besing-switch-sm .besing-slider::before {{ height: 12px; width: 12px; left: 3px; bottom: 3px; }}
        .besing-switch-sm input:checked + .besing-slider::before {{ transform: translateX(14px); }}
        .besing-rule-remove {{ background: transparent; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 2px 5px; border-radius: 4px; transition: all 0.15s ease; }}
        .besing-rule-remove:hover {{ background: rgba(239, 68, 68, 0.2); color: #ef4444; }}
        .besing-blocklist-header {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-blocklist-title {{ font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; }}
        .besing-blocklist-count {{ font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.05); padding: 2px 6px; border-radius: 10px; }}
        .besing-empty-state {{ text-align: center; padding: 18px 10px; color: #64748b; font-size: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed rgba(255, 255, 255, 0.08); }}
        .besing-update-card {{ background: rgba(167, 139, 250, 0.06); border: 1px solid rgba(167, 139, 250, 0.25); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }}
        .besing-update-header {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-update-actions {{ display: flex; gap: 8px; }}
        .besing-btn-sync {{ background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.15s ease; }}
        .besing-btn-sync:hover {{ background: rgba(56, 189, 248, 0.25); color: #e0f2fe; }}
        .besing-update-msg {{ font-size: 10px; color: #cbd5e1; min-height: 14px; line-height: 1.35; }}
        @keyframes besingBubblePop {{ 0% {{ opacity: 0; transform: scale(0.92) translateY(6px); }} 100% {{ opacity: 1; transform: scale(1) translateY(0); }} }}
        .besing-section-heading {{ display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin: 4px 0 2px 0; }}
        .besing-pill-count {{ background: rgba(255, 255, 255, 0.08); color: #cbd5e1; font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600; }}
        .besing-cat-badge {{ font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); color: #a5b4fc; margin-left: 4px; }}
        .besing-ext-actions {{ display: flex; align-items: center; gap: 8px; }}
        .besing-btn-script-gear {{ background: transparent; border: none; color: #64748b; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-script-gear:hover {{ background: rgba(255, 255, 255, 0.08); color: #cbd5e1; transform: rotate(30deg); }}
        .besing-secondary-header {{ display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }}
        .besing-secondary-top-bar {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }}
        .besing-btn-back {{ display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #cbd5e1; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-back:hover {{ background: rgba(99, 102, 241, 0.2); border-color: #818cf8; color: #fff; }}
        .besing-tri-toggle {{ display: inline-flex; align-items: center; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; padding: 2px; gap: 2px; }}
        .besing-tri-btn {{ background: transparent; border: 1px solid transparent; color: #94a3b8; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; line-height: 1.2; }}
        .besing-tri-btn:hover {{ color: #f1f5f9; background: rgba(255, 255, 255, 0.06); }}
        .besing-tri-btn.active.active-off {{ background: rgba(100, 116, 139, 0.35); color: #f1f5f9; font-weight: 700; border-color: rgba(148, 163, 184, 0.3); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }}
        .besing-tri-btn.active.active-site {{ background: rgba(56, 189, 248, 0.22); color: #38bdf8; border-color: rgba(56, 189, 248, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(56, 189, 248, 0.25); }}
        .besing-tri-btn.active.active-site-off {{ background: rgba(245, 158, 11, 0.22); color: #fbbf24; border-color: rgba(245, 158, 11, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(245, 158, 11, 0.25); }}
        .besing-tri-btn.active.active-on {{ background: rgba(16, 185, 129, 0.22); color: #34d399; border-color: rgba(16, 185, 129, 0.45); font-weight: 700; box-shadow: 0 0 10px rgba(16, 185, 129, 0.25); }}
        .besing-secondary-title-group {{ display: flex; align-items: center; gap: 10px; width: 100%; }}
        .besing-ext-icon.sm {{ width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }}
        .besing-secondary-meta {{ display: flex; flex-direction: column; gap: 2px; overflow: hidden; }}
        .besing-secondary-title {{ font-size: 13px; font-weight: 700; color: #f8fafc; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }}
        .besing-config-scope {{ font-size: 11px; line-height: 1.4; padding: 8px 10px; border-radius: 8px; display: flex; align-items: flex-start; gap: 8px; }}
        .besing-config-scope.site {{ background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); color: #7dd3fc; }}
        .besing-config-scope.global {{ background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); color: #6ee7b7; }}
        .besing-config-scope.off {{ background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.1); color: #94a3b8; }}
        .besing-config-section {{ background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }}
        .besing-section-header-row {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-brightness-badge {{ font-size: 10px; font-weight: 700; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; padding: 2px 7px; border-radius: 10px; border: 1px solid rgba(99, 102, 241, 0.3); }}
        .besing-zoom-hero {{ display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 10px; background: rgba(15, 23, 42, 0.55); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06); }}
        .besing-zoom-val {{ font-size: 32px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; text-shadow: 0 0 16px rgba(56, 189, 248, 0.4); }}
        .besing-zoom-desc {{ font-size: 10px; color: #64748b; }}
        .besing-zoom-slider-row {{ display: flex; align-items: center; gap: 8px; margin-top: 4px; }}
        .besing-stepper-btn {{ width: 28px; height: 28px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #f1f5f9; font-size: 16px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }}
        .besing-stepper-btn:hover {{ background: rgba(99, 102, 241, 0.3); border-color: #818cf8; }}
        .besing-slider-range {{ flex: 1; accent-color: #38bdf8; cursor: pointer; height: 6px; border-radius: 3px; }}
        .besing-slider-range.brightness-range {{ accent-color: #a78bfa; }}
        .besing-preset-row {{ display: flex; flex-wrap: wrap; gap: 6px; }}
        .besing-zoom-pill {{ background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; }}
        .besing-zoom-pill:hover {{ background: rgba(255, 255, 255, 0.08); color: #fff; }}
        .besing-zoom-pill.active {{ background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; box-shadow: 0 0 8px rgba(56, 189, 248, 0.3); }}
        .besing-brightness-labels {{ display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }}
        .besing-range-ticks {{ display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-top: -2px; }}
        .besing-preset-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }}
        .besing-preset-card {{ background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 6px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.15s ease; color: #cbd5e1; }}
        .besing-preset-card:hover {{ background: rgba(255, 255, 255, 0.07); }}
        .besing-preset-card.active {{ background: rgba(99, 102, 241, 0.18); border-color: #818cf8; color: #fff; }}
        .besing-preset-swatch {{ width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid rgba(255, 255, 255, 0.2); flex-shrink: 0; }}
        .besing-preset-label {{ font-size: 10px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
        .besing-custom-color-row {{ display: flex; align-items: center; gap: 6px; margin-top: 6px; }}
        .besing-custom-color-label {{ font-size: 10px; color: #94a3b8; }}
        .besing-input-sm {{ background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; border-radius: 6px; padding: 3px 6px; font-size: 11px; font-family: monospace; width: 65px; }}
        .besing-btn-sub-action {{ background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-sub-action:hover {{ background: rgba(255, 255, 255, 0.09); color: #f1f5f9; }}
        .besing-unlocked-banner {{ display: flex; align-items: center; gap: 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 10px; }}
        .besing-toggle-row-list {{ display: flex; flex-direction: column; gap: 8px; }}
        .besing-toggle-row {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }}
        .besing-toggle-row:last-child {{ border-bottom: none; }}
        .besing-toggle-title {{ font-size: 11px; font-weight: 600; color: #f1f5f9; }}
        .besing-toggle-desc {{ font-size: 10px; color: #64748b; }}
        .besing-copy-test-box {{ margin-top: 10px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px; }}
        .besing-test-text {{ background: rgba(255, 255, 255, 0.04); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #38bdf8; margin-bottom: 6px; }}
        .besing-test-input {{ width: 100%; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #f1f5f9; outline: none; }}
        .besing-test-input:focus {{ border-color: #10b981; }}
        .besing-site-override-pill {{ display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 6px; border-radius: 9999px; cursor: pointer; transition: all 0.15s ease; }}
        .besing-site-override-pill:hover {{ background: rgba(56, 189, 248, 0.22); border-color: #38bdf8; color: #fff; }}
        .besing-rotator-toggle.mode-site-off {{ background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.4); color: #fbbf24; }}
        .besing-rotator-toggle.mode-site-off .besing-rotator-knob {{ left: 20px; background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }}
        .besing-rotator-toggle.mode-site-off:hover {{ border-color: #f59e0b; }}
        .besing-config-scope.site-off {{ background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); color: #fcd34d; }}
        .besing-tri-btn.active.active-site-off {{ background: rgba(245, 158, 11, 0.25); color: #fbbf24; border-color: rgba(245, 158, 11, 0.5); box-shadow: 0 0 8px rgba(245, 158, 11, 0.3); }}
        .besing-override-item {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: rgba(15, 23, 42, 0.45); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; margin-bottom: 5px; }}
        .besing-override-host-group {{ display: flex; align-items: center; gap: 6px; overflow: hidden; }}
        .besing-override-host {{ font-size: 11px; font-weight: 600; color: #f1f5f9; font-family: monospace; }}
        .besing-override-tag {{ font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 4px; }}
        .besing-override-tag.tag-site {{ background: rgba(56, 189, 248, 0.15); color: #38bdf8; }}
        .besing-override-tag.tag-site-off {{ background: rgba(245, 158, 11, 0.15); color: #fbbf24; }}
        .besing-override-actions {{ display: flex; align-items: center; gap: 6px; }}
        .besing-select-sm {{ background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.1); color: #f1f5f9; border-radius: 6px; padding: 3px 6px; font-size: 10px; outline: none; }}
        .besing-zapper-hero-section {{ background: linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(15, 23, 42, 0.65)); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }}
        .besing-btn-zapper-launch {{ display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #ef4444, #dc2626); border: none; border-radius: 8px; color: #fff; font-size: 12px; font-weight: 700; padding: 9px 16px; cursor: pointer; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35); transition: all 0.18s ease; }}
        .besing-btn-zapper-launch:hover {{ background: linear-gradient(135deg, #f87171, #ef4444); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45); }}
        .besing-shortcut-badge {{ background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #fca5a5; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; font-family: monospace; }}
        .besing-zapped-list {{ display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; padding-right: 4px; }}
        .besing-zapped-item {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 6px 8px; }}
        .besing-zapped-selector {{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #fca5a5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }}
        .besing-btn-restore-zapped {{ background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 11px; font-weight: 700; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; flex-shrink: 0; }}
        .besing-btn-restore-zapped:hover {{ background: #ef4444; color: #fff; }}
        .besing-zapped-empty {{ font-size: 11px; color: #64748b; text-align: center; padding: 12px 6px; font-style: italic; }}
        .besing-segmented-group {{ display: flex; gap: 4px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 3px; }}
        .besing-segmented-btn {{ flex: 1; padding: 6px 8px; border: none; border-radius: 6px; background: transparent; color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; text-align: center; }}
        .besing-segmented-btn:hover {{ color: #f1f5f9; background: rgba(255, 255, 255, 0.04); }}
        .besing-segmented-btn.active {{ background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.35); }}
        .besing-stepper-row {{ display: flex; align-items: center; gap: 6px; }}
        .besing-stepper-val {{ font-size: 13px; font-weight: 700; color: #38bdf8; min-width: 22px; text-align: center; font-family: monospace; }}

        /* Rest Reminder Chat Box */
        .besing-rest-chat-box {{ position: fixed; z-index: 2147483647; width: 270px; background: linear-gradient(145deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 27, 75, 0.98) 100%); border: 1.5px solid rgba(129, 140, 248, 0.5); border-radius: 16px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 25px rgba(99, 102, 241, 0.35); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 14px 16px; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: auto !important; animation: besingRestPop 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275); user-select: none; }}
        @keyframes besingRestPop {{ 0% {{ opacity: 0; transform: scale(0.85) translateY(8px); }} 100% {{ opacity: 1; transform: scale(1) translateY(0); }} }}
        .besing-rest-arrow {{ position: absolute; width: 12px; height: 12px; background: #121829; border: 1.5px solid rgba(129, 140, 248, 0.5); transform: rotate(45deg); z-index: -1; }}
        .besing-rest-arrow.arrow-bottom {{ bottom: -7px; border-top: none; border-left: none; }}
        .besing-rest-arrow.arrow-top {{ top: -7px; border-bottom: none; border-right: none; }}
        .besing-rest-header {{ display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }}
        .besing-rest-avatar {{ font-size: 16px; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: rgba(99, 102, 241, 0.2); border-radius: 50%; border: 1px solid rgba(129, 140, 248, 0.4); }}
        .besing-rest-title {{ font-size: 13px; font-weight: 700; color: #c7d2fe; flex: 1; }}
        .besing-rest-badge {{ font-size: 10px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); padding: 1px 6px; border-radius: 8px; }}
        .besing-rest-msg {{ font-size: 12px; color: #cbd5e1; line-height: 1.45; margin-bottom: 12px; }}
        .besing-rest-msg strong {{ color: #38bdf8; font-weight: 700; }}
        .besing-rest-actions {{ display: flex; align-items: center; gap: 8px; }}
        .besing-rest-btn-repeat {{ flex: 1; background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 6px; }}
        .besing-rest-btn-repeat:hover {{ background: linear-gradient(135deg, #0369a1, #1d4ed8); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45); }}
        .besing-rest-btn-repeat:active {{ transform: scale(0.97); }}
        .besing-rest-btn-off {{ background: rgba(239, 68, 68, 0.12); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }}
        .besing-rest-btn-off:hover {{ background: rgba(239, 68, 68, 0.22); border-color: rgba(239, 68, 68, 0.55); transform: translateY(-1px); }}
        .besing-rest-btn-off:active {{ transform: scale(0.97); }}
      `;
      shadow.appendChild(style);
    }}
  }}

  // Single-instance guard. A second copy can arrive from the same script running twice, a second
  // install (Stable + Packed, GitHub + Greasy Fork), or the extension alongside a userscript.
  // 1. Same JS world: an instance created for this document wins, mounted or not.
  const existingApp = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                      (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
  if (existingApp && !existingApp.disposed && existingApp.bootDocument === document) {{
    console.warn('[BESing] An instance already owns this page. Skipping duplicate initialization.');
    BESBootLog.record('skipped', {{ ...describeEnvironment(), reason: 'same-world instance exists' }});
    return;
  }}
  // An instance left over from a previous document (WebKit can keep the global across reloads) is shut down fully.
  let disposedStale = false;
  if (existingApp && !existingApp.disposed && typeof existingApp.dispose === 'function') {{
    try {{ existingApp.dispose(); }} catch (e) {{}}
    disposedStale = true;
  }}
  // 2. Other JS worlds: ask whether a live owner exists. Dispatch is synchronous, so two copies
  // starting at the same moment still run one after the other and only the first claims the page.
  let claimedElsewhere = false;
  try {{
    claimedElsewhere = !document.dispatchEvent(new CustomEvent(CLAIM_EVENT, {{ cancelable: true }}));
  }} catch (e) {{}}
  if (claimedElsewhere) {{
    console.warn('[BESing] Another BESing copy (different script or extension) already owns this page. Skipping.');
    BESBootLog.record('skipped', {{ ...describeEnvironment(), reason: 'another world claimed the page' }});
    return;
  }}

  const app = new BESManagerApp();
  document.addEventListener(CLAIM_EVENT, (e) => {{
    if (!app.disposed) e.preventDefault();
  }});
  app.isPacked = !BESUpdater.isStableLoader();
  try {{
    window.__BESING_INSTANCE__ = app;
    if (typeof unsafeWindow !== 'undefined') unsafeWindow.__BESING_INSTANCE__ = app;
  }} catch (e) {{}}
  BESBootLog.record('start', describeEnvironment());
  if (disposedStale) BESBootLog.event('disposed instance left from a previous document');

  // Blocked redirects, so a late load shows whether protection still caught something.
  let blockedLogged = 0;
  window.addEventListener('besing:redirect-blocked', (e) => {{
    if (++blockedLogged > 10) return;
    try {{
      const d = (e && e.detail) || {{}};
      let where = String(d.url || '');
      try {{ where = new URL(where, location.href).host || where; }} catch (x) {{}}
      BESBootLog.event(`blocked ${{d.reason || '?'}}: ${{where.slice(0, 60)}}`);
    }} catch (err) {{}}
  }});

  // 1. Synchronously arm security shields at document-start before yielding to event loop
  app.initPreemptiveShields();

  // 2. Initialize storage and load remaining active modules with resilient fallback
  app.init().catch(err => {{
    console.error('[BESing] Storage init error:', err);
    BESBootLog.error('init', err);
  }}).finally(() => {{
    app.ensureMounted('init-finally');
  }});

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', () => {{
      BESBootLog.event('DOMContentLoaded');
      app.ensureMounted('DOMContentLoaded');
    }});
  }} else {{
    app.ensureMounted('already-' + document.readyState);
  }}

  window.addEventListener('load', () => {{
    BESBootLog.event('load');
    app.ensureMounted('load');
    BESBootLog.check('after load');
  }});

  // Mobile iPad / WebKit tab suspension and bfcache lifecycle recovery
  window.addEventListener('pageshow', (e) => {{
    if (e.persisted) BESBootLog.event('pageshow from back/forward cache');
    app.ensureMounted('pageshow');
  }});

  window.addEventListener('pagehide', (e) => {{
    BESBootLog.event(e.persisted ? 'pagehide into back/forward cache' : 'pagehide');
    BESBootLog.persist();
  }});

  document.addEventListener('visibilitychange', () => {{
    BESBootLog.event(`visibility ${{document.visibilityState}}`);
    if (document.visibilityState === 'visible') {{
      app.ensureMounted('visible');
    }}
  }});

  window.addEventListener('orientationchange', () => {{
    setTimeout(() => {{
      app.clampWidgetPosition();
      app.ensureMounted('orientation');
    }}, 200);
  }});

  // Emergency 3-finger tap on mobile/tablet to pull up icon if lost
  window.addEventListener('touchstart', (e) => {{
    if (e.touches && e.touches.length === 3) {{
      console.log('[BESing] 3-finger tap detected: pulling up widget icon');
      BESBootLog.event('3-finger pull-up');
      app.pullUpIcon();
    }}
  }}, {{ passive: true }});

  setTimeout(() => {{
    app.ensureMounted('failsafe-1s');
  }}, 1000);

  // What the user should be seeing a few seconds in: catches a widget that mounted but is hidden,
  // detached or off-screen, and modules whose page hooks went missing.
  setTimeout(() => BESBootLog.check('check@3s'), 3000);
  setTimeout(() => BESBootLog.check('check@10s'), 10000);
}})();
"""

    print(f"[*] Writing mega-file to {TARGET_USER_JS}...")
    TARGET_USER_JS.write_text(full_script, encoding="utf-8")
    
    print(f"[*] Writing meta-file to {TARGET_META_JS}...")
    TARGET_META_JS.write_text(META_SCRIPT_CONTENT, encoding="utf-8")

    # Also sync Chrome Extension content script
    extension_content_file = ROOT_DIR / "extension" / "content.js"
    if extension_content_file.parent.exists():
        print(f"[*] Syncing Chrome Extension content script to {extension_content_file}...")
        extension_script = f"""/**
 * BESing - Chrome Extension Manifest V3 Content Script
 * Version {VERSION}
 */

{full_script.split('// ==/UserScript==')[1].strip()}
"""
        extension_content_file.write_text(extension_script, encoding="utf-8")

    size_kb = len(full_script.encode('utf-8')) / 1024
    print(f"[OK] Mega-file generated successfully! ({len(modules_code)} modules bundled, {size_kb:.1f} KB)")

if __name__ == "__main__":
    build()
