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

VERSION = "1.4.0"

USER_SCRIPT_HEADER = f"""// ==UserScript==
// @name         BESing Script Manager
// @namespace    https://github.com/CoronRing/BESing
// @version      {VERSION}
// @description  Universal Browser Extension & Greasy Fork Script Manager with 4-way edge folding, desktop pet themes, non-blocking anchored bubble menu, and bundled productivity tools.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      raw.githubusercontent.com
// @connect      update.greasyfork.org
// @connect      greasyfork.org
// @updateURL    https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js
// @downloadURL  https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js
// @run-at       document-idle
// ==/UserScript==
"""

META_SCRIPT_CONTENT = f"""// ==UserScript==
// @name         BESing Script Manager
// @namespace    https://github.com/CoronRing/BESing
// @version      {VERSION}
// @description  Universal Browser Extension & Greasy Fork Script Manager with 4-way edge folding, desktop pet themes, non-blocking anchored bubble menu, and bundled productivity tools.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js
// @downloadURL  https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js
// ==/UserScript==
"""

def extract_module_body(script_path: Path):
    content = script_path.read_text(encoding="utf-8")
    match = re.search(r'const\s+[A-Za-z0-9_]+\s*=\s*\{', content)
    if not match:
        return None
    start_idx = match.end() - 1
    depth = 0
    in_str = False
    str_char = ''
    i = start_idx
    while i < len(content):
        ch = content[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == str_char:
                in_str = False
        else:
            if ch in ('"', "'", '`'):
                in_str = True
                str_char = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return content[start_idx : i + 1]
        i += 1
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

  // 1. Unified Adapter Layer
  const BESAdapter = {{
    isGM: typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
    isExt: typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local,

    async get(key, defaultValue = null) {{
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
          chrome.storage.local.get([key], res => {{
            resolve(res[key] !== undefined ? res[key] : defaultValue);
          }});
        }});
      }}
      try {{
        const item = window.localStorage.getItem('besing_' + key);
        return item ? JSON.parse(item) : defaultValue;
      }} catch (e) {{
        return defaultValue;
      }}
    }},

    async set(key, value) {{
      if (this.isGM) {{
        try {{ GM_setValue(key, value); return true; }} catch (e) {{ return false; }}
      }}
      if (this.isExt) {{
        return new Promise(resolve => {{
          chrome.storage.local.set({{ [key]: value }}, () => resolve(true));
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
      this.blockedSites = [];
      this.enabledScripts = {{}};
      this.widgetPos = null;
      this.settings = {{
        theme: 'cyber-pet',
        agentUrl: 'http://127.0.0.1:8765/api/sync',
        authToken: '',
        updateChannel: 'github',
        autoCheckUpdates: true
      }};
    }}

    async init() {{
      this.blockedSites = await BESAdapter.get('blocked_sites', []);
      this.enabledScripts = await BESAdapter.get('enabled_scripts', {{}});
      this.widgetPos = await BESAdapter.get('widget_position', null);
      const s = await BESAdapter.get('global_settings', {{}});
      this.settings = {{ ...this.settings, ...s }};
      if (!Array.isArray(this.blockedSites)) this.blockedSites = [];
    }}

    isCurrentBlocked() {{
      const cur = (window.location.hostname || '').toLowerCase().trim();
      return this.blockedSites.some(b => b.host.toLowerCase() === cur);
    }}

    async blockSite(host = window.location.hostname) {{
      const clean = (host || '').toLowerCase().trim();
      if (!clean) return;
      this.blockedSites = this.blockedSites.filter(b => b.host.toLowerCase() !== clean);
      this.blockedSites.unshift({{ host: clean, addedAt: Date.now() }});
      await BESAdapter.set('blocked_sites', this.blockedSites);
    }}

    async unblockSite(host) {{
      const clean = (host || '').toLowerCase().trim();
      this.blockedSites = this.blockedSites.filter(b => b.host.toLowerCase() !== clean);
      await BESAdapter.set('blocked_sites', this.blockedSites);
    }}

    getBlockedSites() {{
      return this.blockedSites || [];
    }}

    // Default to FALSE: all modules are OFF by default!
    isScriptEnabled(id, defaultVal = false) {{
      if (this.enabledScripts[id] !== undefined) {{
        return !!this.enabledScripts[id];
      }}
      return defaultVal;
    }}

    async setScriptEnabled(id, enabled) {{
      this.enabledScripts[id] = !!enabled;
      await BESAdapter.set('enabled_scripts', this.enabledScripts);
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

  // 3. Pre-bundled Modules (Off by default, zero remote eval)
  const BUILTIN_MODULES = [
{modules_joined}
  ];

  // 4. Update Engine (Checks version, prompts native update, no eval)
  class BESUpdater {{
    static CURRENT_VERSION = '{VERSION}';

    static CHANNELS = {{
      github: {{
        name: 'GitHub Releases (Stable)',
        metaUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js',
        userUrl: 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js'
      }},
      greasyfork: {{
        name: 'Greasy Fork (Public)',
        metaUrl: 'https://update.greasyfork.org/scripts/520000/besing-script-manager.meta.js',
        userUrl: 'https://update.greasyfork.org/scripts/520000/besing-script-manager.user.js'
      }}
    }};

    static async fetchText(url) {{
      return new Promise((resolve, reject) => {{
        if (typeof GM_xmlhttpRequest === 'function') {{
          GM_xmlhttpRequest({{
            method: 'GET',
            url: `${{url}}${{url.includes('?') ? '&' : '?'}}_t=${{Date.now()}}`,
            timeout: 7000,
            onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error('HTTP ' + res.status)),
            onerror: (err) => reject(new Error(err.error || 'Network error')),
            ontimeout: () => reject(new Error('Timeout'))
          }});
        }} else {{
          fetch(`${{url}}?_t=${{Date.now()}}`, {{ cache: 'no-cache' }})
            .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
            .then(resolve)
            .catch(reject);
        }}
      }});
    }}

    static parseVersion(metaText) {{
      const match = metaText.match(/@version\s+([0-9\.]+)/i);
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
      try {{
        const text = await BESUpdater.fetchText(channel.metaUrl);
        const remoteVer = BESUpdater.parseVersion(text);
        if (!remoteVer) throw new Error('Could not parse remote version header');
        const hasUpdate = BESUpdater.compareVersions(remoteVer, BESUpdater.CURRENT_VERSION) > 0;
        return {{
          ok: true,
          channelName: channel.name,
          currentVersion: BESUpdater.CURRENT_VERSION,
          remoteVersion: remoteVer,
          hasUpdate,
          downloadUrl: channel.userUrl
        }};
      }} catch (err) {{
        return {{
          ok: false,
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
      this.isExpanded = false;
      this.isDragging = false;
      this.dragMoved = false;
      this.startX = 0;
      this.startY = 0;
      this.initialLeft = 0;
      this.initialTop = 0;
      this.updateAvailable = null;
      this.lastFoldSide = null;
    }}

    async init() {{
      await this.storage.init();

      // Initialize pre-bundled modules (All default to OFF)
      this.modules = BUILTIN_MODULES.map(m => ({{
        ...m,
        enabled: this.storage.isScriptEnabled(m.id, false)
      }}));

      // Run any modules that were previously enabled by user
      this.modules.forEach(m => {{
        if (m.enabled) {{
          try {{ m.init(); }} catch (err) {{
            console.error(`[BESing] Error initializing ${{m.id}}:`, err);
          }}
        }}
      }});

      // Throttled Daily Update Check
      const lastCheck = await BESAdapter.get('last_update_check_time', 0);
      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - (lastCheck || 0) > ONE_DAY) {{
        setTimeout(async () => {{
          await this.updater.checkForUpdates(false).catch(() => {{}});
          await BESAdapter.set('last_update_check_time', Date.now());
        }}, 4000);
      }}

      // Hotkey: Alt + Shift + B
      window.addEventListener('keydown', (e) => {{
        if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {{
          e.preventDefault();
          this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
        }}
      }});

      BESAdapter.registerMenu('BESing: Script Manager', () => {{
        this.openModal(this.storage.isCurrentBlocked() ? 'settings' : 'extensions');
      }});

      if (this.storage.isCurrentBlocked()) {{
        console.log(`[BESing] Inactive on ${{window.location.hostname}} (Site blocked)`);
        return;
      }}

      this.mount();
    }}

    mount() {{
      if (this.host) return;
      const host = document.createElement('besing-host');
      host.id = '__besing_root__';
      document.documentElement.appendChild(host);
      this.host = host;

      const shadow = host.attachShadow({{ mode: 'open' }});
      this.shadow = shadow;

      this.injectStyles(shadow);
      this.renderWidget(shadow);
    }}

    teardown() {{
      this.modules.forEach(m => {{
        try {{ m.destroy(); }} catch (e) {{}}
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
      if (savedPos && savedPos.x !== undefined && savedPos.y !== undefined) {{
        btn.style.left = `${{savedPos.x}}px`;
        btn.style.top = `${{savedPos.y}}px`;
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
      const activeCount = this.modules.filter(m => this.storage.isScriptEnabled(m.id, false)).length;
      if (!badge) {{
        badge = document.createElement('span');
        badge.className = 'besing-badge-count';
        this.widgetEl.appendChild(badge);
      }}
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'flex' : 'none';
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
      btn.innerHTML = inner;
      this.updateBadge();
    }}

    setupDragging(btn) {{
      const onStart = (e) => {{
        if (e.target.closest('.besing-bubble-wrapper')) return;
        this.isDragging = true;
        this.dragMoved = false;
        const pt = e.touches ? e.touches[0] : e;
        this.startX = pt.clientX;
        this.startY = pt.clientY;

        const rect = btn.getBoundingClientRect();
        this.initialLeft = rect.left;
        this.initialTop = rect.top;

        btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
        btn.style.transition = 'none';

        window.addEventListener('mousemove', onMove, {{ passive: false }});
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, {{ passive: false }});
        window.addEventListener('touchend', onEnd);
      }};

      const onMove = (e) => {{
        if (!this.isDragging) return;
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - this.startX;
        const dy = pt.clientY - this.startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {{
          this.dragMoved = true;
          if (e.cancelable) e.preventDefault();
        }}

        const newL = Math.max(0, Math.min(window.innerWidth - 48, this.initialLeft + dx));
        const newT = Math.max(0, Math.min(window.innerHeight - 48, this.initialTop + dy));

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

        const rect = btn.getBoundingClientRect();
        this.storage.setWidgetPosition({{ x: Math.round(rect.left), y: Math.round(rect.top) }});
        this.checkEdgeDocking(btn);

        if (!this.dragMoved) {{
          this.toggleModal();
        }}
      }};

      btn.addEventListener('mousedown', onStart);
      btn.addEventListener('touchstart', onStart, {{ passive: true }});
    }}

    checkEdgeDocking(btn) {{
      const doc = document.documentElement;
      const clientW = doc ? doc.clientWidth : window.innerWidth;
      const clientH = doc ? doc.clientHeight : window.innerHeight;
      const rect = btn.getBoundingClientRect();
      const margin = 14;

      btn.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

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

      panel.innerHTML = `
        <div class="besing-header">
          <div class="besing-logo-group">
            <div class="besing-logo-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <div>
              <span class="besing-title">BESing</span>
              <span class="besing-tag">v${{BESUpdater.CURRENT_VERSION}}</span>
            </div>
          </div>
          <div class="besing-header-actions">
            <button class="besing-btn-icon" id="besing-btn-settings" title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button class="besing-btn-icon" id="besing-btn-expand" title="Toggle Size">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
              </svg>
            </button>
            <button class="besing-btn-icon" id="besing-btn-close" title="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="besing-body" id="besing-body"></div>
      `;

      this.shadow.appendChild(wrapper);
      this.menuWrapperEl = wrapper;

      this.positionBubble(wrapper, panel, arrow);

      panel.querySelector('#besing-btn-close').onclick = () => this.closeModal();
      panel.querySelector('#besing-btn-expand').onclick = () => {{
        this.isExpanded = !this.isExpanded;
        panel.classList.toggle('is-expanded', this.isExpanded);
        this.positionBubble(wrapper, panel, arrow);
      }};

      const settingsBtn = panel.querySelector('#besing-btn-settings');
      settingsBtn.onclick = () => {{
        this.currentView = this.currentView === 'settings' ? 'extensions' : 'settings';
        settingsBtn.classList.toggle('active', this.currentView === 'settings');
        this.renderBody();
      }};

      setTimeout(() => {{
        const outsideHandler = (e) => {{
          if (!this.menuWrapperEl) return;
          const path = e.composedPath ? e.composedPath() : [];
          if (!path.includes(wrapper) && (!this.widgetEl || !path.includes(this.widgetEl))) {{
            this.closeModal();
            document.removeEventListener('click', outsideHandler);
          }}
        }};
        document.addEventListener('click', outsideHandler);
      }}, 50);

      this.renderBody();
    }}

    positionBubble(wrapper, panel, arrow) {{
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
      const bubbleW = 390;
      const margin = 14;

      if (this.widgetEl) {{
        const doc = document.documentElement;
        const clientW = doc ? doc.clientWidth : window.innerWidth;
        const clientH = doc ? doc.clientHeight : window.innerHeight;
        const rect = this.widgetEl.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const left = Math.max(margin, Math.min(clientW - bubbleW - margin, center - bubbleW / 2));
        const isBottom = rect.top > clientH / 2;

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
      const body = this.menuWrapperEl.querySelector('#besing-body');
      body.innerHTML = '';

      if (this.currentView === 'settings') {{
        const currentHost = window.location.hostname || 'localhost';
        const blocked = this.storage.getBlockedSites();
        const curTheme = this.storage.getTheme();

        body.innerHTML = `
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
              <div class="besing-update-actions">
                <button class="besing-btn-sync" id="besing-btn-check-update" style="flex:1;">Check Updates Now (Force)</button>
              </div>
              <div class="besing-update-msg" id="besing-update-msg">Updates check automatically at launch and once every 24 hours.</div>
            </div>

            <div class="besing-site-card">
              <div class="besing-site-card-header">
                <div>
                  <div class="besing-section-title" style="color:#f87171;">Disable on Current Site</div>
                  <div class="besing-current-domain">${{currentHost}}</div>
                </div>
                <button class="besing-btn-danger" id="besing-btn-turn-off-site">Disable</button>
              </div>
            </div>

            <div class="besing-blocked-list-wrap">
              <div class="besing-blocklist-header">
                <span class="besing-blocklist-title">Disabled Sites</span>
                <span class="besing-blocklist-count">${{blocked.length}}</span>
              </div>
              <div class="besing-blocked-list" id="besing-blocked-container"></div>
            </div>
          </div>
        `;

        body.querySelectorAll('.besing-theme-btn').forEach(btn => {{
          btn.onclick = async () => {{
            const t = btn.getAttribute('data-t');
            await this.storage.setTheme(t);
            this.updatePetIcon(this.widgetEl);
            body.querySelectorAll('.besing-theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          }};
        }});

        const checkBtn = body.querySelector('#besing-btn-check-update');
        const updateMsg = body.querySelector('#besing-update-msg');
        checkBtn.onclick = async () => {{
          checkBtn.disabled = true;
          updateMsg.textContent = 'Checking for updates...';
          try {{
            const res = await this.updater.checkForUpdates(true);
            if (res.ok) {{
              if (res.hasUpdate) {{
                updateMsg.innerHTML = `<span style="color:#a78bfa;font-weight:700;">Update found!</span> v${{res.remoteVersion}} available. <a href="${{res.downloadUrl}}" target="_blank" style="color:#38bdf8;text-decoration:underline;">Click here to install update</a>.`;
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

        body.querySelector('#besing-btn-turn-off-site').onclick = async () => {{
          if (confirm(`Disable BESing on ${{currentHost}}?`)) {{
            await this.storage.blockSite(currentHost);
            this.teardown();
          }}
        }};

        const renderBlockedRows = () => {{
          const container = body.querySelector('#besing-blocked-container');
          if (!container) return;
          const list = this.storage.getBlockedSites();
          container.innerHTML = '';
          if (!list.length) {{
            container.innerHTML = '<div class="besing-empty-state">No sites disabled.</div>';
            return;
          }}
          list.forEach(item => {{
            const row = document.createElement('div');
            row.className = 'besing-blocked-item';
            row.innerHTML = `
              <div>
                <span class="besing-blocked-domain">${{item.host}}</span>
                <span class="besing-blocked-date">${{new Date(item.addedAt).toLocaleDateString()}}</span>
              </div>
              <button class="besing-btn-unblock">Re-enable</button>
            `;
            row.querySelector('.besing-btn-unblock').onclick = async () => {{
              await this.storage.unblockSite(item.host);
              renderBlockedRows();
              const cnt = body.querySelector('.besing-blocklist-count');
              if (cnt) cnt.textContent = this.storage.getBlockedSites().length;
            }};
            container.appendChild(row);
          }});
        }};
        renderBlockedRows();

      }} else {{
        // Extensions View: All scripts pre-installed, off by default, toggleable!
        body.innerHTML = `
          <div class="besing-search-wrap">
            <svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" class="besing-search-input" placeholder="Search installed scripts..." value="${{this.searchQuery}}">
          </div>
          <div class="besing-ext-list" id="besing-ext-container"></div>
        `;

        const searchInput = body.querySelector('.besing-search-input');
        const extContainer = body.querySelector('#besing-ext-container');

        const renderCards = () => {{
          extContainer.innerHTML = '';
          const q = this.searchQuery;
          const filtered = this.modules.filter(m => {{
            if (!q) return true;
            return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q);
          }});

          const header = document.createElement('div');
          header.className = 'besing-section-heading';
          header.innerHTML = `
            <span>Installed Scripts</span>
            <span class="besing-pill-count">${{filtered.length}}</span>
          `;
          extContainer.appendChild(header);

          if (!filtered.length) {{
            const empty = document.createElement('div');
            empty.className = 'besing-empty-state';
            empty.textContent = q ? 'No scripts match your search.' : 'No scripts found.';
            extContainer.appendChild(empty);
            return;
          }}

          filtered.forEach(m => {{
            const card = document.createElement('div');
            card.className = 'besing-ext-card';
            const isEnabled = this.storage.isScriptEnabled(m.id, false);

            card.innerHTML = `
              <div class="besing-ext-info-group">
                <div class="besing-ext-icon">${{m.icon || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}}</div>
                <div class="besing-ext-meta">
                  <div class="besing-ext-title-row">
                    <span class="besing-ext-name">${{m.name}}</span>
                    <span class="besing-ext-ver">v${{m.version || '1.0.0'}}</span>
                    ${{m.category ? `<span class="besing-cat-badge">${{m.category}}</span>` : ''}}
                  </div>
                  <p class="besing-ext-desc">${{m.description || ''}}</p>
                </div>
              </div>
              <div class="besing-ext-actions">
                <label class="besing-switch" title="Toggle ${{m.name}}">
                  <input type="checkbox" ${{isEnabled ? 'checked' : ''}}>
                  <span class="besing-slider"></span>
                </label>
              </div>
            `;

            card.querySelector('input').onchange = async (e) => {{
              const val = e.target.checked;
              await this.storage.setScriptEnabled(m.id, val);
              m.enabled = val;
              if (val) {{
                try {{ m.init(); }} catch (err) {{
                  console.error(`[BESing] Failed to start ${{m.id}}:`, err);
                }}
              }} else {{
                try {{ m.destroy(); }} catch (err) {{
                  console.error(`[BESing] Failed to stop ${{m.id}}:`, err);
                }}
              }}
              this.updateBadge();
            }};

            extContainer.appendChild(card);
          }});
        }};

        searchInput.oninput = (e) => {{
          this.searchQuery = e.target.value.toLowerCase().trim();
          renderCards();
        }};

        renderCards();
      }}
    }}

    closeModal() {{
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
        :host {{ all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color-scheme: dark; }}
        *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
        .besing-trigger {{ position: fixed; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1.5px solid rgba(129, 140, 248, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 18px rgba(99, 102, 241, 0.3); display: flex; align-items: center; justify-content: center; color: #c7d2fe; cursor: grab; user-select: none; touch-action: none; z-index: 2147483640; transition: transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease, border-color 0.2s ease, opacity 0.2s ease; }}
        .besing-trigger:hover {{ transform: scale(1.1); border-color: rgba(165, 180, 252, 0.85); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 26px rgba(99, 102, 241, 0.55); }}
        .besing-trigger:active {{ cursor: grabbing; transform: scale(0.95); }}
        .besing-trigger.folded-left {{ transform: translateX(-65%); opacity: 0.82; }}
        .besing-trigger.folded-right {{ transform: translateX(32px); clip-path: inset(-12px 32px -12px -12px); opacity: 0.82; }}
        .besing-trigger.folded-top {{ transform: translateY(-65%); opacity: 0.82; }}
        .besing-trigger.folded-bottom {{ transform: translateY(65%); opacity: 0.82; }}
        .besing-trigger.folded-top.folded-left {{ transform: translate(-55%, -55%); }}
        .besing-trigger.folded-top.folded-right {{ transform: translate(32px, -55%); clip-path: inset(-12px 32px -12px -12px); }}
        .besing-trigger.folded-bottom.folded-left {{ transform: translate(-55%, 55%); }}
        .besing-trigger.folded-bottom.folded-right {{ transform: translate(32px, 55%); clip-path: inset(-12px 32px -12px -12px); }}
        .besing-trigger.folded-right:hover, .besing-trigger.folded-left:hover, .besing-trigger.folded-top:hover, .besing-trigger.folded-bottom:hover {{ transform: translate(0, 0) scale(1.08); clip-path: none; opacity: 1; }}
        .besing-trigger.folded-right::before {{ content: ""; position: absolute; left: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-left::after {{ content: ""; position: absolute; right: 2px; top: 14px; bottom: 14px; width: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-top:not(.folded-right)::before, .besing-trigger.folded-top.folded-right::after {{ content: ""; position: absolute; bottom: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-trigger.folded-bottom:not(.folded-left)::after, .besing-trigger.folded-bottom.folded-left::before {{ content: ""; position: absolute; top: 2px; left: 14px; right: 14px; height: 3px; background: #38bdf8; border-radius: 2px; box-shadow: 0 0 8px #38bdf8; z-index: 3; }}
        .besing-badge-count {{ position: absolute; top: -2px; right: -2px; background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; font-size: 10px; font-weight: 700; height: 18px; min-width: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px; border: 2px solid #0f172a; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }}
        .besing-pet-eye {{ transform-origin: center; animation: petBlink 4.5s infinite; }}
        .besing-pet-face:hover .besing-pet-eye {{ animation: none; transform: scaleY(0.2) translateY(1px); }}
        @keyframes petBlink {{ 0%, 93%, 100% {{ transform: scaleY(1); }} 96% {{ transform: scaleY(0.1); }} }}
        .besing-bubble-wrapper {{ position: fixed; z-index: 2147483642; pointer-events: auto; animation: besingBubblePop 0.22s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-bubble-arrow {{ position: absolute; width: 14px; height: 14px; background: #0d1322; border: 1px solid rgba(255, 255, 255, 0.14); transform: rotate(45deg); z-index: 2; }}
        .besing-bubble-arrow.arrow-bottom {{ bottom: -7px; border-top: none; border-left: none; }}
        .besing-bubble-arrow.arrow-top {{ top: -7px; border-bottom: none; border-right: none; }}
        .besing-bubble-panel {{ width: 390px; max-width: calc(100vw - 28px); max-height: 520px; background: linear-gradient(180deg, rgba(16, 23, 38, 0.98) 0%, rgba(9, 13, 22, 0.99) 100%); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.13); border-radius: 18px; box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.75), 0 0 30px rgba(99, 102, 241, 0.16); display: flex; flex-direction: column; overflow: hidden; color: #e2e8f0; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }}
        .besing-bubble-panel.is-expanded {{ width: 540px; max-height: 80vh; }}
        .besing-header {{ padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02); }}
        .besing-logo-group {{ display: flex; align-items: center; gap: 10px; }}
        .besing-logo-icon {{ width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #6366f1, #3b82f6); display: flex; align-items: center; justify-content: center; color: #ffffff; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4); }}
        .besing-title {{ font-size: 14px; font-weight: 700; color: #f8fafc; }}
        .besing-tag {{ font-size: 10px; font-weight: 600; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.3); }}
        .besing-header-actions {{ display: flex; align-items: center; gap: 6px; }}
        .besing-btn-icon {{ background: transparent; border: none; color: #94a3b8; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }}
        .besing-btn-icon:hover {{ background: rgba(255, 255, 255, 0.08); color: #f8fafc; }}
        .besing-btn-icon.active {{ background: rgba(99, 102, 241, 0.25); color: #818cf8; }}
        .besing-body {{ padding: 14px 18px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px; }}
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
        .besing-site-card {{ background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }}
        .besing-site-card-header {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-current-domain {{ font-size: 12px; font-weight: 600; color: #fca5a5; font-family: monospace; }}
        .besing-btn-danger {{ background: linear-gradient(135deg, #ef4444, #dc2626); color: #ffffff; border: none; border-radius: 8px; padding: 7px 12px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s ease; }}
        .besing-btn-danger:hover {{ background: linear-gradient(135deg, #f87171, #ef4444); transform: translateY(-1px); }}
        .besing-blocklist-header {{ display: flex; align-items: center; justify-content: space-between; }}
        .besing-blocklist-title {{ font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; }}
        .besing-blocklist-count {{ font-size: 10px; color: #64748b; background: rgba(255, 255, 255, 0.05); padding: 2px 6px; border-radius: 10px; }}
        .besing-blocked-list {{ display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }}
        .besing-blocked-item {{ background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 7px 10px; display: flex; align-items: center; justify-content: space-between; }}
        .besing-blocked-domain {{ font-family: monospace; font-size: 11px; color: #e2e8f0; }}
        .besing-blocked-date {{ font-size: 10px; color: #64748b; margin-left: 6px; }}
        .besing-btn-unblock {{ background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 5px; padding: 3px 8px; font-size: 10px; font-weight: 600; cursor: pointer; }}
        .besing-btn-unblock:hover {{ background: rgba(56, 189, 248, 0.25); color: #7dd3fc; }}
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
      `;
      shadow.appendChild(style);
    }}
  }}

  const app = new BESManagerApp();
  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', () => app.init());
  }} else {{
    app.init();
  }}
}})();
"""

    print(f"[*] Writing mega-file to {TARGET_USER_JS}...")
    TARGET_USER_JS.write_text(full_script, encoding="utf-8")
    
    print(f"[*] Writing meta-file to {TARGET_META_JS}...")
    TARGET_META_JS.write_text(META_SCRIPT_CONTENT, encoding="utf-8")

    size_kb = len(full_script.encode('utf-8')) / 1024
    print(f"[OK] Mega-file generated successfully! ({len(modules_code)} modules bundled, {size_kb:.1f} KB)")

if __name__ == "__main__":
    build()
