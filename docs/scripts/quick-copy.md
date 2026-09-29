# Markdown Link Copier

**Script Identifier:** `quick-copy`  
**Current Version:** 1.0.0  
**Category:** Tools  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [quick-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/quick-copy/quick-copy.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Markdown Link Copier streamlines note-taking, documentation authoring, and link sharing by capturing the current webpage's title and URL and writing them to the system clipboard formatted as standard Markdown: `[Page Title](URL)`. It is activated globally with a single keyboard shortcut (`Alt + C`) and displays an elegant glass toast notification to confirm the copy operation.

---

## 2. Key Capabilities

| Feature | Description | Trigger / Output |
| :--- | :--- | :--- |
| **Instant Markdown Formatting** | Converts current document title and URL into markdown link format. | Formatted string `[Title](https://example.com)` |
| **Bracket Sanitization** | Automatically strips square brackets (`[` and `]`) from document titles to prevent broken markdown syntax. | `title.replace(/[\[\]]/g, '')` |
| **Global Keyboard Shortcut** | Triggers from anywhere on any active tab without opening menus or focusing address bars. | `Alt + C` |
| **Visual Confirmation Toast** | Displays a top-right floating toast notification displaying the copied title and success checkmark. | Auto-dismisses after 2,000ms |
| **Clipboard API Integration** | Utilizes the asynchronous `navigator.clipboard.writeText` API for clipboard writing. | System clipboard |

---

## 3. How It Works

### Shortcut Handling
The script attaches a `keydown` event listener to `window`:
```javascript
window.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    const title = (document.title || 'Untitled').replace(/[\[\]]/g, '');
    const md = `[${title}](${window.location.href})`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md).then(() => this.toast(title));
    }
  }
});
```

### Visual Toast Architecture
Upon successful clipboard write, a notification node is created:
- **Positioning:** Fixed at `top: 24px; right: 24px; z-index: 999999`.
- **Styling:** Dark slate backdrop (`#0f172a`) with a vibrant cyan border (`rgba(56, 189, 248, 0.4)`), rounded corners, and subtle box shadow.
- **Auto-Dismiss:** Stays visible for 2,000ms, transitions opacity to `0` over 300ms, and cleanly removes itself from the DOM.

---

## 4. Standalone Userscript Usage

To install standalone in Tampermonkey or Violentmonkey:
1. Paste the source code from [quick-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/quick-copy/quick-copy.user.js).
2. The script runs at `document-idle` across all websites (`*://*/*`).
3. Press `Alt + C` on any page to copy its markdown link.
