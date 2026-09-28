/**
 * BESing - Automated Update Engine
 * Supports multi-channel update checks: GitHub Raw (bleeding-edge), Greasy Fork (stable), and Local Server (dev/test).
 */

export class BESUpdater {
  constructor({ currentVersion = '1.4.0', storage = null, onUpdateFound = null }) {
    this.currentVersion = currentVersion;
    this.storage = storage;
    this.onUpdateFound = onUpdateFound;
    this.isChecking = false;
    this.lastCheckResult = null;

    this.channels = {
      github: {
        id: 'github',
        name: 'GitHub (Bleeding-Edge / Instant)',
        metaUrl: 'https://raw.githubusercontent.com/Granine/BESing/main/BESing/userscript/besing-manager.meta.js',
        scriptUrl: 'https://raw.githubusercontent.com/Granine/BESing/main/BESing/userscript/besing-manager.user.js',
        desc: 'Instant updates directly upon git push. Minimal latency.'
      },
      greasyfork: {
        id: 'greasyfork',
        name: 'Greasy Fork (Curated Stable)',
        metaUrl: 'https://update.greasyfork.org/scripts/512345/BESing%20Script%20Manager.meta.js',
        scriptUrl: 'https://update.greasyfork.org/scripts/512345/BESing%20Script%20Manager.user.js',
        desc: 'Curated and moderated releases on Greasy Fork repository.'
      },
      local: {
        id: 'local',
        name: 'Local Server (Dev / Test)',
        metaUrl: 'http://127.0.0.1:8765/userscript/besing-manager.meta.js',
        scriptUrl: 'http://127.0.0.1:8765/userscript/besing-manager.user.js',
        desc: 'Connected to local BESing demo server for instant dev hot-reloads.'
      }
    };
  }

  /**
   * Get configured update channel and URLs
   */
  async getConfig() {
    let settings = {};
    if (this.storage) {
      if (typeof this.storage.getSettings === 'function') {
        settings = this.storage.getSettings() || {};
      } else if (this.storage.settings) {
        settings = this.storage.settings;
      }
    }
    const channelId = settings.updateChannel || 'github';
    const channelDef = this.channels[channelId] || this.channels.github;
    const customUrl = settings.customUpdateUrl || '';

    let metaUrl = channelDef.metaUrl;
    let scriptUrl = channelDef.scriptUrl;

    if (channelId === 'custom' && customUrl) {
      metaUrl = customUrl;
      scriptUrl = customUrl;
    }

    return {
      channelId,
      channelName: channelDef.name,
      metaUrl,
      scriptUrl,
      autoCheck: settings.autoCheckUpdates !== false
    };
  }

  /**
   * Compare two semver strings (e.g. "1.4.0" vs "1.3.0")
   * Returns: 1 if vA > vB, -1 if vA < vB, 0 if equal
   */
  static compareVersions(vA, vB) {
    if (!vA || !vB) return 0;
    const cleanA = vA.replace(/^v/i, '').trim();
    const cleanB = vB.replace(/^v/i, '').trim();
    const partsA = cleanA.split('.').map(n => parseInt(n, 10) || 0);
    const partsB = cleanB.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < maxLen; i++) {
      const a = partsA[i] || 0;
      const b = partsB[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  /**
   * Parse @version from a raw userscript or .meta.js string
   */
  static parseVersion(codeText) {
    if (!codeText) return null;
    const match = codeText.match(/@version\s+([0-9A-Za-z.\-_]+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Cross-origin text fetcher with GM_xmlhttpRequest support and standard fetch fallback
   */
  static async fetchText(url) {
    // Add cache buster
    const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;

    // Prefer GM_xmlhttpRequest to bypass CORS in Tampermonkey / Violentmonkey
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: targetUrl,
          nocache: true,
          timeout: 6000,
          onload: function (response) {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText);
            } else {
              reject(new Error(`HTTP ${response.status}`));
            }
          },
          onerror: function (err) {
            reject(new Error(err.error || 'Network request failed'));
          },
          ontimeout: function () {
            reject(new Error('Update check timed out'));
          }
        });
      });
    }

    // Standard fetch fallback
    const res = await fetch(targetUrl, {
      method: 'GET',
      cache: 'no-cache',
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  }

  /**
   * Check for newer version
   */
  async checkForUpdates(force = false) {
    if (this.isChecking) return this.lastCheckResult;
    this.isChecking = true;

    try {
      const config = await this.getConfig();
      const text = await BESUpdater.fetchText(config.metaUrl);
      const remoteVersion = BESUpdater.parseVersion(text);

      if (!remoteVersion) {
        throw new Error('Failed to parse remote @version from metadata header');
      }

      const hasUpdate = BESUpdater.compareVersions(remoteVersion, this.currentVersion) > 0;
      const result = {
        ok: true,
        hasUpdate,
        currentVersion: this.currentVersion,
        remoteVersion,
        channel: config.channelId,
        channelName: config.channelName,
        metaUrl: config.metaUrl,
        downloadUrl: config.scriptUrl,
        checkedAt: Date.now()
      };

      this.lastCheckResult = result;

      if (hasUpdate && typeof this.onUpdateFound === 'function') {
        this.onUpdateFound(result);
      }

      return result;
    } catch (err) {
      const config = await this.getConfig().catch(() => ({ channelId: 'unknown', channelName: 'Unknown' }));
      const result = {
        ok: false,
        hasUpdate: false,
        currentVersion: this.currentVersion,
        remoteVersion: null,
        channel: config.channelId,
        channelName: config.channelName,
        error: err.message,
        checkedAt: Date.now()
      };
      this.lastCheckResult = result;
      return result;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Trigger 1-click update installation
   */
  triggerInstall(downloadUrl) {
    const url = downloadUrl || this.channels.github.scriptUrl;
    console.log('[BESing Updater] Opening update installation URL:', url);
    // Opening a .user.js URL in browsers with Tampermonkey/Violentmonkey immediately invokes the native update confirmation overlay
    window.open(url, '_blank');
  }
}
