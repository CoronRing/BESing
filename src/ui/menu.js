/**
 * BESing - Anchored Bubble Manager Menu
 * Non-blocking speech bubble positioned directly relative to the floating widget.
 */
import { BESSettingsView } from './settings.js';

export class BESMenu {
  constructor({ registry, storage, syncEngine, widget, onClose, onDisableCurrentSite, onSitesChanged, onThemeChanged, context }) {
    this.registry = registry;
    this.storage = storage;
    this.syncEngine = syncEngine;
    this.widget = widget;
    this.onClose = onClose;
    this.onDisableCurrentSite = onDisableCurrentSite;
    this.onSitesChanged = onSitesChanged;
    this.onThemeChanged = onThemeChanged;
    this.context = context;

    this.wrapperEl = null;
    this.panelEl = null;
    this.arrowEl = null;
    this.currentView = 'extensions'; // 'extensions' | 'settings'
    this.isExpanded = false;
    this.searchQuery = '';

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);
  }

  render(container, initialView = 'extensions') {
    this.destroy();
    this.currentView = initialView;

    const wrapper = document.createElement('div');
    wrapper.className = 'besing-bubble-wrapper';

    // Arrow pointer element
    const arrow = document.createElement('div');
    arrow.className = 'besing-bubble-arrow arrow-bottom';
    wrapper.appendChild(arrow);
    this.arrowEl = arrow;

    // Panel element
    const panel = document.createElement('div');
    panel.className = 'besing-bubble-panel';
    wrapper.appendChild(panel);
    this.panelEl = panel;

    // Header
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
    titleSpan.textContent = 'BESing Hub';
    const tagSpan = document.createElement('span');
    tagSpan.className = 'besing-tag';
    tagSpan.textContent = 'v1.5.8';
    titleGroup.appendChild(titleSpan);
    titleGroup.appendChild(tagSpan);
    logoGroup.appendChild(titleGroup);
    header.appendChild(logoGroup);

    const headerActions = document.createElement('div');
    headerActions.className = 'besing-header-actions';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'besing-btn-icon';
    expandBtn.id = 'besing-btn-expand';
    expandBtn.title = 'Toggle Compact / Expanded View';
    const expandSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`);
    if (expandSvg) expandBtn.appendChild(expandSvg);
    headerActions.appendChild(expandBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = `besing-btn-icon ${this.currentView === 'settings' ? 'active' : ''}`;
    settingsBtn.id = 'besing-btn-toggle-settings';
    settingsBtn.title = 'Settings & Blocked Sites';
    const settingsSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`);
    if (settingsSvg) settingsBtn.appendChild(settingsSvg);
    headerActions.appendChild(settingsBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'besing-btn-icon';
    closeBtn.id = 'besing-btn-close';
    closeBtn.title = 'Close';
    const closeSvg = this.createSVG(`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`);
    if (closeSvg) closeBtn.appendChild(closeSvg);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerActions);
    panel.appendChild(header);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'besing-body';
    bodyEl.id = 'besing-modal-body';
    panel.appendChild(bodyEl);

    container.appendChild(wrapper);
    this.wrapperEl = wrapper;

    // Apply anchored positioning based on widget's rect
    this._positionBubble();

    // Event listeners
    closeBtn.addEventListener('click', () => this.close());

    expandBtn.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      panel.classList.toggle('is-expanded', this.isExpanded);
      this._positionBubble();
    });

    settingsBtn.addEventListener('click', () => {
      this.currentView = this.currentView === 'settings' ? 'extensions' : 'settings';
      settingsBtn.classList.toggle('active', this.currentView === 'settings');
      this._renderCurrentView();
    });

    // Close when clicking outside on host page without blocking page clicks
    setTimeout(() => {
      document.addEventListener('click', this._onDocumentClick);
    }, 50);

    document.addEventListener('keydown', this._onKeyDown);

    this._renderCurrentView();
    return wrapper;
  }

  /**
   * Position the speech bubble anchored to the widget
   */
  _positionBubble() {
    if (!this.wrapperEl || !this.widget) return;

    if (this.isExpanded) {
      // Centered expanded mode
      this.wrapperEl.style.left = '50%';
      this.wrapperEl.style.top = '50%';
      this.wrapperEl.style.right = 'auto';
      this.wrapperEl.style.bottom = 'auto';
      this.wrapperEl.style.transform = 'translate(-50%, -50%)';
      if (this.arrowEl) this.arrowEl.style.display = 'none';
      return;
    }

    if (this.arrowEl) this.arrowEl.style.display = 'block';

    const anchorRect = this.widget.getAnchorRect();
    const bubbleWidth = 390;
    const margin = 14;

    const doc = document.documentElement;
    const winW = doc ? doc.clientWidth : window.innerWidth;
    const winH = doc ? doc.clientHeight : window.innerHeight;

    let targetLeft = 0;
    let targetTop = 0;
    let arrowOnBottom = true;

    if (anchorRect) {
      // Horizontal positioning centered over widget
      const widgetCenterX = anchorRect.left + anchorRect.width / 2;
      targetLeft = Math.max(margin, Math.min(winW - bubbleWidth - margin, widgetCenterX - bubbleWidth / 2));

      // Vertical positioning
      const isBottomHalf = anchorRect.top > winH / 2;
      if (isBottomHalf) {
        // Position above widget
        arrowOnBottom = true;
        const bubbleBottomDist = winH - anchorRect.top + 10;
        this.wrapperEl.style.bottom = `${bubbleBottomDist}px`;
        this.wrapperEl.style.top = 'auto';
      } else {
        // Position below widget
        arrowOnBottom = false;
        targetTop = anchorRect.bottom + 10;
        this.wrapperEl.style.top = `${targetTop}px`;
        this.wrapperEl.style.bottom = 'auto';
      }

      this.wrapperEl.style.left = `${targetLeft}px`;
      this.wrapperEl.style.right = 'auto';
      this.wrapperEl.style.transform = 'none';

      // Position the arrow tail
      if (this.arrowEl) {
        const arrowX = Math.max(16, Math.min(bubbleWidth - 24, widgetCenterX - targetLeft - 7));
        this.arrowEl.style.left = `${arrowX}px`;
        if (arrowOnBottom) {
          this.arrowEl.className = 'besing-bubble-arrow arrow-bottom';
        } else {
          this.arrowEl.className = 'besing-bubble-arrow arrow-top';
        }
      }
    } else {
      // Fallback bottom-right
      this.wrapperEl.style.right = '20px';
      this.wrapperEl.style.bottom = '80px';
      this.wrapperEl.style.left = 'auto';
      this.wrapperEl.style.top = 'auto';
      this.wrapperEl.style.transform = 'none';
      if (this.arrowEl) this.arrowEl.style.display = 'none';
    }
  }

  _renderCurrentView() {
    const body = this.panelEl.querySelector('#besing-modal-body');
    if (!body) return;
    body.innerHTML = '';

    if (this.currentView === 'settings') {
      const settingsView = new BESSettingsView({
        storage: this.storage,
        syncEngine: this.syncEngine,
        onBack: () => {
          this.currentView = 'extensions';
          this.panelEl.querySelector('#besing-btn-toggle-settings').classList.remove('active');
          this._renderCurrentView();
        },
        onDisableCurrentSite: (host) => {
          this.close();
          if (typeof this.onDisableCurrentSite === 'function') {
            this.onDisableCurrentSite(host);
          }
        },
        onSitesChanged: (host, action) => {
          if (typeof this.onSitesChanged === 'function') {
            this.onSitesChanged(host, action);
          }
        },
        onThemeChanged: (theme) => {
          if (typeof this.onThemeChanged === 'function') {
            this.onThemeChanged(theme);
          }
        }
      });
      body.appendChild(settingsView.render());
    } else {
      this._renderExtensionsView(body);
    }
  }

  _renderExtensionsView(body) {
    // Search input
    const searchWrap = document.createElement('div');
    searchWrap.className = 'besing-search-wrap';
    const searchSvg = this.createSVG(`<svg class="besing-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`);
    if (searchSvg) searchWrap.appendChild(searchSvg);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'besing-search-input';
    searchInput.placeholder = 'Search installed extensions...';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this._updateListItems(listContainer);
    });
    searchWrap.appendChild(searchInput);
    body.appendChild(searchWrap);

    // Extensions List
    const listContainer = document.createElement('div');
    listContainer.className = 'besing-ext-list';
    body.appendChild(listContainer);

    this._updateListItems(listContainer);
  }

  _updateListItems(listContainer) {
    listContainer.innerHTML = '';
    const allModules = this.registry.getAll();
    const filtered = allModules.filter(m => {
      if (!this.searchQuery) return true;
      return m.name.toLowerCase().includes(this.searchQuery) ||
             m.description.toLowerCase().includes(this.searchQuery);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'besing-empty-state';
      empty.textContent = 'No matching extensions found.';
      listContainer.appendChild(empty);
      return;
    }

    filtered.forEach(mod => {
      const card = document.createElement('div');
      card.className = 'besing-ext-card';

      card.innerHTML = `
        <div class="besing-ext-info-group">
          <div class="besing-ext-icon">${mod.icon}</div>
          <div class="besing-ext-meta">
            <div class="besing-ext-title-row">
              <span class="besing-ext-name">${this._escapeHTML(mod.name)}</span>
              <span class="besing-ext-ver">v${this._escapeHTML(mod.version)}</span>
            </div>
            <p class="besing-ext-desc">${this._escapeHTML(mod.description)}</p>
          </div>
        </div>
        <label class="besing-switch" title="Toggle ${this._escapeHTML(mod.name)}">
          <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-id="${mod.id}">
          <span class="besing-slider"></span>
        </label>
      `;

      const checkbox = card.querySelector('input');
      checkbox.addEventListener('change', async (e) => {
        const isChecked = e.target.checked;
        await this.registry.toggleModule(mod.id, isChecked, this.context);
      });

      listContainer.appendChild(card);
    });
  }

  _onDocumentClick(e) {
    if (!this.wrapperEl) return;
    const path = e.composedPath ? e.composedPath() : [];
    // If click was inside panel or inside widget, don't close
    const clickedInside = path.includes(this.wrapperEl) || 
      (this.widget && this.widget.el && path.includes(this.widget.el));
    if (!clickedInside) {
      this.close();
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  close() {
    this.destroy();
    if (typeof this.onClose === 'function') {
      this.onClose();
    }
  }

  destroy() {
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.wrapperEl) {
      this.wrapperEl.remove();
      this.wrapperEl = null;
    }
  }

  _escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  safeParseHTML(htmlStr) {
    if (!htmlStr) return document.createDocumentFragment();
    const frag = document.createDocumentFragment();
    const svgNS = 'http://www.w3.org/2000/svg';

    const tokenRegex = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z0-9\-:]+)([^>]*?)(\/?>)|([^<]+)/g;
    const attrRegex = /([a-zA-Z0-9\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

    const voidElements = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
      'link', 'meta', 'param', 'source', 'track', 'wbr',
      'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'stop'
    ]);

    const stack = [{ node: frag, inSVG: false }];
    let match;

    while ((match = tokenRegex.exec(htmlStr)) !== null) {
      if (match[0].startsWith('<!--')) continue;
      if (match[5]) {
        const text = match[5];
        if (text) {
          stack[stack.length - 1].node.appendChild(document.createTextNode(text));
        }
        continue;
      }

      const isClosing = match[1] === '/';
      const rawTagName = match[2];
      const tagName = rawTagName ? rawTagName.toLowerCase() : '';
      const rawAttrs = match[3];
      const isSelfClosing = (match[4] && match[4].startsWith('/')) || voidElements.has(tagName);

      if (isClosing) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tagName === tagName) {
            stack.length = i;
            break;
          }
        }
      } else if (tagName) {
        const parent = stack[stack.length - 1];
        const isSVGTag = tagName === 'svg' || parent.inSVG;
        
        const el = isSVGTag ? document.createElementNS(svgNS, tagName) : document.createElement(tagName);

        let aMatch;
        attrRegex.lastIndex = 0;
        while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {
          const aName = aMatch[1];
          if (aName === '/' || !aName) continue;
          const aVal = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] !== undefined ? aMatch[4] : ''));
          if (aName.startsWith('on')) continue;
          if (aName === 'class') {
            if (!isSVGTag) el.className = aVal;
            el.setAttribute('class', aVal);
          } else if (aName === 'style') {
            el.style.cssText = aVal;
            el.setAttribute('style', aVal);
          } else if (aName === 'checked') {
            el.checked = true;
          } else if (aName === 'disabled') {
            el.disabled = true;
          } else if (aName === 'selected') {
            el.selected = true;
          } else if (aName === 'value' && (tagName === 'input' || tagName === 'textarea' || tagName === 'select')) {
            el.value = aVal;
            el.setAttribute('value', aVal);
          } else {
            el.setAttribute(aName, aVal);
          }
        }

        parent.node.appendChild(el);

        if (!isSelfClosing) {
          stack.push({ node: el, inSVG: isSVGTag, tagName: tagName });
        }
      }
    }
    return frag;
  }

  createSVG(svgString) {
    if (!svgString) return null;
    const frag = this.safeParseHTML(svgString);
    return frag.querySelector('svg') || frag.firstElementChild || null;
  }
}
