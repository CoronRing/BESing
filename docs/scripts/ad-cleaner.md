# Ad Cleaner & Element Zapper

**Script Identifier:** `ad-cleaner`  
**Current Version:** 1.2.0  
**Category:** Privacy  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [ad-cleaner.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/ad-cleaner/ad-cleaner.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Ad Cleaner & Element Zapper provides two lines of defense against visual web clutter: an automated suppression engine for generic cookie consent modals, newsletter overlays, and floating banners, combined with an interactive point-and-click Element Zapper modeled after uBlock Origin. Users can target and permanently eliminate any annoying element on any website with a single click or keyboard shortcut.

---

## 2. Key Capabilities

| Feature | Description | Trigger / Location |
| :--- | :--- | :--- |
| **Interactive Element Zapper** | Enters point-and-click targeting mode with precision crosshair and highlight box to zap any DOM element permanently. | `Alt + Z` shortcut or **⚡ Launch Element Zapper** button in secondary menu |
| **Floating Zapper HUD** | Fixed top-center status bar displaying operational status, live keyboard hints, and an explicit Exit button. | Top center of screen during targeting mode |
| **Target Precision Highlighter** | Real-time red bounding box tracking the element under cursor, accompanied by an identification badge showing the computed selector and dimensions. | Follows cursor during targeting mode |
| **Resilient Selector Engine** | Computes unique CSS selectors prioritizing clean HTML IDs, stable class combinations, and nth-child parent paths while excluding dynamic IDs. | Automatic upon hover and click |
| **Automatic Persistence** | Saves zapped selectors directly to BESing persistent storage under the current website domain. | Automatic upon zap (via UI or `Alt + Z`) |
| **Secondary Menu Management** | Displays a scrollable list of all zapped selectors on the current domain, with individual restore controls and a master wipe button. | Secondary configuration menu for Ad Cleaner |
| **Auto-Clean Overlays** | Automatically suppresses standard cookie banners, consent modals, newsletter prompts, and marketing popups using pre-configured CSS rules. | Toggle switch in secondary configuration menu |

---

## 3. How It Works

### Targeting and Selection Engine

When activated, the Element Zapper sets the document cursor to `crosshair` and mounts two high-priority visual elements:
1. `#besing-zapper-hud`: Anchored at top center (`position: fixed; z-index: 2147483647`). It explains the controls: hover to target, left-click to zap, and escape or right-click to exit.
2. `#besing-zapper-highlight`: A floating bounding box (`z-index: 2147483646; pointer-events: none`) that aligns with `elementFromPoint(clientX, clientY)`.

Hovering over any element calculates a selector using the `computeSelector(el)` algorithm:
- If the element possesses a valid HTML `id` that does not start with digits or contain `__besing`, it uses `#id`.
- If the element has distinct CSS classes (excluding framework utilities and `besing-` prefixes), it evaluates a multi-class selector.
- If classes are absent or shared across many elements, it constructs a parent-relative `nth-child` hierarchical path.

### Click-to-Zap Sequence

1. **Click Capture:** The click event is intercepted in the capture phase (`capture: true`), preventing host page navigation or click triggers.
2. **Shrink Animation:** The targeted element receives a smooth transition (`transform: scale(0.88); opacity: 0; transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1)`).
3. **DOM Hiding:** After 220ms, the element is hidden (`display: none !important; visibility: hidden !important;`).
4. **Style Sheet Injection:** The computed selector is appended to the active `<style id="besing-ad-cleaner-style">` element in `document.head`.
5. **Storage Sync:** The selector list is saved into persistent storage for the current hostname under `siteRules[host].configs['ad-cleaner'].blockedSelectors`.

---

## 4. Configuration & Controls

The script is managed through its secondary configuration panel in the BESing interface:

- **Launch Button:** A primary crimson button titled **⚡ Launch Element Zapper**. Clicking this immediately closes the manager popover and initiates targeting mode.
- **Auto-Clean Toggle:** A toggle switch for `enableAutoClean` (default enabled). When switched on, generic rules targeting cookie bars (`[class*="cookie-banner"]`, `[class*="consent-banner"]`, `[class*="popup-overlay"]`, `.ad-banner`) are active.
- **Zapped Elements List:** A scrollable list showing each custom-zapped selector on the current website in monospace format:
  - **Individual Restore (`✕`):** Removes that single selector from the blocked list and restores the element on the page.
  - **Clear All:** Clears all blocked selectors for the current website, instantly restoring all previously zapped elements.

---

## 5. Keyboard Shortcuts

- **`Alt + Z`**: Toggle the Element Zapper on or off from any webpage.
- **`Escape`**: Dismiss the Zapper HUD and cancel targeting without modifying elements.
- **`Right-Click`**: Context click during targeting mode immediately cancels and exits targeting mode.

---

## 6. Standalone Userscript Usage

This script functions independently in Tampermonkey, Violentmonkey, or Greasemonkey without requiring the full BESing manager runtime.

To install standalone:
1. Open your userscript manager dashboard.
2. Create a new script and paste the contents of [ad-cleaner.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/ad-cleaner/ad-cleaner.user.js).
3. Save the script. The script activates on `*://*/*` at `document-idle`. You can use `Alt + Z` to zap elements on any website.
