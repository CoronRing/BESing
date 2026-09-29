// ==UserScript==
// @name         BESing Stable
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.6
// @description  Ultra-minimal, zero-maintenance bootstrapper for BESing. Dynamically loads and caches the latest BESing release from GitHub/GreasyFork with silent auto-updates.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @sandbox      JavaScript
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      update.greasyfork.org
// @connect      greasyfork.org
// @connect      cdn.jsdelivr.net
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // If BESing Packed is already running or registered, skip running stable bootstrapper to avoid collision
  const isPackedRunning = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.name && GM_info.script.name.includes('Packed')) ||
    (typeof window !== 'undefined' && window.__BESING_INSTANCE__ && window.__BESING_INSTANCE__.isPacked) ||
    (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__ && unsafeWindow.__BESING_INSTANCE__.isPacked);
  if (isPackedRunning) {
    console.warn('[BESing Stable] BESing Packed is already active. Skipping stable bootstrapper execution to prevent duplicate widgets.');
    return;
  }

  // Mark environment so inner script knows it is running under the stable bootstrapper
  try {
    if (typeof window !== 'undefined') window.__BESING_ENVIRONMENT__ = 'stable-loader';
    if (typeof unsafeWindow !== 'undefined') unsafeWindow.__BESING_ENVIRONMENT__ = 'stable-loader';
  } catch (e) {}

  // Register Tampermonkey Control Panel commands if not already registered
  if (typeof GM_registerMenuCommand === 'function' && !window.__BESING_MENU_REGISTERED__) {
    window.__BESING_MENU_REGISTERED__ = true;
    try {
      GM_registerMenuCommand('✨ Show / Pull Up BESing Icon', () => {
        const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
        if (inst && typeof inst.pullUpIcon === 'function') {
          inst.pullUpIcon();
        } else {
          console.log('[BESing Stable Loader] Pulling up icon, executing cached code...');
          const cached = (typeof GM_getValue === 'function') ? GM_getValue('besing_cached_code', null) : null;
          if (cached) runCode(cached);
        }
      });
      GM_registerMenuCommand('🔄 Reset Icon Position to Default', () => {
        const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
        if (inst && typeof inst.resetWidgetPosition === 'function') {
          inst.resetWidgetPosition();
        }
      });
      GM_registerMenuCommand('⚙️ Open BESing Settings', () => {
        const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
        if (inst && typeof inst.openModal === 'function') {
          inst.openModal('settings');
        }
      });
      GM_registerMenuCommand('📦 Open BESing Extensions', () => {
        const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
        if (inst && typeof inst.openModal === 'function') {
          inst.openModal('extensions');
        }
      });
      GM_registerMenuCommand('ℹ️ Direct Install (For Strict CSP Sites)', () => {
        if (typeof window !== 'undefined') window.open('https://greasyfork.org/en/scripts/597772-besing-script-manager', '_blank');
      });
    } catch (e) {}
  }

  // Back/forward cache (bfcache) restore listener
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', () => {
      const inst = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__) || (typeof window !== 'undefined' && window.__BESING_INSTANCE__);
      if (inst && typeof inst.ensureMounted === 'function') {
        inst.ensureMounted();
        inst.clampWidgetPosition();
      }
    });
  }

  const PRIMARY_SCRIPT_URL = 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.user.js';
  const CDN_MIRRORS = [
    'https://update.greasyfork.org/scripts/597772/BESing%20Script%20Manager.user.js',
    'https://cdn.jsdelivr.net/gh/CoronRing/BESing@master/userscript/besing-manager.user.js',
    'http://127.0.0.1:8765/userscript/besing-manager.user.js'
  ];
  const REMOTE_META_URL = 'https://raw.githubusercontent.com/CoronRing/BESing/master/userscript/besing-manager.meta.js';
  const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Check meta.js every 15 minutes in background

  function parseVersion(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/@version\s+([0-9\.]+)/i);
    return match ? match[1].trim() : null;
  }

  function compareVersions(vA, vB) {
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

  function runCode(code) {
    if (!code || typeof code !== 'string') return;
    try {
      if (typeof window !== 'undefined') window.__BESING_ENVIRONMENT__ = 'stable-loader';
      // Pass GM APIs explicitly so the dynamically evaluated script has full userscript powers
      const exec = new Function(
        'GM_getValue',
        'GM_setValue',
        'GM_deleteValue',
        'GM_registerMenuCommand',
        'GM_xmlhttpRequest',
        'GM_info',
        'unsafeWindow',
        code
      );
      exec(
        typeof GM_getValue !== 'undefined' ? GM_getValue : undefined,
        typeof GM_setValue !== 'undefined' ? GM_setValue : undefined,
        typeof GM_deleteValue !== 'undefined' ? GM_deleteValue : undefined,
        typeof GM_registerMenuCommand !== 'undefined' ? GM_registerMenuCommand : undefined,
        typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : undefined,
        typeof GM_info !== 'undefined' ? GM_info : { script: { name: 'BESing Stable' } },
        typeof unsafeWindow !== 'undefined' ? unsafeWindow : window
      );
      console.log('[BESing Stable] BESing successfully initialized.');
    } catch (err) {
      console.error('[BESing Stable Loader] Execution error:', err);
      const isCspError = err && (err.name === 'EvalError' || (err.message && err.message.includes('Content Security Policy')));
      if (isCspError) {
        console.warn('[BESing Stable Loader] Website Content Security Policy (CSP) blocked dynamic eval(). On sites like LinkedIn or GitHub, either enable "Modify CSP headers" in Tampermonkey Settings or install the full direct script: https://greasyfork.org/en/scripts/597772-besing-script-manager');
      }
      try {
        const s = document.createElement('script');
        s.textContent = code;
        (document.body || document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch (fallbackErr) {
        console.error('[BESing Stable Loader] Fallback execution failed:', fallbackErr);
      }
    }
  }

  function fetchRemote(url, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let resolved = false;

      // Safe AbortController for native fetch fallback
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (controller) controller.abort();
          reject(new Error(`Timeout (${timeoutMs}ms) for ${url}`));
        }
      }, timeoutMs);

      if (typeof GM_xmlhttpRequest === 'function') {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url: `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`,
            timeout: timeoutMs,
            onload: (res) => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timer);
              if (res.status >= 200 && res.status < 300 && res.responseText) {
                resolve(res.responseText);
              } else {
                reject(new Error('HTTP ' + res.status));
              }
            },
            onerror: (err) => {
              if (resolved) return;
              const fetchUrl = url.includes('raw.githubusercontent.com')
                ? url.replace('https://raw.githubusercontent.com/CoronRing/BESing/master/', 'https://cdn.jsdelivr.net/gh/CoronRing/BESing@master/')
                : url;
              fetch(`${fetchUrl}${fetchUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-cache', signal: controller ? controller.signal : undefined })
                .then(r => r.ok ? r.text() : Promise.reject(new Error('Fetch HTTP ' + r.status)))
                .then(text => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(text); } })
                .catch(e => { if (!resolved) { resolved = true; clearTimeout(timer); reject(e); } });
            },
            ontimeout: () => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timer);
              reject(new Error('GM_xmlhttpRequest timeout'));
            }
          });
          return;
        } catch (e) {}
      }

      fetch(`${url}?_t=${Date.now()}`, { cache: 'no-cache', signal: controller ? controller.signal : undefined })
        .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(text => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(text); } })
        .catch(e => { if (!resolved) { resolved = true; clearTimeout(timer); reject(e); } });
    });
  }

  async function downloadAndCacheFull() {
    let code = null;
    const targets = [PRIMARY_SCRIPT_URL, ...CDN_MIRRORS];

    for (const url of targets) {
      try {
        code = await fetchRemote(url, 3500);
        if (code && code.length > 500) {
          break;
        }
      } catch (e) {
        console.warn(`[BESing Stable Loader] Mirror fetch failed (${url}):`, e.message);
      }
    }

    if (code && code.length > 500) {
      const ver = parseVersion(code) || '1.0.0';
      if (typeof GM_setValue === 'function') {
        GM_setValue('besing_cached_code', code);
        GM_setValue('besing_cached_version', ver);
        GM_setValue('besing_last_check', Date.now());
      }
      console.log(`[BESing Stable Loader] Successfully fetched and cached latest BESing release (v${ver}).`);
      return { code, version: ver };
    }
    return null;
  }

  async function checkAndAutoUpdate(force = false) {
    const now = Date.now();
    const lastCheck = (typeof GM_getValue === 'function') ? GM_getValue('besing_last_check', 0) : 0;
    const currentVer = (typeof GM_getValue === 'function') ? GM_getValue('besing_cached_version', '0.0.0') : '0.0.0';

    if (!force && (now - lastCheck < CHECK_INTERVAL_MS)) return null;

    try {
      if (force) {
        return await downloadAndCacheFull();
      }

      // Check lightweight meta.js first (~300 bytes)
      const meta = await fetchRemote(REMOTE_META_URL);
      const remoteVer = parseVersion(meta);
      if (typeof GM_setValue === 'function') {
        GM_setValue('besing_last_check', now);
      }

      if (remoteVer && compareVersions(remoteVer, currentVer) > 0) {
        console.log(`[BESing Stable Loader] Newer version v${remoteVer} found (cached is v${currentVer}). Silently auto-updating...`);
        const res = await downloadAndCacheFull();
        try {
          window.dispatchEvent(new CustomEvent('besing:auto-updated', { detail: { version: remoteVer } }));
        } catch (e) {}
        return res;
      }
    } catch (e) {
      console.warn('[BESing Stable Loader] Auto-update check skipped/failed:', e.message);
    }
    return null;
  }

  // Expose global hooks for inner application on both window and unsafeWindow
  const autoUpdateFn = async (force = true) => {
    const res = await downloadAndCacheFull();
    return res ? { ok: true, version: res.version } : { ok: false };
  };
  const reloadLatestFn = async () => {
    const res = await downloadAndCacheFull();
    if (res && res.code) runCode(res.code);
  };

  try {
    if (typeof window !== 'undefined') {
      window.__BESING_ENVIRONMENT__ = 'stable-loader';
      window.__BESING_AUTO_UPDATE__ = autoUpdateFn;
      window.__BESING_RELOAD_LATEST__ = reloadLatestFn;
    }
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.__BESING_ENVIRONMENT__ = 'stable-loader';
      unsafeWindow.__BESING_AUTO_UPDATE__ = autoUpdateFn;
      unsafeWindow.__BESING_RELOAD_LATEST__ = reloadLatestFn;
    }
  } catch (e) {}

  // 1. Instant execution of cached version (zero latency on page load)
  const cached = (typeof GM_getValue === 'function') ? GM_getValue('besing_cached_code', null) : null;
  if (cached) {
    runCode(cached);
  }

  // 2. Refresh check (immediately on first install, or throttled background check)
  if (!cached) {
    console.log('[BESing Stable Loader] First install detected. Fetching latest release...');
    downloadAndCacheFull().then((res) => {
      if (res && res.code) runCode(res.code);
    }).catch(err => {
      console.error('[BESing Stable Loader] Initial setup failed:', err);
    });
  } else {
    // Throttled background check for new release
    setTimeout(() => checkAndAutoUpdate(false), 3000);
  }
})();
