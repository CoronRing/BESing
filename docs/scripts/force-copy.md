# Force Allow Copy & Paste

**Script Identifier:** `force-copy`  
**Current Version:** 1.0.0  
**Category:** Tools  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [force-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/force-copy/force-copy.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Force Allow Copy & Paste unlocks text selection, copy, cut, paste, and right-click context menus on websites that attempt to restrict them. Many academic portals, documentation sites, online tests, and banking forms deploy aggressive JavaScript and CSS rules to block standard clipboard operations. This script intercepts and neutralizes those restrictions in the event capture phase while injecting universal text selection styles.

---

## 2. Key Capabilities

| Feature | Description | Protection Layer |
| :--- | :--- | :--- |
| **Unlock Text Selection** | Restores cursor selection and highlighting across all text nodes and headings. | CSS override (`user-select: text !important`) + `selectstart` capture |
| **Unlock Copy & Cut** | Guarantees clipboard writing via `Ctrl+C`, `Cmd+C`, `Ctrl+X`, and browser edit menus. | `copy` and `cut` capture + shortcut event bubbling |
| **Unlock Paste** | Re-enables clipboard pasting into protected input boxes, password fields, and text areas. | `paste` capture interceptor |
| **Unlock Right-Click Menu** | Bypasses custom right-click event blockers to restore the native browser context menu. | `contextmenu` capture interceptor |
| **Inline Handler Sanitization** | Continuously nullifies inline attributes like `oncopy="return false;"` and `oncontextmenu="return false;"`. | Periodic sweeping every 2,000ms |
| **Embedded Testing Sandbox** | In-menu interactive test area with selectable text and a paste input field to verify operations immediately. | Secondary configuration menu |

---

## 3. How It Works

Host websites typically block clipboard actions using two methods: CSS `user-select: none` and JavaScript event prevention (`e.preventDefault()`). This script counters both:

### 1. High-Priority CSS Style Injection
Injects a stylesheet with maximum specificity to override inline and stylesheet blocking rules:
```css
*, *::before, *::after {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  -webkit-touch-callout: default !important;
}
input, textarea, [contenteditable="true"] {
  -webkit-user-select: auto !important;
  user-select: auto !important;
}
```

### 2. Capture-Phase Event Interception
Standard event listeners in JavaScript run during the *bubbling* phase. By registering listeners in the *capture* phase (`capture: true`), the script intercepts events as they travel down the DOM hierarchy before reaching the host page's scripts:
```javascript
const handleCapture = (e) => {
  if (e.type === 'copy' || e.type === 'cut') {
    if (this._config.allowCopy) e.stopImmediatePropagation();
  } else if (e.type === 'paste') {
    if (this._config.allowPaste) e.stopImmediatePropagation();
  } else if (e.type === 'contextmenu') {
    if (this._config.allowContextMenu) e.stopImmediatePropagation();
  } else if (e.type === 'selectstart' || e.type === 'selectionchange') {
    if (this._config.allowSelect) e.stopImmediatePropagation();
  }
};
```
Calling `e.stopImmediatePropagation()` halts event propagation, ensuring host scripts never receive the event and cannot call `e.preventDefault()`.

### 3. Keyboard Shortcut Guard
Catches `keydown` events for `Ctrl+C`, `Ctrl+V`, `Ctrl+X`, and `Ctrl+A` (as well as `Cmd` on macOS), ensuring keyboard clipboard actions proceed uninterrupted.

---

## 4. Configuration & Controls

In the BESing secondary menu for **Force Allow Copy & Paste**:
- **Force Allow Text Selection:** Toggle switch for enabling cursor text dragging and highlighting.
- **Force Allow Copy & Cut:** Toggle switch for clipboard copying and cutting.
- **Force Allow Paste:** Toggle switch for pasting clipboard contents into forms.
- **Allow Right-Click Context Menu:** Toggle switch for restoring native browser right-click options.
- **Selection & Copy Sandbox:** A dedicated test box with sample text to test `Ctrl+C` and an input field to verify `Ctrl+V` pasting directly inside the menu.

---

## 5. Standalone Userscript Usage

To use standalone in your browser without the BESing manager:
1. Copy [force-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/force-copy/force-copy.user.js) into your userscript manager.
2. The script runs at `document-idle` on `*://*/*` with all copy, paste, select, and context menu options active by default.
3. You can customize the enabled flags in the script header:
```javascript
ForceCopy.init({
  allowSelect: true,
  allowCopy: true,
  allowPaste: true,
  allowContextMenu: false // Keep custom context menu if desired
});
```
