// ==UserScript==
// @name         Sync History
// @namespace    https://github.com/CoronRing/BESing
// @version      1.3.0
// @description  Sync tabs, groups, 7-day history, and usage across devices.
// @author       BESing Team
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      supabase.co
// @connect      *.supabase.co
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BrowserSync = {
    id: 'browser-sync',
    name: 'Sync History',
    version: '1.3.0',
    activationMode: 'global',
    description: 'Sync tabs, groups, 7-day history, and usage across devices.',
    category: 'Sync',

    SHARED_CACHE_KEY: 'browser_sync_cache',
    SHARED_STATS_KEY: 'browser_sync_stats',
    SHARED_META_KEY: 'browser_sync_meta',
    SHARED_PENDING_KEY: 'browser_sync_pending',
    SHARED_TABS_KEY: 'browser_sync_tabs',
    SHARED_CLOSED_KEY: 'browser_sync_closed',
    SHARED_DEDUP_KEY: 'browser_sync_dedup',

    SENSITIVE_PARAMS: [
      'token', 'access_token', 'id_token', 'refresh_token', 'auth', 'auth_token',
      'key', 'apikey', 'api_key', 'secret', 'password', 'passwd', 'pwd',
      'session', 'sessionid', 'session_id', 'sid', 'code', 'state', 'sig',
      'signature', 'jwt', 'bearer', 'oauth', 'nonce', 'csrf', 'xsrf',
      'credential', 'credentials', 'private_key', 'client_secret'
    ],
    TRACKING_PARAMS: [
      'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
      'ref_src', 'ref_url', 'igshid', 'sxsrf', 'ved', 'ei'
    ],

    _config: null,
    _active: false,
    _tabId: null,
    _lastUrl: '',
    _lastActivityTs: 0,
    _activeSegmentStart: 0,
    _usageTimer: null,
    _pullCheckTimer: null,
    _visitDelayTimer: null,
    _boundVisibility: null,
    _boundPageHide: null,
    _boundBeforeUnload: null,
    _boundPageShow: null,
    _boundActivity: null,
    _boundRouteChange: null,
    _origPushState: null,
    _origReplaceState: null,
    _pushInFlight: false,
    _pullInFlight: false,
    _pageHidingAt: 0,
    _lastTabRefreshTs: 0,
    _lastTabCount: 0,
    _lastClosedCount: 0,

    // -----------------------------------------------------------------------
    // Runtime & Helpers
    // -----------------------------------------------------------------------

    _getCloudConfig() {
      const cfg = this._config || {};
      const mgr = this._manager();
      const cloud = (mgr && mgr.cloud && typeof mgr.cloud.getConfig === 'function')
        ? mgr.cloud.getConfig()
        : {};
      return {
        syncLink: (cloud.syncLink && String(cloud.syncLink).trim()) || (cfg.syncLink && String(cfg.syncLink).trim()) || '',
        deviceName: (cloud.deviceName && String(cloud.deviceName).trim()) || (cfg.deviceName && String(cfg.deviceName).trim()) || this.defaultDeviceName(),
        accountLabel: (cloud.accountLabel && String(cloud.accountLabel).trim()) || (cfg.accountLabel && String(cfg.accountLabel).trim()) || ''
      };
    },

    _manager() {
      const inst = (typeof window !== 'undefined' && window.__BESING_INSTANCE__) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__BESING_INSTANCE__);
      return inst && !inst.disposed ? inst : null;
    },

    isExtensionMode() {
      if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') return false;
      return typeof chrome !== 'undefined'
        && !!chrome.runtime
        && typeof chrome.runtime.id === 'string'
        && chrome.runtime.id.length > 0
        && typeof chrome.runtime.sendMessage === 'function'
        && !!chrome.storage
        && !!chrome.storage.local;
    },

    _sendExt(msg) {
      return new Promise((resolve) => {
        if (!this.isExtensionMode()) {
          resolve({ ok: false, error: 'Not in extension mode' });
          return;
        }
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ ok: false, error: 'Extension background worker timed out' });
          }
        }, 12000);
        try {
          chrome.runtime.sendMessage(msg, (resp) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (chrome.runtime && chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(resp || { ok: false, error: 'Empty response from background worker' });
            }
          });
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, error: e.message || String(e) });
          }
        }
      });
    },

    async _readShared(key, fallback) {
      const mgr = this._manager();
      if (mgr && typeof mgr.readSharedState === 'function') {
        try {
          const val = await mgr.readSharedState(key, fallback);
          return val !== undefined ? val : fallback;
        } catch (e) {}
      }
      if (typeof GM_getValue === 'function') {
        try {
          const raw = GM_getValue('shared_' + key, undefined);
          if (raw !== undefined) return raw;
        } catch (e) {}
      }
      try {
        const s = window.localStorage.getItem('besing_shared_' + key);
        return s ? JSON.parse(s) : fallback;
      } catch (e) {
        return fallback;
      }
    },

    async _writeShared(key, val) {
      const mgr = this._manager();
      if (mgr && typeof mgr.writeSharedState === 'function') {
        try {
          await mgr.writeSharedState(key, val);
          return true;
        } catch (e) {}
      }
      if (typeof GM_setValue === 'function') {
        try {
          GM_setValue('shared_' + key, val);
          return true;
        } catch (e) {}
      }
      try {
        window.localStorage.setItem('besing_shared_' + key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },

    _b64UrlEncode(str) {
      const bytes = new TextEncoder().encode(String(str || ''));
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    _b64UrlDecode(str) {
      let b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    },

    parseSyncLink(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      try {
        let payloadStr = s;
        if (s.startsWith('besing-sync://')) {
          payloadStr = this._b64UrlDecode(s.slice('besing-sync://'.length));
        } else if (!s.startsWith('{')) {
          return null;
        }
        const obj = JSON.parse(payloadStr);
        const url = String(obj.u || obj.url || '').trim().replace(/\/+$/, '');
        const key = String(obj.k || obj.anonKey || obj.key || '').trim();
        const secret = String(obj.s || obj.secret || '').trim();
        if (!url || !key || !secret || secret.length < 16) return null;
        const isHttps = url.startsWith('https://');
        const isLocalTest = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
        if (!isHttps && !isLocalTest) return null;
        return { url, key, secret };
      } catch (e) {
        return null;
      }
    },

    buildSyncLink(url, anonKey, secret) {
      const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
      const cleanKey = String(anonKey || '').trim();
      const cleanSecret = String(secret || '').trim();
      if (!cleanUrl || !cleanKey || cleanSecret.length < 16) return null;
      return 'besing-sync://' + this._b64UrlEncode(JSON.stringify({ v: 1, u: cleanUrl, k: cleanKey, s: cleanSecret }));
    },

    generateRandomSecret() {
      const bytes = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    async sha256Hex(text) {
      const bytes = new TextEncoder().encode(String(text || ''));
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        try {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {}
      }
      // Pure JS SHA-256 fallback for non-HTTPS contexts (e.g. local demo server).
      const K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
      ];
      let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
      const bitLen = bytes.length * 8;
      const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
      const buf = new Uint8Array(paddedLen);
      buf.set(bytes);
      buf[bytes.length] = 0x80;
      const view = new DataView(buf.buffer);
      view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
      view.setUint32(paddedLen - 4, bitLen >>> 0, false);
      const w = new Uint32Array(64);
      const rotr = (x, n) => (x >>> n) | (x << (32 - n));
      for (let off = 0; off < paddedLen; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
          const s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
          w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
        }
        let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
        for (let i = 0; i < 64; i++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          const ch = (e & f) ^ (~e & g);
          const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) >>> 0;
          h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
        }
        h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
        h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
      }
      return [h0,h1,h2,h3,h4,h5,h6,h7].map(v => v.toString(16).padStart(8, '0')).join('');
    },

    async generateSetupBundle(supabaseUrl, anonKey, retentionDays = 7) {
      const cleanUrl = String(supabaseUrl || '').trim().replace(/\/+$/, '');
      const cleanKey = String(anonKey || '').trim();
      const isHttps = cleanUrl.startsWith('https://');
      const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(cleanUrl);
      if (!cleanUrl || (!isHttps && !isLocal)) {
        return { ok: false, error: 'Supabase URL must start with https://' };
      }
      if (!cleanKey || cleanKey.length < 16) {
        return { ok: false, error: 'Paste your Supabase publishable/anon key (never the service_role key).' };
      }
      const secret = this.generateRandomSecret();
      const spaceHash = await this.sha256Hex(secret);
      const syncLink = this.buildSyncLink(cleanUrl, cleanKey, secret);
      const days = Math.max(1, Math.min(90, Number(retentionDays) || 7));
      const sql = `insert into public.besing_sync_spaces (space_hash, label, retention_days)\nvalues ('${spaceHash}', 'personal', ${days})\non conflict (space_hash) do nothing;`;
      return { ok: true, syncLink, spaceHash, sql };
    },

    detectBrowser() {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      if (/EdgiOS|EdgA|Edg\//i.test(ua)) return 'edge';
      if (/CriOS/i.test(ua)) return 'chrome';
      if (/FxiOS|Firefox\//i.test(ua)) return 'firefox';
      if (/OPR\/|OPiOS/i.test(ua)) return 'opera';
      if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'safari';
      if (/Chrome\//i.test(ua)) return 'chrome';
      return 'browser';
    },

    detectPlatform() {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const maxTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
      if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouch > 1)) return 'ipados';
      if (/iPhone|iPod/i.test(ua)) return 'ios';
      if (/Android/i.test(ua)) return 'android';
      if (/Windows/i.test(ua)) return 'windows';
      if (/Macintosh|Mac OS/i.test(ua)) return 'macos';
      if (/Linux/i.test(ua)) return 'linux';
      return 'web';
    },

    defaultDeviceName() {
      const p = this.detectPlatform();
      if (p === 'ios') return 'iPhone';
      if (p === 'ipados') return 'iPad';
      if (p === 'windows') return 'Windows-PC';
      if (p === 'macos') return 'Mac';
      if (p === 'android') return 'Android';
      return 'Device';
    },

    _todayStr() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    _parseExcludeHosts(cfg) {
      const raw = (cfg && typeof cfg.excludeHosts === 'string') ? cfg.excludeHosts : '';
      return raw.split(/[\s,;]+/).map(h => h.trim().toLowerCase()).filter(Boolean);
    },

    sanitizeUrl(rawUrl, excludeList = []) {
      if (!rawUrl || typeof rawUrl !== 'string') return null;
      let parsed;
      try { parsed = new URL(rawUrl.trim()); } catch (e) { return null; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const host = (parsed.hostname || '').toLowerCase();
      if (!host) return null;
      for (let i = 0; i < excludeList.length; i++) {
        const rule = excludeList[i];
        if (host === rule || host.endsWith('.' + rule)) return null;
      }
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';

      const sens = new Set(this.SENSITIVE_PARAMS);
      const track = new Set(this.TRACKING_PARAMS);
      const del = [];
      parsed.searchParams.forEach((_, k) => {
        const lk = k.toLowerCase();
        if (sens.has(lk) || track.has(lk) || lk.startsWith('utm_')) del.push(k);
      });
      for (let i = 0; i < del.length; i++) parsed.searchParams.delete(del[i]);

      let clean = parsed.toString();
      if (clean.length > 500) clean = clean.slice(0, 500);
      return { url: clean, host: host.slice(0, 160) };
    },

    _cleanTitle(raw) {
      let s = String(raw || '').replace(/\s+/g, ' ').trim();
      if (/^https?:\/\//i.test(s)) {
        const cleaned = this.sanitizeUrl(s, []);
        s = cleaned ? cleaned.url : '';
      }
      const re = new RegExp('([?&])(' + this.SENSITIVE_PARAMS.join('|') + ')=[^&\\s#]+', 'gi');
      s = s.replace(re, '$1$2=[redacted]');
      return s.slice(0, 200);
    },

    // -----------------------------------------------------------------------
    // Userscript-Mode State & Network RPC
    // -----------------------------------------------------------------------

    async _ensureMeta() {
      let meta = await this._readShared(this.SHARED_META_KEY, null);
      if (!meta || !meta.instanceId) {
        const bytes = new Uint8Array(10);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          crypto.getRandomValues(bytes);
        } else {
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        }
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        meta = { instanceId: 'usr-' + hex, createdAt: Date.now() };
        await this._writeShared(this.SHARED_META_KEY, meta);
      }
      return meta;
    },

    _getTabId() {
      if (this._tabId) return this._tabId;
      try {
        let id = window.sessionStorage.getItem('__besing_sync_tab_id__');
        if (!id) {
          id = 't-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
          window.sessionStorage.setItem('__besing_sync_tab_id__', id);
        }
        this._tabId = id;
        return id;
      } catch (e) {
        this._tabId = 't-' + Math.random().toString(36).slice(2, 10);
        return this._tabId;
      }
    },

    async _getCache() {
      const c = await this._readShared(this.SHARED_CACHE_KEY, null);
      if (c && typeof c === 'object') {
        return {
          devices: Array.isArray(c.devices) ? c.devices : [],
          history: Array.isArray(c.history) ? c.history : [],
          usage: Array.isArray(c.usage) ? c.usage : [],
          lastServerTime: c.lastServerTime || null,
          lastPullAt: Number(c.lastPullAt) || 0,
          lastPushAt: Number(c.lastPushAt) || 0,
          pullLockUntil: Number(c.pullLockUntil) || 0,
          lastError: c.lastError || null,
          retentionDays: Number(c.retentionDays) || 7
        };
      }
      return {
        devices: [], history: [], usage: [],
        lastServerTime: null, lastPullAt: 0, lastPushAt: 0, pullLockUntil: 0,
        lastError: null, retentionDays: 7
      };
    },

    async _recordTraffic(kind, bytesSent, bytesReceived) {
      const today = this._todayStr();
      const s = (await this._readShared(this.SHARED_STATS_KEY, null)) || {
        day: today, bytesSentToday: 0, bytesReceivedToday: 0, pushesToday: 0, pullsToday: 0,
        bytesSentTotal: 0, bytesReceivedTotal: 0, pushesTotal: 0, pullsTotal: 0
      };
      if (s.day !== today) {
        s.day = today; s.bytesSentToday = 0; s.bytesReceivedToday = 0; s.pushesToday = 0; s.pullsToday = 0;
      }
      s.bytesSentToday += bytesSent;
      s.bytesReceivedToday += bytesReceived;
      s.bytesSentTotal += bytesSent;
      s.bytesReceivedTotal += bytesReceived;
      if (kind === 'push') { s.pushesToday += 1; s.pushesTotal += 1; }
      if (kind === 'pull') { s.pullsToday += 1; s.pullsTotal += 1; }
      await this._writeShared(this.SHARED_STATS_KEY, s);
      return s;
    },

    _rpc(creds, fnName, bodyObj, trafficKind, { keepalive = false } = {}) {
      const endpoint = `${creds.url}/rest/v1/rpc/${fnName}`;
      const bodyStr = JSON.stringify(bodyObj);
      const bytesSent = new TextEncoder().encode(bodyStr).length;
      const headers = {
        'apikey': creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      const doFetch = async () => {
        const opts = { method: 'POST', headers, body: bodyStr };
        if (keepalive && bytesSent < 60000) opts.keepalive = true;
        const res = await fetch(endpoint, opts);
        const text = await res.text();
        const bytesReceived = new TextEncoder().encode(text).length;
        await this._recordTraffic(trafficKind, bytesSent, bytesReceived);
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { const j = JSON.parse(text); if (j && j.message) msg = `${res.status}: ${j.message}`; } catch (e) {}
          throw new Error(msg);
        }
        return text ? JSON.parse(text) : {};
      };

      // Prefer GM_xmlhttpRequest whenever available: it runs in the extension background context
      // (bypasses strict page connect-src CSP and completes even if the tab is hiding/closing).
      if (typeof GM_xmlhttpRequest !== 'function') {
        return doFetch();
      }

      return new Promise((resolve, reject) => {
        let done = false;
        try {
          GM_xmlhttpRequest({
            method: 'POST',
            url: endpoint,
            headers,
            data: bodyStr,
            timeout: 12000,
            onload: async (res) => {
              if (done) return;
              done = true;
              const text = res.responseText || '';
              const bytesReceived = new TextEncoder().encode(text).length;
              await this._recordTraffic(trafficKind, bytesSent, bytesReceived);
              if (res.status >= 200 && res.status < 300) {
                try { resolve(text ? JSON.parse(text) : {}); } catch (e) { resolve({}); }
              } else {
                let msg = `HTTP ${res.status}`;
                try { const j = JSON.parse(text); if (j && j.message) msg = `${res.status}: ${j.message}`; } catch (e) {}
                reject(new Error(msg));
              }
            },
            onerror: () => {
              if (done) return;
              done = true;
              // Fallback to native fetch (Supabase PostgREST supports CORS *).
              doFetch().then(resolve, reject);
            },
            ontimeout: () => {
              if (done) return;
              done = true;
              reject(new Error('Request timed out'));
            }
          });
        } catch (e) {
          if (!done) {
            done = true;
            doFetch().then(resolve, reject);
          }
        }
      });
    },

    _normalizeTabUrl(rawUrl) {
      if (!rawUrl || typeof rawUrl !== 'string') return '';
      try {
        const u = new URL(rawUrl.trim());
        const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '/';
        return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
      } catch (e) {
        return String(rawUrl).trim().replace(/\/+$/, '');
      }
    },

    _dedupTabs(list, now = Date.now()) {
      const cutoff = now - 24 * 60 * 60 * 1000;
      const valid = (Array.isArray(list) ? list : [])
        .filter(t => t && t.url && Date.parse(t.lastActiveAt || 0) >= cutoff)
        .sort((a, b) => Date.parse(b.lastActiveAt || 0) - Date.parse(a.lastActiveAt || 0));
      const seenUrls = new Set();
      const seenIds = new Set();
      const out = [];
      for (let i = 0; i < valid.length; i++) {
        const t = valid[i];
        const norm = this._normalizeTabUrl(t.url);
        if (!norm || seenUrls.has(norm)) continue;
        if (t.id && seenIds.has(t.id)) continue;
        seenUrls.add(norm);
        if (t.id) seenIds.add(t.id);
        out.push(t);
        if (out.length >= 50) break;
      }
      return out;
    },

    debugStatus() {
      let tabsN = this._lastTabCount;
      let closedN = this._lastClosedCount;
      if (typeof GM_getValue === 'function') {
        try {
          const t = GM_getValue('shared_' + this.SHARED_TABS_KEY, null);
          const c = GM_getValue('shared_' + this.SHARED_CLOSED_KEY, null);
          if (Array.isArray(t)) tabsN = t.length;
          if (Array.isArray(c)) closedN = c.length;
        } catch (e) {}
      }
      return `bs=tabs:${tabsN},closed:${closedN}`;
    },

    async _updateActiveTabRecord(clean, title, remove = false, { activeOverride = null } = {}) {
      const tabId = this._getTabId();
      const now = Date.now();
      const normUrl = clean ? this._normalizeTabUrl(clean.url) : '';
      const list = (await this._readShared(this.SHARED_TABS_KEY, [])) || [];
      const isActive = activeOverride !== null ? Boolean(activeOverride) : (document.visibilityState === 'visible');

      const filtered = this._dedupTabs(list, now)
        .filter(t => t.id !== tabId && (!normUrl || this._normalizeTabUrl(t.url) !== normUrl))
        .map(t => (isActive && !remove && t.active) ? { ...t, active: false } : t);

      if (!remove && clean) {
        filtered.unshift({
          id: tabId,
          url: clean.url,
          title: this._cleanTitle(title || clean.host),
          groupId: '',
          windowId: '',
          active: isActive,
          pinned: false,
          lastActiveAt: new Date(now).toISOString()
        });
        this._lastTabRefreshTs = now;
      }
      const next = filtered.slice(0, 50);
      this._lastTabCount = next.length;
      await this._writeShared(this.SHARED_TABS_KEY, next);
      return next;
    },

    async _recordCurrentVisit({ forcePush = false } = {}) {
      if (!this._active || this.isExtensionMode()) return;
      const cfg = this._config || {};
      const cloud = this._getCloudConfig();
      const creds = this.parseSyncLink(cloud.syncLink);
      if (!creds) return;

      const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(cfg));
      if (!clean) return;
      const title = this._cleanTitle(document.title || clean.host);
      this._lastUrl = clean.url;

      await this._updateActiveTabRecord(clean, title, false);

      // Client-side 60s dedup so refreshes/SPA jitter never bloat history.
      const now = Date.now();
      const dedup = (await this._readShared(this.SHARED_DEDUP_KEY, {})) || {};
      const prevTs = Number(dedup[clean.url]) || 0;
      let queuedVisit = false;

      if (now - prevTs >= 60000) {
        dedup[clean.url] = now;
        // Trim dedup map so GM storage stays tiny.
        const keys = Object.keys(dedup);
        if (keys.length > 150) {
          for (let i = 0; i < keys.length; i++) {
            if (now - Number(dedup[keys[i]]) > 180000) delete dedup[keys[i]];
          }
        }
        await this._writeShared(this.SHARED_DEDUP_KEY, dedup);

        const pending = (await this._readShared(this.SHARED_PENDING_KEY, null)) || { history: [], usage: {} };
        if (!Array.isArray(pending.history)) pending.history = [];
        if (!pending.usage || typeof pending.usage !== 'object') pending.usage = {};

        pending.history.push({
          url: clean.url,
          host: clean.host,
          title,
          visitedAt: new Date(now).toISOString()
        });
        if (pending.history.length > 100) pending.history = pending.history.slice(-100);

        const uKey = `${this._todayStr()}|${clean.host}`;
        if (!pending.usage[uKey]) pending.usage[uKey] = { day: this._todayStr(), host: clean.host, seconds: 0, visits: 0 };
        pending.usage[uKey].visits += 1;

        await this._writeShared(this.SHARED_PENDING_KEY, pending);
        queuedVisit = true;
      }

      if ((queuedVisit && cfg.pushEveryVisit !== false) || forcePush) {
        await this._userscriptPush({ includeTabs: true });
      }
    },

    async _commitUsageSegment() {
      if (!this._activeSegmentStart || this.isExtensionMode()) return;
      const now = Date.now();
      const start = this._activeSegmentStart;
      this._activeSegmentStart = (document.visibilityState === 'visible') ? now : 0;

      // Only count time if user interacted recently (within 65s).
      const activeEnd = Math.min(now, (this._lastActivityTs || now) + 65000);
      const elapsedSec = Math.round((activeEnd - start) / 1000);
      if (elapsedSec < 2 || elapsedSec > 3600) return;

      const cfg = this._config || {};
      const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(cfg));
      if (!clean) return;

      const pending = (await this._readShared(this.SHARED_PENDING_KEY, null)) || { history: [], usage: {} };
      if (!Array.isArray(pending.history)) pending.history = [];
      if (!pending.usage || typeof pending.usage !== 'object') pending.usage = {};

      const uKey = `${this._todayStr()}|${clean.host}`;
      if (!pending.usage[uKey]) pending.usage[uKey] = { day: this._todayStr(), host: clean.host, seconds: 0, visits: 0 };
      pending.usage[uKey].seconds = Math.min(3600, pending.usage[uKey].seconds + elapsedSec);
      await this._writeShared(this.SHARED_PENDING_KEY, pending);
    },

    async _userscriptPush({ includeTabs = true, keepalive = false, force = false } = {}) {
      if (this._pushInFlight && !keepalive) return { ok: true, busy: true };
      const cfg = this._config || {};
      const cloud = this._getCloudConfig();
      const creds = this.parseSyncLink(cloud.syncLink);
      if (!creds) return { ok: false, skipped: true };

      this._pushInFlight = true;
      try {
        await this._commitUsageSegment();
        const meta = await this._ensureMeta();
        const pending = (await this._readShared(this.SHARED_PENDING_KEY, null)) || { history: [], usage: {} };
        const histBatch = Array.isArray(pending.history) ? pending.history.slice(0, 100) : [];
        const usageBatch = pending.usage
          ? Object.values(pending.usage).filter(u => u && (u.seconds > 0 || u.visits > 0)).slice(0, 100)
          : [];
        const rawTabs = includeTabs ? ((await this._readShared(this.SHARED_TABS_KEY, [])) || []) : null;
        const tabs = includeTabs ? this._dedupTabs(rawTabs) : null;
        if (includeTabs && Array.isArray(rawTabs) && tabs.length !== rawTabs.length) {
          await this._writeShared(this.SHARED_TABS_KEY, tabs);
        }
        const closed = includeTabs ? ((await this._readShared(this.SHARED_CLOSED_KEY, [])) || []) : null;
        if (includeTabs) {
          this._lastTabCount = tabs.length;
          this._lastClosedCount = Array.isArray(closed) ? closed.length : 0;
        }

        if (!force && !includeTabs && histBatch.length === 0 && usageBatch.length === 0) {
          return { ok: true, skipped: true };
        }

        const payload = {
          instance_id: meta.instanceId,
          device_name: cloud.deviceName,
          browser: this.detectBrowser(),
          platform: this.detectPlatform(),
          mode: 'userscript',
          account_label: cloud.accountLabel
        };
        if (includeTabs) {
          payload.tabs = (tabs || []).slice(0, 50);
          payload.closed = (closed || []).slice(0, 25);
        }
        if (histBatch.length > 0) payload.history = histBatch;
        if (usageBatch.length > 0) payload.usage = usageBatch;

        const res = await this._rpc(creds, 'besing_sync_push', {
          p_secret: creds.secret,
          p_payload: payload
        }, 'push', { keepalive });

        // Drain flushed items from pending queue.
        const latest = (await this._readShared(this.SHARED_PENDING_KEY, null)) || { history: [], usage: {} };
        latest.history = (Array.isArray(latest.history) ? latest.history : []).slice(histBatch.length);
        if (latest.usage && typeof latest.usage === 'object') {
          for (let i = 0; i < usageBatch.length; i++) {
            const u = usageBatch[i];
            const k = `${u.day}|${u.host}`;
            if (latest.usage[k]) {
              latest.usage[k].seconds = Math.max(0, latest.usage[k].seconds - u.seconds);
              latest.usage[k].visits = Math.max(0, latest.usage[k].visits - u.visits);
              if (latest.usage[k].seconds === 0 && latest.usage[k].visits === 0) delete latest.usage[k];
            }
          }
        }
        await this._writeShared(this.SHARED_PENDING_KEY, latest);

        const cache = await this._getCache();
        cache.lastPushAt = Date.now();
        cache.lastError = null;
        if (res && res.retention_days) cache.retentionDays = res.retention_days;
        await this._writeShared(this.SHARED_CACHE_KEY, cache);
        return { ok: true, res };
      } catch (err) {
        const cache = await this._getCache();
        cache.lastError = `Push failed: ${err.message || err}`;
        await this._writeShared(this.SHARED_CACHE_KEY, cache);
        return { ok: false, error: err.message || String(err) };
      } finally {
        this._pushInFlight = false;
      }
    },

    async _userscriptPull({ full = false, force = false } = {}) {
      if (this._pullInFlight) return { ok: true, busy: true };
      const cfg = this._config || {};
      const cloud = this._getCloudConfig();
      const creds = this.parseSyncLink(cloud.syncLink);
      if (!creds) return { ok: false, skipped: true };

      const cache = await this._getCache();
      const now = Date.now();
      const intervalMs = Math.max(2, Math.min(120, Number(cfg.pullIntervalMinutes) || 10)) * 60 * 1000;

      if (!force) {
        if (now - cache.lastPullAt < intervalMs) return { ok: true, skipped: true, cache };
        if (cache.pullLockUntil && now < cache.pullLockUntil) return { ok: true, skipped: true, cache };
      }

      // Cross-tab lock so opening multiple tabs at once only pulls once.
      cache.pullLockUntil = now + 20000;
      await this._writeShared(this.SHARED_CACHE_KEY, cache);

      this._pullInFlight = true;
      try {
        const deviceHashes = {};
        if (!full) {
          for (let i = 0; i < cache.devices.length; i++) {
            const d = cache.devices[i];
            if (d && d.instance_id && d.snapshot_hash) deviceHashes[d.instance_id] = d.snapshot_hash;
          }
        }

        const res = await this._rpc(creds, 'besing_sync_pull', {
          p_secret: creds.secret,
          p_since: full ? null : cache.lastServerTime,
          p_device_hashes: deviceHashes,
          p_history_limit: full ? 250 : 150
        }, 'pull');

        const prevMap = new Map(cache.devices.map(d => [d.instance_id, d]));
        const mergedDevices = [];
        for (const d of (res.devices || [])) {
          if (d.unchanged && prevMap.has(d.instance_id)) {
            const prev = prevMap.get(d.instance_id);
            mergedDevices.push({
              ...prev,
              device_name: d.device_name,
              browser: d.browser,
              platform: d.platform,
              mode: d.mode,
              account_label: d.account_label,
              snapshot_hash: d.snapshot_hash,
              updated_at: d.updated_at
            });
          } else {
            mergedDevices.push({
              instance_id: d.instance_id,
              device_name: d.device_name,
              browser: d.browser,
              platform: d.platform,
              mode: d.mode,
              account_label: d.account_label,
              tabs: Array.isArray(d.tabs) ? d.tabs : [],
              groups: Array.isArray(d.groups) ? d.groups : [],
              closed: Array.isArray(d.closed) ? d.closed : [],
              snapshot_hash: d.snapshot_hash || '',
              updated_at: d.updated_at
            });
          }
        }

        const retentionDays = Number(res.retention_days) || Number(cfg.retentionDays) || 7;
        const cutoffMs = Date.now() - retentionDays * 86400 * 1000;
        const cutoffDay = new Date(cutoffMs).toISOString().slice(0, 10);

        const histMap = new Map();
        const baseHist = full ? [] : cache.history;
        for (const h of [...(res.history || []), ...baseHist]) {
          if (!h || !h.url) continue;
          const t = Date.parse(h.visitedAt || '');
          if (Number.isFinite(t) && t < cutoffMs) continue;
          const k = h.id ? `id:${h.id}` : `${h.instance_id}|${h.url}|${Math.floor((t || 0) / 300000)}`;
          if (!histMap.has(k)) histMap.set(k, h);
        }
        const mergedHistory = Array.from(histMap.values())
          .sort((a, b) => Date.parse(b.visitedAt || 0) - Date.parse(a.visitedAt || 0))
          .slice(0, 600);

        const usageMap = new Map();
        const baseUsage = full ? [] : cache.usage;
        for (const u of baseUsage) {
          if (u && u.host && u.day >= cutoffDay) usageMap.set(`${u.instance_id}|${u.day}|${u.host}`, u);
        }
        for (const u of (res.usage || [])) {
          if (u && u.host && u.day >= cutoffDay) usageMap.set(`${u.instance_id}|${u.day}|${u.host}`, u);
        }

        const nextCache = {
          devices: mergedDevices,
          history: mergedHistory,
          usage: Array.from(usageMap.values()),
          lastServerTime: res.server_time || new Date().toISOString(),
          lastPullAt: Date.now(),
          lastPushAt: cache.lastPushAt,
          pullLockUntil: 0,
          lastError: null,
          retentionDays
        };
        await this._writeShared(this.SHARED_CACHE_KEY, nextCache);
        return { ok: true, cache: nextCache };
      } catch (err) {
        const cur = await this._getCache();
        cur.pullLockUntil = 0;
        cur.lastError = `Pull failed: ${err.message || err}`;
        await this._writeShared(this.SHARED_CACHE_KEY, cur);
        return { ok: false, error: err.message || String(err) };
      } finally {
        this._pullInFlight = false;
      }
    },

    // -----------------------------------------------------------------------
    // Public API for BESing Manager UI (works in both Extension & Userscript mode)
    // -----------------------------------------------------------------------

    async getState() {
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:get-state' });
      }
      const cloud = this._getCloudConfig();
      const meta = await this._ensureMeta();
      const cache = await this._getCache();
      const stats = await this._readShared(this.SHARED_STATS_KEY, null);
      return {
        ok: true,
        mode: 'userscript',
        instanceId: meta.instanceId,
        detectedEmail: '',
        browser: this.detectBrowser(),
        platform: this.detectPlatform(),
        configured: Boolean(this.parseSyncLink(cloud.syncLink)),
        enabled: this._active,
        cache,
        stats
      };
    },

    async syncNow(full = false) {
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:sync-now', full });
      }
      if (!this._active) {
        return { ok: false, error: 'Sync History is OFF. Turn it ON to sync.', cache: await this._getCache(), stats: await this._readShared(this.SHARED_STATS_KEY, null) };
      }
      if (!this.parseSyncLink(this._getCloudConfig().syncLink)) {
        return { ok: false, error: 'Cloud DB not linked. Paste Sync Link in Settings.', cache: await this._getCache(), stats: await this._readShared(this.SHARED_STATS_KEY, null) };
      }
      const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(this._config || {}));
      if (clean) {
        await this._updateActiveTabRecord(clean, document.title || clean.host, false);
      }
      const pushRes = await this._userscriptPush({ includeTabs: true, force: true });
      const pullRes = await this._userscriptPull({ full, force: true });
      const stats = await this._readShared(this.SHARED_STATS_KEY, null);
      return {
        ok: Boolean(pullRes.ok),
        error: (pullRes && pullRes.error) || (pushRes && pushRes.error) || null,
        cache: (pullRes && pullRes.cache) || await this._getCache(),
        stats
      };
    },

    async testConnection(syncLink) {
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:test-connection', syncLink });
      }
      const creds = this.parseSyncLink(syncLink);
      if (!creds) {
        return { ok: false, error: 'Invalid Sync Link format (must be besing-sync://... with HTTPS URL, API key, and secret >= 16 chars).' };
      }
      const t0 = Date.now();
      try {
        const res = await this._rpc(creds, 'besing_sync_pull', {
          p_secret: creds.secret,
          p_since: null,
          p_device_hashes: {},
          p_history_limit: 5
        }, 'pull');
        return {
          ok: true,
          latencyMs: Date.now() - t0,
          deviceCount: Array.isArray(res.devices) ? res.devices.length : 0,
          retentionDays: res.retention_days || 7
        };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },

    async openTab(url) {
      const clean = this.sanitizeUrl(url, []);
      if (!clean) return { ok: false, error: 'Invalid URL' };
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:open-tab', url: clean.url, active: true });
      }
      try {
        window.open(clean.url, '_blank', 'noopener,noreferrer');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async openGroup(title, color, urls) {
      const cleanUrls = (Array.isArray(urls) ? urls : [])
        .map(u => this.sanitizeUrl(u, []))
        .filter(Boolean)
        .map(x => x.url)
        .slice(0, 30);
      if (cleanUrls.length === 0) return { ok: false, error: 'No valid URLs' };
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:open-group', title, color, urls: cleanUrls });
      }
      // In userscript/Safari mode, attempt to open up to 10 tabs in the same click gesture.
      let opened = 0;
      const batch = cleanUrls.slice(0, 10);
      for (let i = 0; i < batch.length; i++) {
        try {
          const w = window.open(batch[i], '_blank', 'noopener,noreferrer');
          if (w) opened++;
        } catch (e) {}
      }
      if (opened === 0) {
        try { window.open(batch[0], '_blank', 'noopener,noreferrer'); opened = 1; } catch (e) {}
      }
      return { ok: true, opened, total: cleanUrls.length, userscriptPopupNote: opened < cleanUrls.length };
    },

    async deleteDevice(instanceId) {
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:delete-device', instanceId });
      }
      const creds = this.parseSyncLink(this._getCloudConfig().syncLink);
      if (!creds) return { ok: false, error: 'Not configured' };
      try {
        await this._rpc(creds, 'besing_sync_delete_device', {
          p_secret: creds.secret,
          p_instance_id: String(instanceId || '')
        }, 'push');
        const pullRes = await this._userscriptPull({ full: true, force: true });
        return { ok: true, cache: pullRes.cache || await this._getCache() };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },

    async setRetentionDays(days) {
      const d = Math.max(1, Math.min(90, Number(days) || 7));
      if (this.isExtensionMode()) {
        return await this._sendExt({ type: 'besing-sync:set-retention', days: d });
      }
      const creds = this.parseSyncLink(this._getCloudConfig().syncLink);
      if (!creds) return { ok: false, error: 'Not configured' };
      try {
        const res = await this._rpc(creds, 'besing_sync_set_retention', {
          p_secret: creds.secret,
          p_retention_days: d
        }, 'push');
        const pullRes = await this._userscriptPull({ full: true, force: true });
        return { ok: true, pruned: res.pruned || 0, retentionDays: res.retention_days || d, cache: pullRes.cache || await this._getCache() };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },

    // -----------------------------------------------------------------------
    // Lifecycle: init, onConfigChange, destroy
    // -----------------------------------------------------------------------

    init(config = {}) {
      this.destroy();
      this._config = config || {};
      this._active = true;

      // Extension mode delegates background syncing to background.js so tabs do not duplicate traffic.
      if (this.isExtensionMode()) return;

      this._lastActivityTs = Date.now();
      this._activeSegmentStart = (document.visibilityState === 'visible') ? Date.now() : 0;

      // Record initial visit once page title has settled, and pull if >= interval has elapsed.
      this._visitDelayTimer = setTimeout(async () => {
        if (!this._active) return;
        await this._recordCurrentVisit();
        await this._userscriptPull({ full: false, force: false });
      }, 1200);

      // Track user activity for accurate foreground usage time (ignores AFK open tabs).
      this._boundActivity = () => {
        this._lastActivityTs = Date.now();
      };
      ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => {
        window.addEventListener(ev, this._boundActivity, { passive: true });
      });

      // Visibility change: flush usage + mark inactive when hiding; refresh active tab + check pull when returning.
      this._boundVisibility = async () => {
        if (!this._active) return;
        const cfg = this._config || {};
        const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(cfg));
        if (document.visibilityState === 'hidden') {
          // Do not race with or overwrite a pagehide/close removal that just ran.
          if (Date.now() - this._pageHidingAt < 2000) return;
          if (clean) {
            await this._updateActiveTabRecord(clean, document.title || clean.host, false, { activeOverride: false });
          }
          await this._userscriptPush({ includeTabs: true, keepalive: true });
        } else {
          this._pageHidingAt = 0;
          this._lastActivityTs = Date.now();
          this._activeSegmentStart = Date.now();
          if (clean) {
            await this._updateActiveTabRecord(clean, document.title || clean.host, false, { activeOverride: true });
          }
          await this._userscriptPull({ full: false, force: false });
        }
      };
      document.addEventListener('visibilitychange', this._boundVisibility);

      // Best-effort flush on tab close / page exit: synchronously remove this tab from open list
      // (matching by tabId OR canonical URL), append to recently closed, and dispatch a push via
      // GM_xmlhttpRequest (bypasses strict page CSP & survives tab unload) with keepalive fetch fallback.
      const handlePageExit = () => {
        if (!this._active) return;
        const now = Date.now();
        if (now - this._pageHidingAt < 1500) return;
        this._pageHidingAt = now;
        if (this._visitDelayTimer) {
          clearTimeout(this._visitDelayTimer);
          this._visitDelayTimer = null;
        }

        const tabId = this._getTabId();
        const cfg = this._config || {};
        const cloud = this._getCloudConfig();
        const creds = this.parseSyncLink(cloud.syncLink);
        const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(cfg));
        const normUrl = clean ? this._normalizeTabUrl(clean.url) : '';

        const dispatchClosePush = (meta, nextTabs, nextClosed) => {
          if (!creds || !meta || !meta.instanceId) return;
          const endpoint = `${creds.url}/rest/v1/rpc/besing_sync_push`;
          const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'apikey': creds.key,
            'Authorization': `Bearer ${creds.key}`
          };
          const payload = {
            instance_id: meta.instanceId,
            device_name: cloud.deviceName,
            browser: this.detectBrowser(),
            platform: this.detectPlatform(),
            mode: 'userscript',
            account_label: cloud.accountLabel,
            tabs: nextTabs,
            closed: nextClosed
          };
          const bodyStr = JSON.stringify({ p_secret: creds.secret, p_payload: payload });
          const sendKeepaliveFetch = () => {
            if (typeof fetch !== 'function') return;
            try {
              const opts = { method: 'POST', headers, body: bodyStr };
              if (bodyStr.length < 60000) opts.keepalive = true;
              fetch(endpoint, opts).catch(() => {});
            } catch (e) {}
          };
          if (typeof GM_xmlhttpRequest === 'function') {
            try {
              GM_xmlhttpRequest({
                method: 'POST',
                url: endpoint,
                headers,
                data: bodyStr,
                timeout: 8000,
                onerror: sendKeepaliveFetch
              });
              return;
            } catch (e) {}
          }
          sendKeepaliveFetch();
        };

        const hasSyncGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
        if (hasSyncGM) {
          try {
            const tabsKey = 'shared_' + this.SHARED_TABS_KEY;
            const closedKey = 'shared_' + this.SHARED_CLOSED_KEY;
            const metaKey = 'shared_' + this.SHARED_META_KEY;
            const curTabs = GM_getValue(tabsKey, []);
            const curClosed = GM_getValue(closedKey, []);
            const meta = GM_getValue(metaKey, null);
            const isAsyncShim = (curTabs && typeof curTabs.then === 'function')
              || (curClosed && typeof curClosed.then === 'function')
              || (meta && typeof meta.then === 'function');
            if (!isAsyncShim) {
              const nextTabs = this._dedupTabs(curTabs || [], now)
                .filter(t => t.id !== tabId && (!normUrl || this._normalizeTabUrl(t.url) !== normUrl))
                .slice(0, 50);
              GM_setValue(tabsKey, nextTabs);

              let nextClosed = (Array.isArray(curClosed) ? curClosed : [])
                .filter(c => c && (!normUrl || this._normalizeTabUrl(c.url) !== normUrl));
              if (clean) {
                nextClosed.unshift({
                  url: clean.url,
                  title: this._cleanTitle(document.title || clean.host),
                  closedAt: new Date(now).toISOString()
                });
              }
              nextClosed = nextClosed.slice(0, 25);
              GM_setValue(closedKey, nextClosed);
              this._lastTabCount = nextTabs.length;
              this._lastClosedCount = nextClosed.length;

              dispatchClosePush(meta, nextTabs, nextClosed);
              return;
            }
          } catch (e) {}
        }

        // Async fallback when synchronous GM_* is unavailable
        (async () => {
          const nextTabs = await this._updateActiveTabRecord(clean, document.title || '', true);
          let nextClosed = (await this._readShared(this.SHARED_CLOSED_KEY, [])) || [];
          if (clean) {
            nextClosed = [
              { url: clean.url, title: this._cleanTitle(document.title || clean.host), closedAt: new Date(now).toISOString() },
              ...nextClosed.filter(c => c && (!normUrl || this._normalizeTabUrl(c.url) !== normUrl))
            ].slice(0, 25);
            await this._writeShared(this.SHARED_CLOSED_KEY, nextClosed);
          }
          this._lastClosedCount = nextClosed.length;
          const meta = await this._ensureMeta();
          dispatchClosePush(meta, nextTabs, nextClosed);
        })().catch(() => {});
      };
      this._boundPageHide = handlePageExit;
      this._boundBeforeUnload = handlePageExit;
      window.addEventListener('pagehide', this._boundPageHide);
      window.addEventListener('beforeunload', this._boundBeforeUnload);

      // Restore tab into open list if Safari/Mobile Edge brings it back from back/forward cache (bfcache).
      this._boundPageShow = async (e) => {
        if (!this._active) return;
        if (!(e && e.persisted) && !this._pageHidingAt) return;
        this._pageHidingAt = 0;
        const cfg = this._config || {};
        const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(cfg));
        if (!clean) return;
        const normUrl = this._normalizeTabUrl(clean.url);
        await this._updateActiveTabRecord(clean, document.title || clean.host, false, { activeOverride: true });
        const curClosed = (await this._readShared(this.SHARED_CLOSED_KEY, [])) || [];
        const filteredClosed = (Array.isArray(curClosed) ? curClosed : [])
          .filter(c => c && this._normalizeTabUrl(c.url) !== normUrl);
        if (filteredClosed.length !== curClosed.length) {
          await this._writeShared(this.SHARED_CLOSED_KEY, filteredClosed);
          this._lastClosedCount = filteredClosed.length;
        }
        await this._userscriptPush({ includeTabs: true });
      };
      window.addEventListener('pageshow', this._boundPageShow);

      // SPA route change detection (popstate, hashchange, history.pushState).
      this._boundRouteChange = () => {
        if (!this._active) return;
        if (window.location.href !== this._lastUrl) {
          setTimeout(() => {
            if (this._active) this._recordCurrentVisit();
          }, 500);
        }
      };
      window.addEventListener('popstate', this._boundRouteChange);
      window.addEventListener('hashchange', this._boundRouteChange);

      try {
        if (window.history && typeof window.history.pushState === 'function') {
          this._origPushState = window.history.pushState;
          const self = this;
          window.history.pushState = function (...args) {
            const ret = self._origPushState.apply(this, args);
            self._boundRouteChange();
            return ret;
          };
        }
      } catch (e) {}

      // Periodic 60s tick: commit usage, keep active tab fresh, and check whether 10-minute auto-pull is due.
      this._usageTimer = setInterval(async () => {
        if (!this._active || document.visibilityState !== 'visible') return;
        await this._commitUsageSegment();
        const now = Date.now();
        if (now - this._lastTabRefreshTs >= 5 * 60 * 1000) {
          const clean = this.sanitizeUrl(window.location.href, this._parseExcludeHosts(this._config || {}));
          if (clean) await this._updateActiveTabRecord(clean, document.title || clean.host, false, { activeOverride: true });
        }
        const pending = await this._readShared(this.SHARED_PENDING_KEY, null);
        const hasPendingUsage = pending && pending.usage && Object.values(pending.usage).some(u => u && u.seconds >= 30);
        if (hasPendingUsage || (pending && Array.isArray(pending.history) && pending.history.length > 0)) {
          await this._userscriptPush({ includeTabs: false });
        }
        await this._userscriptPull({ full: false, force: false });
      }, 60000);
    },

    onConfigChange(newConfig) {
      const prevLink = (this._config && this._config.syncLink) || '';
      const nextLink = (newConfig && newConfig.syncLink) || '';
      this._config = newConfig || {};
      if (!this._active || this.isExtensionMode()) return;
      if (nextLink && nextLink !== prevLink) {
        this._userscriptPull({ full: true, force: true }).catch(() => {});
      }
    },

    destroy() {
      this._active = false;
      this._pageHidingAt = 0;
      if (this._visitDelayTimer) { clearTimeout(this._visitDelayTimer); this._visitDelayTimer = null; }
      if (this._usageTimer) { clearInterval(this._usageTimer); this._usageTimer = null; }
      if (this._pullCheckTimer) { clearInterval(this._pullCheckTimer); this._pullCheckTimer = null; }
      if (this._boundVisibility) {
        document.removeEventListener('visibilitychange', this._boundVisibility);
        this._boundVisibility = null;
      }
      if (this._boundPageHide) {
        window.removeEventListener('pagehide', this._boundPageHide);
        this._boundPageHide = null;
      }
      if (this._boundBeforeUnload) {
        window.removeEventListener('beforeunload', this._boundBeforeUnload);
        this._boundBeforeUnload = null;
      }
      if (this._boundPageShow) {
        window.removeEventListener('pageshow', this._boundPageShow);
        this._boundPageShow = null;
      }
      if (this._boundActivity) {
        ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => {
          window.removeEventListener(ev, this._boundActivity);
        });
        this._boundActivity = null;
      }
      if (this._boundRouteChange) {
        window.removeEventListener('popstate', this._boundRouteChange);
        window.removeEventListener('hashchange', this._boundRouteChange);
        this._boundRouteChange = null;
      }
      if (this._origPushState) {
        try { window.history.pushState = this._origPushState; } catch (e) {}
        this._origPushState = null;
      }
    }
  };

  if (typeof window !== 'undefined' && window.__BESING_REGISTER__) {
    window.__BESING_REGISTER__(BrowserSync);
  }
})();
