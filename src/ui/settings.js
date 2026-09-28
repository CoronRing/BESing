/**
 * BESing - Settings, Desktop Pet Themes & Agent Sync Panel
 */

export class BESSettingsView {
  constructor({ storage, syncEngine, updater = null, onBack, onDisableCurrentSite, onSitesChanged, onThemeChanged, onUpdateFound = null }) {
    this.storage = storage;
    this.syncEngine = syncEngine;
    this.updater = updater;
    this.onBack = onBack;
    this.onDisableCurrentSite = onDisableCurrentSite;
    this.onSitesChanged = onSitesChanged;
    this.onThemeChanged = onThemeChanged;
    this.onUpdateFound = onUpdateFound;
    this.container = null;
  }

  render() {
    const section = document.createElement('div');
    section.className = 'besing-settings-section';

    const currentHost = window.location.hostname || 'localhost';
    const blockedSites = this.storage.getBlockedSites();
    const currentTheme = this.storage.getTheme();
    const settings = this.storage.getSettings();

    section.innerHTML = `
      <!-- Desktop Pet & Theme Selector -->
      <div class="besing-theme-picker">
        <div class="besing-section-title">Display Pattern & Desktop Pet</div>
        <div class="besing-theme-grid">
          <button class="besing-theme-btn ${currentTheme === 'cyber-pet' ? 'active' : ''}" data-theme="cyber-pet">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="5" y="8" width="22" height="18" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="2"/><ellipse cx="11.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/><ellipse cx="20.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/></svg>
            <span>Cyber Pet</span>
          </button>
          <button class="besing-theme-btn ${currentTheme === 'orb' ? 'active' : ''}" data-theme="orb">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#818cf8" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="#6366f1"/></svg>
            <span>Neon Orb</span>
          </button>
          <button class="besing-theme-btn ${currentTheme === 'crystal' ? 'active' : ''}" data-theme="crystal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><polygon points="12 2 20 8 16 22 8 22 4 8 12 2"/></svg>
            <span>Crystal</span>
          </button>
          <button class="besing-theme-btn ${currentTheme === 'minimal' ? 'active' : ''}" data-theme="minimal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><circle cx="12" cy="12" r="5" fill="#6366f1"/></svg>
            <span>Minimal</span>
          </button>
        </div>
      </div>

      <!-- Automated Software Updates Card -->
      <div class="besing-update-card">
        <div class="besing-update-header">
          <div class="besing-section-title" style="color:#c084fc;">Automated Software Updates</div>
          <span class="besing-status-pill idle" id="besing-update-status">
            <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span>
            <span id="besing-update-status-text">v${this.updater ? this.updater.currentVersion : '1.4.0'}</span>
          </span>
        </div>
        <div class="besing-version-row">
          <div class="besing-version-col">
            <span class="besing-version-label">Current Version</span>
            <span class="besing-version-val">v${this.updater ? this.updater.currentVersion : '1.4.0'}</span>
          </div>
          <div class="besing-version-col">
            <span class="besing-version-label">Update Channel</span>
            <select id="besing-channel-picker" class="besing-channel-select">
              <option value="github" ${(settings.updateChannel || 'github') === 'github' ? 'selected' : ''}>GitHub (Bleeding-edge / Instant)</option>
              <option value="greasyfork" ${settings.updateChannel === 'greasyfork' ? 'selected' : ''}>Greasy Fork (Curated Stable)</option>
              <option value="local" ${settings.updateChannel === 'local' ? 'selected' : ''}>Local Server (Dev / Test)</option>
            </select>
          </div>
        </div>
        <div class="besing-update-actions">
          <button class="besing-btn-sync" id="besing-btn-check-updates">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            Check Updates
          </button>
          <button class="besing-btn-update hidden" id="besing-btn-apply-update">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Update Now
          </button>
        </div>
        <div id="besing-update-notice" class="besing-update-msg">Ready to check for latest release.</div>
      </div>

      <!-- Agent Sync Control Card -->
      <div class="besing-agent-card">
        <div class="besing-agent-status-row">
          <div class="besing-section-title" style="color:#38bdf8;">Targeted Agent Sync</div>
          <span class="besing-status-pill idle" id="besing-agent-status">
            <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span>
            <span>Idle</span>
          </span>
        </div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="besing-agent-url" class="besing-search-input" style="padding-left:10px;font-size:11px;" value="${this._escapeHTML(settings.agentUrl || 'http://127.0.0.1:8765/api/sync')}" placeholder="Agent URL (e.g. http://127.0.0.1:8765/api/sync)">
          <button class="besing-btn-unblock" id="besing-btn-test-agent" style="white-space:nowrap;">Test</button>
        </div>
        <div class="besing-sync-btn-group">
          <button class="besing-btn-sync" id="besing-btn-pull">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Pull Scripts
          </button>
          <button class="besing-btn-sync" id="besing-btn-push">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 14 12 9 7 14"></polyline><line x1="12" y1="9" x2="12" y2="21"></line></svg>
            Push State
          </button>
        </div>
        <div id="besing-sync-msg" style="font-size:10px;color:#94a3b8;min-height:14px;"></div>
      </div>

      <!-- Current Site Disabler -->
      <div class="besing-site-card">
        <div class="besing-site-card-header">
          <span style="font-size:11px;font-weight:700;color:#cbd5e1;text-transform:uppercase;">Current Site Control</span>
          <span class="besing-current-domain">${this._escapeHTML(currentHost)}</span>
        </div>
        <p class="besing-site-warn">
          Turn off BESing for <strong>${this._escapeHTML(currentHost)}</strong>. Widget and scripts will be removed.
        </p>
        <button class="besing-btn-danger" id="besing-btn-disable-site">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          Disable BESing on this site
        </button>
      </div>

      <!-- Blocked Sites List -->
      <div class="besing-blocklist-header">
        <span class="besing-blocklist-title">Blocked Sites (By Added Time)</span>
        <span class="besing-blocklist-count" id="besing-blocklist-count">${blockedSites.length} blocked</span>
      </div>

      <div class="besing-blocked-list" id="besing-blocked-list"></div>
    `;

    this.container = section;

    // Theme selector listeners
    section.querySelectorAll('.besing-theme-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        section.querySelectorAll('.besing-theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const theme = btn.getAttribute('data-theme');
        await this.storage.setTheme(theme);
        if (typeof this.onThemeChanged === 'function') {
          this.onThemeChanged(theme);
        }
      });
    });

    // Updater listeners
    if (this.updater) {
      const channelPicker = section.querySelector('#besing-channel-picker');
      const checkBtn = section.querySelector('#besing-btn-check-updates');
      const applyBtn = section.querySelector('#besing-btn-apply-update');
      const updateStatus = section.querySelector('#besing-update-status');
      const updateStatusText = section.querySelector('#besing-update-status-text');
      const updateNotice = section.querySelector('#besing-update-notice');

      channelPicker.addEventListener('change', async () => {
        const val = channelPicker.value;
        await this.storage.updateSettings({ updateChannel: val });
        updateNotice.textContent = `Channel switched to: ${channelPicker.options[channelPicker.selectedIndex].text}`;
      });

      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.style.opacity = '0.6';
        updateNotice.textContent = 'Checking for updates...';
        updateStatus.className = 'besing-status-pill idle';
        updateStatusText.textContent = 'Checking...';

        try {
          const res = await this.updater.checkForUpdates(true);
          if (res.ok) {
            if (res.hasUpdate) {
              updateStatus.className = 'besing-status-pill update-ready';
              updateStatusText.textContent = `v${res.remoteVersion} Available`;
              applyBtn.classList.remove('hidden');
              updateNotice.innerHTML = `<span style="color:#a78bfa;font-weight:600;">Update found!</span> v${res.remoteVersion} is available via ${res.channelName}. Click <strong>Update Now</strong> to install.`;
              if (typeof this.onUpdateFound === 'function') this.onUpdateFound(res);
            } else {
              updateStatus.className = 'besing-status-pill connected';
              updateStatusText.textContent = 'Up to date';
              applyBtn.classList.add('hidden');
              updateNotice.textContent = `✅ BESing is up to date (Latest: v${res.remoteVersion} via ${res.channelName}).`;
            }
          } else {
            updateStatus.className = 'besing-status-pill error';
            updateStatusText.textContent = 'Check Failed';
            updateNotice.textContent = `Update check failed: ${res.error || 'Network error'}`;
          }
        } catch (e) {
          updateStatus.className = 'besing-status-pill error';
          updateStatusText.textContent = 'Error';
          updateNotice.textContent = `Error: ${e.message}`;
        } finally {
          checkBtn.disabled = false;
          checkBtn.style.opacity = '1';
        }
      });

      applyBtn.addEventListener('click', () => {
        const downloadUrl = this.updater.lastCheckResult ? this.updater.lastCheckResult.downloadUrl : null;
        this.updater.triggerInstall(downloadUrl);
      });
    }

    // Agent sync listeners
    const statusPill = section.querySelector('#besing-agent-status');
    const msgEl = section.querySelector('#besing-sync-msg');
    const urlInput = section.querySelector('#besing-agent-url');

    urlInput.addEventListener('change', async () => {
      await this.storage.updateSettings({ agentUrl: urlInput.value.trim() });
    });

    section.querySelector('#besing-btn-test-agent').addEventListener('click', async () => {
      await this.storage.updateSettings({ agentUrl: urlInput.value.trim() });
      msgEl.textContent = 'Testing connection...';
      const res = await this.syncEngine.testConnection();
      if (res.ok) {
        statusPill.className = 'besing-status-pill connected';
        statusPill.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Connected';
        msgEl.textContent = res.message;
      } else {
        statusPill.className = 'besing-status-pill error';
        statusPill.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span> Offline';
        msgEl.textContent = res.message;
      }
    });

    section.querySelector('#besing-btn-pull').addEventListener('click', async () => {
      await this.storage.updateSettings({ agentUrl: urlInput.value.trim() });
      msgEl.textContent = 'Pulling from agent...';
      const res = await this.syncEngine.pull();
      if (res.ok) {
        statusPill.className = 'besing-status-pill connected';
        msgEl.textContent = `Sync OK! Updated ${res.updatedCount || 0} scripts.`;
      } else {
        statusPill.className = 'besing-status-pill error';
        msgEl.textContent = `Pull error: ${res.error}`;
      }
    });

    section.querySelector('#besing-btn-push').addEventListener('click', async () => {
      await this.storage.updateSettings({ agentUrl: urlInput.value.trim() });
      msgEl.textContent = 'Pushing state to agent...';
      const res = await this.syncEngine.push();
      if (res.ok) {
        statusPill.className = 'besing-status-pill connected';
        msgEl.textContent = 'State successfully pushed to agent!';
      } else {
        statusPill.className = 'besing-status-pill error';
        msgEl.textContent = `Push error: ${res.error}`;
      }
    });

    // Disable site listener
    section.querySelector('#besing-btn-disable-site').addEventListener('click', async () => {
      const confirmed = confirm(`Disable BESing on ${currentHost}?\nThe floating button and all scripts will be removed from this site.`);
      if (confirmed) {
        await this.storage.blockSite(currentHost);
        if (typeof this.onDisableCurrentSite === 'function') {
          this.onDisableCurrentSite(currentHost);
        }
      }
    });

    this._renderBlockedItems(section.querySelector('#besing-blocked-list'), blockedSites);

    return section;
  }

  _renderBlockedItems(listContainer, blockedSites) {
    listContainer.innerHTML = '';

    if (!blockedSites || blockedSites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'besing-empty-state';
      empty.textContent = 'No sites are currently blocked.';
      listContainer.appendChild(empty);
      return;
    }

    blockedSites.forEach(item => {
      const row = document.createElement('div');
      row.className = 'besing-blocked-item';

      const info = document.createElement('div');
      info.style.cssText = 'display:flex;align-items:center;';

      const domain = document.createElement('span');
      domain.className = 'besing-blocked-domain';
      domain.textContent = item.host;

      const date = document.createElement('span');
      date.className = 'besing-blocked-date';
      date.textContent = this._formatTime(item.addedAt);

      info.appendChild(domain);
      info.appendChild(date);

      const unblockBtn = document.createElement('button');
      unblockBtn.className = 'besing-btn-unblock';
      unblockBtn.textContent = 'Unblock';
      unblockBtn.addEventListener('click', async () => {
        await this.storage.unblockSite(item.host);
        const updated = this.storage.getBlockedSites();
        const countBadge = this.container.querySelector('#besing-blocklist-count');
        if (countBadge) countBadge.textContent = `${updated.length} blocked`;
        this._renderBlockedItems(listContainer, updated);

        if (typeof this.onSitesChanged === 'function') {
          this.onSitesChanged(item.host, 'unblock');
        }
      });

      row.appendChild(info);
      row.appendChild(unblockBtn);
      listContainer.appendChild(row);
    });
  }

  _formatTime(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  _escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}
