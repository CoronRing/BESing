/**
 * BESing - Manifest V3 Background Service Worker (Browser Sync)
 *
 * Collects native Chromium/Edge state (open tabs, tab groups, recently closed tabs,
 * browsing history, active usage time, and signed-in profile email) and syncs delta
 * payloads to the user's configured Supabase RPC endpoint.
 *
 * Security & privacy invariants:
 * - Zero hardcoded URLs, keys, or secrets.
 * - Never reads page DOM, cookies, or form inputs.
 * - Skips incognito/private tabs, internal browser URLs, and excluded domains.
 * - Strips credentials, hashes, tracking params, and sensitive auth query params.
 */

const STORAGE_CACHE_KEY = 'shared_browser_sync_cache';
const STORAGE_STATS_KEY = 'shared_browser_sync_stats';
const STORAGE_META_KEY = 'shared_browser_sync_meta';
const STORAGE_PENDING_KEY = 'shared_browser_sync_pending';
const ALARM_PULL = 'besing-sync-pull';
const ALARM_FLUSH = 'besing-sync-flush';

const SENSITIVE_PARAMS = new Set([
  'token', 'access_token', 'id_token', 'refresh_token', 'auth', 'auth_token',
  'key', 'apikey', 'api_key', 'secret', 'password', 'passwd', 'pwd',
  'session', 'sessionid', 'session_id', 'sid', 'code', 'state', 'sig',
  'signature', 'jwt', 'bearer', 'oauth', 'nonce', 'csrf', 'xsrf',
  'credential', 'credentials', 'private_key', 'client_secret'
]);

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'ref_src', 'ref_url', 'igshid', 'sxsrf', 'ved', 'ei'
]);

let tabMemory = new Map(); // tabId -> { url, title }
let recentClosed = []; // [{ url, title, closedAt }]
let recentUrlDedup = new Map(); // sanitizedUrl -> timestampMs
let importedUrls = new Set(); // URLs we injected into chrome.history to avoid echo loops
let activeSession = null; // { tabId, host, startedAt }
let isIdle = false;
let detectedEmail = '';
let lastSnapshotHash = '';
let snapshotTimer = null;
let visitTimer = null;
let syncingNow = false;

// ---------------------------------------------------------------------------
// Helpers: Sync Link, URL Sanitizer, Hashing, Platform Detection
// ---------------------------------------------------------------------------

function base64UrlDecode(str) {
  let b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function parseSyncLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    let payloadStr = s;
    if (s.startsWith('besing-sync://')) {
      payloadStr = base64UrlDecode(s.slice('besing-sync://'.length));
    } else if (s.startsWith('{')) {
      payloadStr = s;
    } else {
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
}

function parseExcludeHosts(cfg) {
  const raw = (cfg && typeof cfg.excludeHosts === 'string') ? cfg.excludeHosts : '';
  return raw
    .split(/[\s,;]+/)
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

function isHostExcluded(host, excludeList) {
  if (!host) return true;
  const h = host.toLowerCase();
  for (let i = 0; i < excludeList.length; i++) {
    const rule = excludeList[i];
    if (h === rule || h.endsWith('.' + rule)) return true;
  }
  return false;
}

function sanitizeUrl(rawUrl, excludeList = []) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || isHostExcluded(host, excludeList)) return null;

  // Strip embedded credentials and URL fragment (often holds OAuth #access_token).
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';

  // Strip sensitive auth params and ad/tracking params.
  const toDelete = [];
  parsed.searchParams.forEach((_, key) => {
    const k = key.toLowerCase();
    if (SENSITIVE_PARAMS.has(k) || TRACKING_PARAMS.has(k) || k.startsWith('utm_')) {
      toDelete.push(key);
    }
  });
  for (let i = 0; i < toDelete.length; i++) {
    parsed.searchParams.delete(toDelete[i]);
  }

  let clean = parsed.toString();
  if (clean.length > 500) clean = clean.slice(0, 500);
  return { url: clean, host: host.slice(0, 160) };
}

const SENSITIVE_TITLE_RE = new RegExp(
  '([?&])(' + Array.from(SENSITIVE_PARAMS).join('|') + ')=[^&\\s#]+',
  'gi'
);

function cleanTitle(rawTitle) {
  let s = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (/^https?:\/\//i.test(s)) {
    const cleaned = sanitizeUrl(s, []);
    s = cleaned ? cleaned.url : '';
  }
  s = s.replace(SENSITIVE_TITLE_RE, '$1$2=[redacted]');
  return s.slice(0, 200);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function detectBrowser() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\//i.test(ua)) return 'opera';
  if (/Brave/i.test(ua)) return 'brave';
  if (/Chrome\//i.test(ua)) return 'chrome';
  if (/Firefox\//i.test(ua)) return 'firefox';
  return 'chromium';
}

function detectPlatform() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'desktop';
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateInstanceId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'ext-' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (res) => {
      resolve(chrome.runtime.lastError ? {} : (res || {}));
    });
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

async function getConfig() {
  const res = await storageGet(['enabled_scripts', 'script_configs', 'global_settings', STORAGE_META_KEY]);
  const enabledMap = res.enabled_scripts || {};
  const configsMap = res.script_configs || {};
  const globalSettings = res.global_settings || {};
  const cloudCfg = (globalSettings && globalSettings.cloudSync && typeof globalSettings.cloudSync === 'object')
    ? globalSettings.cloudSync
    : {};
  const cfg = configsMap['browser-sync'] || {};
  let meta = res[STORAGE_META_KEY] || {};
  if (!meta.instanceId) {
    meta = {
      instanceId: generateInstanceId(),
      createdAt: Date.now()
    };
    await storageSet({ [STORAGE_META_KEY]: meta });
  }
  const enabled = enabledMap['browser-sync'] === true;
  const rawSyncLink = (cloudCfg.syncLink && String(cloudCfg.syncLink).trim()) || (cfg.syncLink && String(cfg.syncLink).trim()) || '';
  const creds = parseSyncLink(rawSyncLink);
  const pullIntervalMinutes = Math.max(2, Math.min(120, Number(cfg.pullIntervalMinutes) || 10));
  const retentionDays = Math.max(1, Math.min(90, Number(cfg.retentionDays) || 7));
  const deviceName = (cloudCfg.deviceName && String(cloudCfg.deviceName).trim())
    || (cfg.deviceName && String(cfg.deviceName).trim())
    || (detectPlatform() === 'windows' ? 'PC' : 'Desktop');
  const accountLabel = (cloudCfg.accountLabel && String(cloudCfg.accountLabel).trim())
    || (cfg.accountLabel && String(cfg.accountLabel).trim())
    || detectedEmail
    || '';
  return {
    enabled,
    cfg,
    cloudCfg,
    creds,
    instanceId: meta.instanceId,
    deviceName,
    accountLabel,
    pullIntervalMinutes,
    retentionDays,
    excludeHosts: parseExcludeHosts(cfg),
    pushEveryVisit: cfg.pushEveryVisit !== false,
    importToNativeHistory: cfg.importToNativeHistory === true
  };
}

async function getCache() {
  const res = await storageGet([STORAGE_CACHE_KEY]);
  const c = res[STORAGE_CACHE_KEY];
  if (c && typeof c === 'object') {
    return {
      devices: Array.isArray(c.devices) ? c.devices : [],
      history: Array.isArray(c.history) ? c.history : [],
      usage: Array.isArray(c.usage) ? c.usage : [],
      lastServerTime: c.lastServerTime || null,
      lastPullAt: Number(c.lastPullAt) || 0,
      lastPushAt: Number(c.lastPushAt) || 0,
      lastError: c.lastError || null,
      retentionDays: Number(c.retentionDays) || 7
    };
  }
  return {
    devices: [],
    history: [],
    usage: [],
    lastServerTime: null,
    lastPullAt: 0,
    lastPushAt: 0,
    lastError: null,
    retentionDays: 7
  };
}

async function getPending() {
  const res = await storageGet([STORAGE_PENDING_KEY]);
  const p = res[STORAGE_PENDING_KEY];
  return {
    history: (p && Array.isArray(p.history)) ? p.history : [],
    usage: (p && p.usage && typeof p.usage === 'object') ? p.usage : {}
  };
}

async function recordTraffic(kind, bytesSent, bytesReceived) {
  const res = await storageGet([STORAGE_STATS_KEY]);
  const today = todayStr();
  const stats = res[STORAGE_STATS_KEY] || {
    day: today,
    bytesSentToday: 0,
    bytesReceivedToday: 0,
    pushesToday: 0,
    pullsToday: 0,
    bytesSentTotal: 0,
    bytesReceivedTotal: 0,
    pushesTotal: 0,
    pullsTotal: 0
  };
  if (stats.day !== today) {
    stats.day = today;
    stats.bytesSentToday = 0;
    stats.bytesReceivedToday = 0;
    stats.pushesToday = 0;
    stats.pullsToday = 0;
  }
  stats.bytesSentToday += bytesSent;
  stats.bytesReceivedToday += bytesReceived;
  stats.bytesSentTotal += bytesSent;
  stats.bytesReceivedTotal += bytesReceived;
  if (kind === 'push') {
    stats.pushesToday += 1;
    stats.pushesTotal += 1;
  } else if (kind === 'pull') {
    stats.pullsToday += 1;
    stats.pullsTotal += 1;
  }
  await storageSet({ [STORAGE_STATS_KEY]: stats });
  return stats;
}

// ---------------------------------------------------------------------------
// Supabase RPC Client (PostgREST /rest/v1/rpc/*)
// ---------------------------------------------------------------------------

async function callRpc(creds, fnName, bodyObj, trafficKind) {
  const endpoint = `${creds.url}/rest/v1/rpc/${fnName}`;
  const bodyStr = JSON.stringify(bodyObj);
  const bytesSent = new TextEncoder().encode(bodyStr).length;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': creds.key,
        'Authorization': `Bearer ${creds.key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: bodyStr,
      signal: controller.signal
    });
    const text = await res.text();
    const bytesReceived = new TextEncoder().encode(text).length;
    await recordTraffic(trafficKind, bytesSent, bytesReceived);

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(text);
        if (errJson && errJson.message) msg = `${res.status}: ${errJson.message}`;
      } catch (e) {}
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Native Edge Collectors: Profile Email, Tabs, Groups, Closed Tabs, Usage
// ---------------------------------------------------------------------------

function refreshProfileEmail() {
  if (!chrome.identity || typeof chrome.identity.getProfileUserInfo !== 'function') return;
  try {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      if (!chrome.runtime.lastError && info && info.email) {
        detectedEmail = String(info.email).trim();
      }
    });
  } catch (e) {}
}

async function seedClosedFromSessions(excludeList) {
  if (!chrome.sessions || typeof chrome.sessions.getRecentlyClosed !== 'function') return;
  try {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    const seen = new Set(recentClosed.map(c => c.url));
    for (const s of sessions || []) {
      const tab = s.tab;
      if (!tab || !tab.url) continue;
      const clean = sanitizeUrl(tab.url, excludeList);
      if (!clean || seen.has(clean.url)) continue;
      seen.add(clean.url);
      recentClosed.push({
        url: clean.url,
        title: cleanTitle(tab.title || clean.host),
        closedAt: s.lastModified ? new Date(s.lastModified * 1000).toISOString() : new Date().toISOString()
      });
      if (recentClosed.length >= 50) break;
    }
  } catch (e) {}
}

async function collectSnapshot(excludeList) {
  const tabsRaw = await chrome.tabs.query({});
  const tabs = [];
  const nextTabMem = new Map();

  for (const t of tabsRaw || []) {
    if (t.incognito) continue;
    const clean = sanitizeUrl(t.url || t.pendingUrl || '', excludeList);
    if (!clean) continue;
    const title = cleanTitle(t.title || clean.host);
    nextTabMem.set(t.id, { url: clean.url, title });
    tabs.push({
      id: String(t.id),
      url: clean.url,
      title,
      groupId: (typeof t.groupId === 'number' && t.groupId >= 0) ? String(t.groupId) : '',
      windowId: String(t.windowId || ''),
      active: Boolean(t.active),
      pinned: Boolean(t.pinned),
      lastActiveAt: t.lastAccessed ? new Date(t.lastAccessed).toISOString() : new Date().toISOString()
    });
    if (tabs.length >= 200) break;
  }
  tabMemory = nextTabMem;

  const groups = [];
  if (chrome.tabGroups && typeof chrome.tabGroups.query === 'function') {
    try {
      const rawGroups = await chrome.tabGroups.query({});
      for (const g of rawGroups || []) {
        groups.push({
          id: String(g.id),
          windowId: String(g.windowId || ''),
          title: cleanTitle(g.title || 'Group').slice(0, 120),
          color: String(g.color || 'grey').slice(0, 24),
          collapsed: Boolean(g.collapsed)
        });
        if (groups.length >= 50) break;
      }
    } catch (e) {}
  }

  if (recentClosed.length === 0) {
    await seedClosedFromSessions(excludeList);
  }
  const closed = recentClosed.slice(0, 50);

  return { tabs, groups, closed };
}

async function commitActiveUsage() {
  if (!activeSession || !activeSession.host) return;
  const now = Date.now();
  const elapsedSec = Math.round((now - activeSession.startedAt) / 1000);
  activeSession.startedAt = now;
  if (elapsedSec < 2 || elapsedSec > 3600) return;

  const pending = await getPending();
  const key = `${todayStr()}|${activeSession.host}`;
  if (!pending.usage[key]) {
    pending.usage[key] = { day: todayStr(), host: activeSession.host, seconds: 0, visits: 0 };
  }
  pending.usage[key].seconds = Math.min(3600, pending.usage[key].seconds + elapsedSec);
  await storageSet({ [STORAGE_PENDING_KEY]: pending });
}

async function trackActiveTab(tabId) {
  await commitActiveUsage();
  if (isIdle || tabId == null || tabId < 0) {
    activeSession = null;
    return;
  }
  try {
    const conf = await getConfig();
    if (!conf.enabled) {
      activeSession = null;
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.incognito) {
      activeSession = null;
      return;
    }
    const clean = sanitizeUrl(tab.url || '', conf.excludeHosts);
    if (!clean) {
      activeSession = null;
      return;
    }
    activeSession = { tabId, host: clean.host, startedAt: Date.now() };
  } catch (e) {
    activeSession = null;
  }
}

// ---------------------------------------------------------------------------
// Sync Operations: Push & Delta Pull
// ---------------------------------------------------------------------------

async function pushSync({ includeSnapshot = true, forceSnapshot = false, force = false } = {}) {
  const conf = await getConfig();
  if ((!conf.enabled && !force) || !conf.creds) return { ok: false, skipped: true };

  await commitActiveUsage();
  const pending = await getPending();
  const historyBatch = pending.history.slice(0, 100);
  const usageEntries = Object.values(pending.usage).filter(u => u && (u.seconds > 0 || u.visits > 0)).slice(0, 100);

  const payload = {
    instance_id: conf.instanceId,
    device_name: conf.deviceName,
    browser: detectBrowser(),
    platform: detectPlatform(),
    mode: 'extension',
    account_label: conf.accountLabel
  };

  let nextHash = lastSnapshotHash;
  let snapshotAttached = false;
  if (includeSnapshot) {
    const snap = await collectSnapshot(conf.excludeHosts);
    const snapSig = await sha256Hex(JSON.stringify([
      payload.device_name, payload.browser, payload.account_label,
      snap.tabs.map(t => [t.url, t.title, t.groupId, t.active, t.pinned]),
      snap.groups,
      snap.closed
    ]));
    if (forceSnapshot || snapSig !== lastSnapshotHash) {
      payload.tabs = snap.tabs;
      payload.groups = snap.groups;
      payload.closed = snap.closed;
      nextHash = snapSig;
      snapshotAttached = true;
    }
  }

  if (historyBatch.length > 0) payload.history = historyBatch;
  if (usageEntries.length > 0) payload.usage = usageEntries;

  // Nothing dirty -> skip network call completely.
  if (!snapshotAttached && historyBatch.length === 0 && usageEntries.length === 0) {
    return { ok: true, skipped: true };
  }

  try {
    const res = await callRpc(conf.creds, 'besing_sync_push', {
      p_secret: conf.creds.secret,
      p_payload: payload
    }, 'push');

    if (snapshotAttached) lastSnapshotHash = nextHash;

    // Clear only the flushed items from pending queue.
    const latestPending = await getPending();
    const flushedCount = historyBatch.length;
    latestPending.history = latestPending.history.slice(flushedCount);
    for (const u of usageEntries) {
      const k = `${u.day}|${u.host}`;
      if (latestPending.usage[k]) {
        latestPending.usage[k].seconds = Math.max(0, latestPending.usage[k].seconds - u.seconds);
        latestPending.usage[k].visits = Math.max(0, latestPending.usage[k].visits - u.visits);
        if (latestPending.usage[k].seconds === 0 && latestPending.usage[k].visits === 0) {
          delete latestPending.usage[k];
        }
      }
    }
    await storageSet({ [STORAGE_PENDING_KEY]: latestPending });

    const cache = await getCache();
    cache.lastPushAt = Date.now();
    cache.lastError = null;
    if (res && res.retention_days) cache.retentionDays = res.retention_days;
    await storageSet({ [STORAGE_CACHE_KEY]: cache });
    return { ok: true, res };
  } catch (err) {
    const cache = await getCache();
    cache.lastError = `Push failed: ${err.message}`;
    await storageSet({ [STORAGE_CACHE_KEY]: cache });
    return { ok: false, error: err.message };
  }
}

async function pullSync({ full = false, force = false } = {}) {
  const conf = await getConfig();
  if ((!conf.enabled && !force) || !conf.creds) return { ok: false, skipped: true };

  const cache = await getCache();
  const deviceHashes = {};
  if (!full) {
    for (const d of cache.devices) {
      if (d && d.instance_id && d.snapshot_hash) {
        deviceHashes[d.instance_id] = d.snapshot_hash;
      }
    }
  }

  try {
    const res = await callRpc(conf.creds, 'besing_sync_pull', {
      p_secret: conf.creds.secret,
      p_since: full ? null : cache.lastServerTime,
      p_device_hashes: deviceHashes,
      p_history_limit: full ? 250 : 150
    }, 'pull');

    const prevDeviceMap = new Map(cache.devices.map(d => [d.instance_id, d]));
    const mergedDevices = [];
    for (const d of (res.devices || [])) {
      if (d.unchanged && prevDeviceMap.has(d.instance_id)) {
        const prev = prevDeviceMap.get(d.instance_id);
        mergedDevices.push({
          ...prev,
          device_name: d.device_name,
          browser: d.browser,
          platform: d.platform,
          mode: d.mode,
          account_label: d.account_label,
          updated_at: d.updated_at,
          snapshot_hash: d.snapshot_hash
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

    const retentionDays = Number(res.retention_days) || conf.retentionDays || 7;
    const cutoffMs = Date.now() - retentionDays * 86400 * 1000;

    // Merge history deltas cleanly.
    const incomingHist = Array.isArray(res.history) ? res.history : [];
    const histMap = new Map();
    const baseHist = full ? [] : cache.history;
    for (const h of [...incomingHist, ...baseHist]) {
      if (!h || !h.url) continue;
      const t = Date.parse(h.visitedAt || '');
      if (Number.isFinite(t) && t < cutoffMs) continue;
      const k = h.id ? `id:${h.id}` : `${h.instance_id}|${h.url}|${Math.floor((t || 0) / 300000)}`;
      if (!histMap.has(k)) histMap.set(k, h);
    }
    const mergedHistory = Array.from(histMap.values())
      .sort((a, b) => Date.parse(b.visitedAt || 0) - Date.parse(a.visitedAt || 0))
      .slice(0, 600);

    // Optional: import remote non-self visits into native Edge history.
    if (conf.importToNativeHistory && chrome.history && typeof chrome.history.addUrl === 'function') {
      for (const h of incomingHist) {
        if (!h || h.instance_id === conf.instanceId || !h.url) continue;
        if (importedUrls.has(h.url)) continue;
        importedUrls.add(h.url);
        if (importedUrls.size > 500) importedUrls.clear();
        try { chrome.history.addUrl({ url: h.url }); } catch (e) {}
      }
    }

    // Merge usage rows by (instance_id, day, host).
    const usageMap = new Map();
    const baseUsage = full ? [] : cache.usage;
    const cutoffDay = new Date(cutoffMs).toISOString().slice(0, 10);
    for (const u of baseUsage) {
      if (!u || !u.host || u.day < cutoffDay) continue;
      usageMap.set(`${u.instance_id}|${u.day}|${u.host}`, u);
    }
    for (const u of (res.usage || [])) {
      if (!u || !u.host || u.day < cutoffDay) continue;
      usageMap.set(`${u.instance_id}|${u.day}|${u.host}`, u);
    }

    const nextCache = {
      devices: mergedDevices,
      history: mergedHistory,
      usage: Array.from(usageMap.values()),
      lastServerTime: res.server_time || new Date().toISOString(),
      lastPullAt: Date.now(),
      lastPushAt: cache.lastPushAt,
      lastError: null,
      retentionDays
    };
    await storageSet({ [STORAGE_CACHE_KEY]: nextCache });
    return { ok: true, cache: nextCache };
  } catch (err) {
    cache.lastError = `Pull failed: ${err.message}`;
    await storageSet({ [STORAGE_CACHE_KEY]: cache });
    return { ok: false, error: err.message };
  }
}

async function syncNow(fullPull = false, manual = true) {
  if (syncingNow) return { ok: true, busy: true };
  syncingNow = true;
  try {
    refreshProfileEmail();
    const pushRes = await pushSync({ includeSnapshot: true, forceSnapshot: true, force: manual });
    const pullRes = await pullSync({ full: fullPull, force: manual });
    return { ok: Boolean(pullRes.ok), push: pushRes, pull: pullRes };
  } finally {
    syncingNow = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduling & Event Listeners
// ---------------------------------------------------------------------------

function scheduleSnapshotPush(delayMs = 15000) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    pushSync({ includeSnapshot: true }).catch(() => {});
  }, delayMs);
}

function scheduleVisitPush(delayMs = 4000) {
  if (visitTimer) clearTimeout(visitTimer);
  visitTimer = setTimeout(() => {
    visitTimer = null;
    pushSync({ includeSnapshot: true }).catch(() => {});
  }, delayMs);
}

async function setupAlarms() {
  const conf = await getConfig();
  await chrome.alarms.clear(ALARM_PULL);
  await chrome.alarms.clear(ALARM_FLUSH);
  if (!conf.enabled || !conf.creds) return;
  chrome.alarms.create(ALARM_PULL, { periodInMinutes: conf.pullIntervalMinutes });
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_PULL) {
    await pullSync({ full: false });
  } else if (alarm.name === ALARM_FLUSH) {
    await commitActiveUsage();
    const pending = await getPending();
    if (pending.history.length > 0 || Object.keys(pending.usage).length > 0) {
      await pushSync({ includeSnapshot: true });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  refreshProfileEmail();
  await setupAlarms();
  await syncNow(false, false);
});

chrome.runtime.onInstalled.addListener(async () => {
  refreshProfileEmail();
  await setupAlarms();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled_scripts || changes.script_configs || changes.global_settings) {
    refreshProfileEmail();
    await setupAlarms();
  }
});

// Track tab creation, updates, grouping, and removal.
chrome.tabs.onCreated.addListener(() => scheduleSnapshotPush(12000));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete' || changeInfo.groupId !== undefined) {
    if (tab && !tab.incognito && tab.url) {
      const clean = sanitizeUrl(tab.url, []);
      if (clean) tabMemory.set(tabId, { url: clean.url, title: cleanTitle(tab.title || clean.host) });
    }
    if (activeSession && activeSession.tabId === tabId && changeInfo.url) {
      trackActiveTab(tabId);
    }
    scheduleSnapshotPush(15000);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeSession && activeSession.tabId === tabId) {
    await commitActiveUsage();
    activeSession = null;
  }
  const remembered = tabMemory.get(tabId);
  tabMemory.delete(tabId);
  if (remembered && remembered.url) {
    recentClosed = [
      { url: remembered.url, title: remembered.title, closedAt: new Date().toISOString() },
      ...recentClosed.filter(c => c.url !== remembered.url)
    ].slice(0, 50);
  }
  scheduleSnapshotPush(8000);
});

chrome.tabs.onActivated.addListener((info) => {
  trackActiveTab(info.tabId);
  scheduleSnapshotPush(20000);
});

if (chrome.tabGroups) {
  chrome.tabGroups.onCreated.addListener(() => scheduleSnapshotPush(8000));
  chrome.tabGroups.onUpdated.addListener(() => scheduleSnapshotPush(8000));
  chrome.tabGroups.onRemoved.addListener(() => scheduleSnapshotPush(8000));
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await commitActiveUsage();
    activeSession = null;
    // Best-effort flush when user switches away from Edge.
    pushSync({ includeSnapshot: true }).catch(() => {});
  } else {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      if (tabs && tabs[0]) await trackActiveTab(tabs[0].id);
    } catch (e) {}
  }
});

if (chrome.idle) {
  try { chrome.idle.setDetectionInterval(60); } catch (e) {}
  chrome.idle.onStateChanged.addListener(async (state) => {
    if (state === 'idle' || state === 'locked') {
      isIdle = true;
      await commitActiveUsage();
      activeSession = null;
      pushSync({ includeSnapshot: true }).catch(() => {});
    } else if (state === 'active') {
      isIdle = false;
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0]) await trackActiveTab(tabs[0].id);
      } catch (e) {}
    }
  });
}

// Track every history visit with dedup & instant batched push.
if (chrome.history && chrome.history.onVisited) {
  chrome.history.onVisited.addListener(async (item) => {
    const conf = await getConfig();
    if (!conf.enabled || !conf.creds || !item || !item.url) return;
    if (importedUrls.has(item.url)) return;

    const clean = sanitizeUrl(item.url, conf.excludeHosts);
    if (!clean) return;

    const now = Date.now();
    const prevTs = recentUrlDedup.get(clean.url) || 0;
    if (now - prevTs < 60000) return;
    recentUrlDedup.set(clean.url, now);
    if (recentUrlDedup.size > 300) {
      const cutoff = now - 120000;
      for (const [k, v] of recentUrlDedup.entries()) {
        if (v < cutoff) recentUrlDedup.delete(k);
      }
    }

    const pending = await getPending();
    pending.history.push({
      url: clean.url,
      host: clean.host,
      title: cleanTitle(item.title || clean.host),
      visitedAt: item.lastVisitTime ? new Date(item.lastVisitTime).toISOString() : new Date(now).toISOString()
    });
    if (pending.history.length > 100) pending.history = pending.history.slice(-100);

    const key = `${todayStr()}|${clean.host}`;
    if (!pending.usage[key]) {
      pending.usage[key] = { day: todayStr(), host: clean.host, seconds: 0, visits: 0 };
    }
    pending.usage[key].visits += 1;
    await storageSet({ [STORAGE_PENDING_KEY]: pending });

    if (conf.pushEveryVisit) {
      scheduleVisitPush(4000);
    }
  });
}

// ---------------------------------------------------------------------------
// Message Bridge for BESing Content Script UI
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || (!msg.type.startsWith('besing-sync:') && !msg.type.startsWith('besing-cloud:'))) return false;

  (async () => {
    try {
      // Shared Manager Cloud API (used by Settings Sync, Quick Transfer, Browser Sync, and future scripts)
      if (msg.type === 'besing-cloud:get-info') {
        refreshProfileEmail();
        const conf = await getConfig();
        const res = await storageGet([STORAGE_STATS_KEY]);
        sendResponse({
          ok: true,
          mode: 'extension',
          configured: Boolean(conf.creds),
          instanceId: conf.instanceId,
          deviceName: conf.deviceName,
          accountLabel: conf.accountLabel,
          detectedEmail,
          browser: detectBrowser(),
          platform: detectPlatform(),
          stats: res[STORAGE_STATS_KEY] || null
        });
        return;
      }

      if (msg.type === 'besing-cloud:rpc') {
        const conf = await getConfig();
        const creds = msg.syncLink ? parseSyncLink(msg.syncLink) : conf.creds;
        if (!creds) {
          sendResponse({ ok: false, error: 'Cloud database not linked. Configure Sync Link in BESing Settings.' });
          return;
        }
        const fnName = String(msg.fnName || '').trim();
        if (!/^[a-z0-9_]+$/i.test(fnName)) {
          sendResponse({ ok: false, error: 'Invalid RPC function name' });
          return;
        }
        const bodyObj = Object.assign({}, msg.args || {}, { p_secret: creds.secret });
        const trafficKind = msg.trafficKind === 'pull' ? 'pull' : 'push';
        const data = await callRpc(creds, fnName, bodyObj, trafficKind);
        const res = await storageGet([STORAGE_STATS_KEY]);
        sendResponse({ ok: true, data, stats: res[STORAGE_STATS_KEY] || null });
        return;
      }

      if (msg.type === 'besing-sync:get-state') {
        refreshProfileEmail();
        const conf = await getConfig();
        const cache = await getCache();
        const res = await storageGet([STORAGE_STATS_KEY]);
        sendResponse({
          ok: true,
          mode: 'extension',
          instanceId: conf.instanceId,
          detectedEmail,
          browser: detectBrowser(),
          platform: detectPlatform(),
          configured: Boolean(conf.creds),
          enabled: conf.enabled,
          cache,
          stats: res[STORAGE_STATS_KEY] || null
        });
        return;
      }

      if (msg.type === 'besing-sync:sync-now') {
        const result = await syncNow(Boolean(msg.full));
        const cache = await getCache();
        const res = await storageGet([STORAGE_STATS_KEY]);
        sendResponse({ ok: result.ok, error: result.pull?.error || result.push?.error || null, cache, stats: res[STORAGE_STATS_KEY] || null });
        return;
      }

      if (msg.type === 'besing-sync:test-connection') {
        const creds = parseSyncLink(msg.syncLink || '');
        if (!creds) {
          sendResponse({ ok: false, error: 'Invalid Sync Link format (must be besing-sync://... with HTTPS URL, API key, and secret >= 16 chars).' });
          return;
        }
        const t0 = Date.now();
        const res = await callRpc(creds, 'besing_sync_pull', {
          p_secret: creds.secret,
          p_since: null,
          p_device_hashes: {},
          p_history_limit: 5
        }, 'pull');
        sendResponse({
          ok: true,
          latencyMs: Date.now() - t0,
          deviceCount: Array.isArray(res.devices) ? res.devices.length : 0,
          retentionDays: res.retention_days || 7
        });
        return;
      }

      if (msg.type === 'besing-sync:open-tab') {
        const clean = sanitizeUrl(msg.url || '', []);
        if (!clean) {
          sendResponse({ ok: false, error: 'Invalid URL' });
          return;
        }
        await chrome.tabs.create({ url: clean.url, active: msg.active !== false });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'besing-sync:open-group') {
        const urls = (Array.isArray(msg.urls) ? msg.urls : [])
          .map(u => sanitizeUrl(u, []))
          .filter(Boolean)
          .slice(0, 30);
        if (urls.length === 0) {
          sendResponse({ ok: false, error: 'No valid URLs in group' });
          return;
        }
        const createdIds = [];
        for (let i = 0; i < urls.length; i++) {
          const t = await chrome.tabs.create({ url: urls[i].url, active: i === 0 });
          if (t && typeof t.id === 'number') createdIds.push(t.id);
        }
        if (createdIds.length > 0 && chrome.tabs.group && chrome.tabGroups) {
          try {
            const gid = await chrome.tabs.group({ tabIds: createdIds });
            const validColors = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
            const color = validColors.has(msg.color) ? msg.color : 'blue';
            await chrome.tabGroups.update(gid, {
              title: cleanTitle(msg.title || 'Synced Group').slice(0, 60),
              color
            });
          } catch (e) {}
        }
        sendResponse({ ok: true, opened: createdIds.length });
        return;
      }

      if (msg.type === 'besing-sync:delete-device') {
        const conf = await getConfig();
        if (!conf.creds) {
          sendResponse({ ok: false, error: 'Not configured' });
          return;
        }
        await callRpc(conf.creds, 'besing_sync_delete_device', {
          p_secret: conf.creds.secret,
          p_instance_id: String(msg.instanceId || '')
        }, 'push');
        const pullRes = await pullSync({ full: true });
        sendResponse({ ok: true, cache: pullRes.cache || await getCache() });
        return;
      }

      if (msg.type === 'besing-sync:set-retention') {
        const conf = await getConfig();
        if (!conf.creds) {
          sendResponse({ ok: false, error: 'Not configured' });
          return;
        }
        const days = Math.max(1, Math.min(90, Number(msg.days) || 7));
        const res = await callRpc(conf.creds, 'besing_sync_set_retention', {
          p_secret: conf.creds.secret,
          p_retention_days: days
        }, 'push');
        const pullRes = await pullSync({ full: true });
        sendResponse({ ok: true, pruned: res.pruned || 0, retentionDays: res.retention_days || days, cache: pullRes.cache || await getCache() });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true;
});

// Boot initialization when service worker wakes.
refreshProfileEmail();
setupAlarms();
