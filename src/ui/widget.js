/**
 * BESing - Edge-Folding Trigger Widget & Desktop Pet
 * Full Desktop & Mobile (iOS / Android / Edge Mobile) Touch Support
 */

export class BESWidget {
  constructor({ storage, onClick }) {
    this.storage = storage;
    this.onClick = onClick;
    this.el = null;
    this.badgeEl = null;
    this.avatarContainer = null;
    this.theme = this.storage.getTheme() || 'cyber-pet';

    // Drag state
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.initialLeft = 0;
    this.initialTop = 0;
    this.hasMoved = false;
    this._idleFoldTimer = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onMouseEnter = this._onMouseEnter.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
  }

  render(container) {
    const trigger = document.createElement('div');
    trigger.className = 'besing-trigger';
    trigger.setAttribute('title', 'BESing Hub & Desktop Pet (Tap to open, Drag to reposition)');

    const avatar = document.createElement('div');
    avatar.className = 'besing-avatar-wrap';
    trigger.appendChild(avatar);
    this.avatarContainer = avatar;

    const badge = document.createElement('div');
    badge.className = 'besing-badge-count';
    badge.style.display = 'none';
    badge.textContent = '0';
    trigger.appendChild(badge);
    this.badgeEl = badge;

    this.el = trigger;

    this.setTheme(this.theme);
    this._applyInitialPosition();

    // Universal Pointer Events
    trigger.addEventListener('pointerdown', this._onPointerDown);

    // Fallback explicit Touch Events for mobile browsers (iOS Safari, Android Chrome/Edge)
    trigger.addEventListener('touchstart', this._onTouchStart, { passive: false });
    trigger.addEventListener('touchmove', this._onTouchMove, { passive: false });
    trigger.addEventListener('touchend', this._onTouchEnd);
    trigger.addEventListener('touchcancel', this._onTouchEnd);

    // Desktop hover events
    trigger.addEventListener('mouseenter', this._onMouseEnter);
    trigger.addEventListener('mouseleave', this._onMouseLeave);

    container.appendChild(trigger);
    this._checkEdgeFolding();

    return trigger;
  }

  setTheme(themeName) {
    this.theme = themeName;
    if (!this.avatarContainer) return;
    this.avatarContainer.innerHTML = this._getThemeMarkup(themeName);
  }

  _getThemeMarkup(theme) {
    switch (theme) {
      case 'cyber-pet':
        return `
          <svg class="besing-pet-face" width="28" height="28" viewBox="0 0 32 32" fill="none">
            <path d="M7 10L10 4L14 9" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M25 10L22 4L18 9" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="5" y="8" width="22" height="18" rx="8" fill="#1e1b4b" stroke="#818cf8" stroke-width="1.5"/>
            <ellipse class="besing-pet-eye" cx="11.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/>
            <ellipse class="besing-pet-eye" cx="20.5" cy="16.5" rx="2.5" ry="3.5" fill="#38bdf8"/>
            <circle cx="9" cy="20.5" r="1.2" fill="#f43f5e" opacity="0.65"/>
            <circle cx="23" cy="20.5" r="1.2" fill="#f43f5e" opacity="0.65"/>
          </svg>
        `;
      case 'orb':
        return `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#818cf8" stroke-width="1.8" stroke-dasharray="3 3"/>
            <circle cx="12" cy="12" r="6" fill="#6366f1" opacity="0.85"/>
            <circle cx="10" cy="10" r="2" fill="#ffffff" opacity="0.9"/>
          </svg>
        `;
      case 'crystal':
        return `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round">
            <polygon points="12 2 20 8 16 22 8 22 4 8 12 2"/>
            <polyline points="4 8 12 12 20 8"/>
            <line x1="12" y1="12" x2="12" y2="22"/>
          </svg>
        `;
      case 'minimal':
      default:
        return `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5">
            <circle cx="12" cy="12" r="4" fill="#6366f1"/>
          </svg>
        `;
    }
  }

  updateActiveCount(count) {
    if (!this.badgeEl) return;
    if (count > 0) {
      this.badgeEl.textContent = String(count);
      this.badgeEl.style.display = 'flex';
    } else {
      this.badgeEl.style.display = 'none';
    }
  }

  getAnchorRect() {
    return this.el ? this.el.getBoundingClientRect() : null;
  }

  _getViewport() {
    const doc = document.documentElement;
    const clientWidth = doc ? doc.clientWidth : window.innerWidth;
    const clientHeight = doc ? doc.clientHeight : window.innerHeight;
    return { clientWidth, clientHeight };
  }

  _applyInitialPosition() {
    const savedPos = this.storage.getWidgetPosition();
    const { clientWidth, clientHeight } = this._getViewport();
    const widgetSize = 48;
    const padding = 16;

    let x = clientWidth - widgetSize - padding;
    let y = clientHeight - widgetSize - padding - 60;

    if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
      x = Math.max(0, Math.min(clientWidth - widgetSize, savedPos.x));
      y = Math.max(8, Math.min(clientHeight - widgetSize - 8, savedPos.y));
    }

    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  _startDrag(clientX, clientY) {
    this.isDragging = true;
    this.hasMoved = false;
    this.startX = clientX;
    this.startY = clientY;

    const rect = this.el.getBoundingClientRect();
    this.initialLeft = rect.left;
    this.initialTop = rect.top;

    this.el.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
  }

  _moveDrag(clientX, clientY) {
    if (!this.isDragging) return;

    const dx = clientX - this.startX;
    const dy = clientY - this.startY;

    if (!this.hasMoved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      this.hasMoved = true;
    }

    if (this.hasMoved) {
      const widgetSize = 48;
      const { clientWidth, clientHeight } = this._getViewport();
      let newLeft = this.initialLeft + dx;
      let newTop = this.initialTop + dy;

      newLeft = Math.max(0, Math.min(clientWidth - widgetSize, newLeft));
      newTop = Math.max(8, Math.min(clientHeight - widgetSize - 8, newTop));

      this.el.style.left = `${newLeft}px`;
      this.el.style.top = `${newTop}px`;
    }
  }

  _endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (this.hasMoved) {
      const rect = this.el.getBoundingClientRect();
      this.storage.setWidgetPosition({ x: rect.left, y: rect.top });
      this._checkEdgeFolding();
    } else {
      if (typeof this.onClick === 'function') {
        this.onClick();
      }
    }
  }

  // Pointer events
  _onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._startDrag(e.clientX, e.clientY);
    try { this.el.setPointerCapture(e.pointerId); } catch (err) {}
    this.el.addEventListener('pointermove', this._onPointerMove);
    this.el.addEventListener('pointerup', this._onPointerUp);
    this.el.addEventListener('pointercancel', this._onPointerUp);
  }

  _onPointerMove(e) {
    this._moveDrag(e.clientX, e.clientY);
  }

  _onPointerUp(e) {
    try { this.el.releasePointerCapture(e.pointerId); } catch (err) {}
    this.el.removeEventListener('pointermove', this._onPointerMove);
    this.el.removeEventListener('pointerup', this._onPointerUp);
    this.el.removeEventListener('pointercancel', this._onPointerUp);
    this._endDrag();
  }

  // Explicit Mobile Touch Handlers
  _onTouchStart(e) {
    if (e.touches && e.touches.length === 1) {
      const t = e.touches[0];
      this._startDrag(t.clientX, t.clientY);
    }
  }

  _onTouchMove(e) {
    if (this.isDragging && e.touches && e.touches.length === 1) {
      // Prevent mobile page scroll while dragging widget
      e.preventDefault();
      const t = e.touches[0];
      this._moveDrag(t.clientX, t.clientY);
    }
  }

  _onTouchEnd(e) {
    this._endDrag();
  }

  _onMouseEnter() {
    clearTimeout(this._idleFoldTimer);
    this.el.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');
  }

  _onMouseLeave() {
    this._idleFoldTimer = setTimeout(() => {
      this._checkEdgeFolding();
    }, 1200);
  }

  _checkEdgeFolding() {
    if (!this.el || this.isDragging) return;
    const rect = this.el.getBoundingClientRect();
    const { clientWidth, clientHeight } = this._getViewport();
    const threshold = 40;

    const isNearLeft = rect.left <= threshold;
    const isNearRight = rect.right >= clientWidth - threshold;
    const isNearTop = rect.top <= threshold;
    const isNearBottom = rect.bottom >= clientHeight - threshold;

    this.el.classList.remove('folded-left', 'folded-right', 'folded-top', 'folded-bottom');

    if (isNearLeft) this.el.classList.add('folded-left');
    if (isNearRight) this.el.classList.add('folded-right');
    if (isNearTop) this.el.classList.add('folded-top');
    if (isNearBottom) this.el.classList.add('folded-bottom');
  }

  destroy() {
    clearTimeout(this._idleFoldTimer);
    if (this.el) {
      this.el.removeEventListener('pointerdown', this._onPointerDown);
      this.el.removeEventListener('touchstart', this._onTouchStart);
      this.el.removeEventListener('touchmove', this._onTouchMove);
      this.el.removeEventListener('touchend', this._onTouchEnd);
      this.el.removeEventListener('mouseenter', this._onMouseEnter);
      this.el.removeEventListener('mouseleave', this._onMouseLeave);
      this.el.remove();
      this.el = null;
    }
  }
}
