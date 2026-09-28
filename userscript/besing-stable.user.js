// ==UserScript==
// @name         BESing Stable Loader
// @namespace    https://github.com/CoronRing/BESing
// @version      1.0.0
// @description  Ultra-minimal, zero-maintenance bootstrapper for BESing. Dynamically loads and caches the latest BESing release from GitHub.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Release URL endpoint (GitHub Raw primary, local fallback)
  const REMOTE_SCRIPT_URL = 'https://raw.githubusercontent.com/CoronRing/BESing/main/BESing/userscript/besing-manager.user.js';
  const LOCAL_DEV_URL = 'http://127.0.0.1:8765/userscript/besing-manager.user.js';
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  function runCode(code) {
    if (!code || typeof code !== 'string') return;
    try {
      const exec = new Function(code);
      exec();
    } catch (err) {
      console.error('[BESing Stable Loader] Execution error:', err);
    }
  }

  function fetchRemote(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`,
          timeout: 8000,
          onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error('HTTP ' + res.status)),
          onerror: (err) => reject(new Error(err.error || 'Network error')),
          ontimeout: () => reject(new Error('Timeout'))
        });
      } else {
        fetch(`${url}?_t=${Date.now()}`, { cache: 'no-cache' })
          .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
          .then(resolve)
          .catch(reject);
      }
    });
  }

  async function checkAndRefresh(force = false) {
    const lastCheck = GM_getValue('besing_last_check', 0);
    const now = Date.now();
    if (!force && (now - lastCheck < ONE_DAY_MS)) return;

    try {
      let code = null;
      try {
        code = await fetchRemote(REMOTE_SCRIPT_URL);
      } catch (e) {
        // Fallback to local dev server if github is unreachable
        code = await fetchRemote(LOCAL_DEV_URL);
      }

      if (code && code.length > 500) {
        GM_setValue('besing_cached_code', code);
        GM_setValue('besing_last_check', now);
        console.log('[BESing Stable Loader] Successfully updated code cache.');
      }
    } catch (e) {
      console.warn('[BESing Stable Loader] Update check skipped/failed:', e.message);
    }
  }

  // 1. Instant execution of cached version (zero latency on page load)
  const cached = GM_getValue('besing_cached_code', null);
  if (cached) {
    runCode(cached);
  }

  // 2. Refresh check (runs once a day, or immediately on first install)
  if (!cached) {
    checkAndRefresh(true).then(() => {
      const fresh = GM_getValue('besing_cached_code', null);
      if (fresh) runCode(fresh);
    });
  } else {
    // Background check once per day after page is idle
    setTimeout(() => checkAndRefresh(false), 3000);
  }

  // 3. Global hook for manual update triggering
  window.__BESING_RELOAD_LATEST__ = () => checkAndRefresh(true);
})();
