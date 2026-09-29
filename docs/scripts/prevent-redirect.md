# Prevent Redirect & Tab Hijack

**Script Identifier:** `prevent-redirect`  
**Current Version:** 1.1.0  
**Category:** Security  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Prevent Redirect & Tab Hijack shields users from deceptive redirects, forced new-tab popups, and ad-network clickjacking. Many streaming sites, file hosts, and ad-heavy portals execute stealth redirects or spawn background tabs when clicking anywhere on a page. This script wraps critical browser navigation APIs (`window.open`, `location.assign`, `HTMLAnchorElement.prototype.click`) and returns mock window objects so malicious ad scripts believe they succeeded, effectively stopping infinite popup loops.

---

## 2. Key Capabilities

| Feature | Description | Interception Method |
| :--- | :--- | :--- |
| **Popup Window Interception** | Blocks external popup windows spawned via `window.open`. | Monkey-patches `window.open` & `unsafeWindow.open` |
| **Mock Window Spoofing** | Returns a functional mock window object with dummy methods (`focus`, `close`, `postMessage`, `location`) so scripts do not retry. | Synthetic `_createFakeWindow(url)` |
| **Programmatic Click Interception** | Blocks deceptive JavaScript triggers that invoke `.click()` on hidden external anchor tags. | Wraps `HTMLAnchorElement.prototype.click` |
| **Location Assign Interception** | Blocks scripts attempting to force-redirect the current page to another domain via `location.assign` or `location.replace`. | API proxy guard |
| **Clickjacking Capture Shield** | Intercepts left and middle-clicks in the capture phase, validating target hostnames before new tabs spawn. | Capture-phase `click` and `auxclick` listeners |
| **Same-Host Whitelisting** | Automatically allows valid same-origin and sub-domain links, intra-page anchors (`#`), and protocol links (`mailto:`, `tel:`). | Sub-domain and hostname evaluation |
| **Telemetry Event Dispatch** | Dispatches standard DOM events (`besing:redirect-blocked`) whenever a suspicious navigation is suppressed. | `CustomEvent` API |

---

## 3. How It Works

### The Retry Problem in Standard Ad Blockers
When an ad script calls `window.open(url)` and receives `null` or a thrown error, aggressive scripts immediately attempt alternative bypasses: triggering synthetic anchor clicks, attaching inline `onclick` handlers, or redirecting `window.location.href`.

### Mock Window Architecture
To solve this, Prevent Redirect intercepts `window.open` and returns a compliant mock window object:
```javascript
const fake = {
  closed: false,
  opener: window,
  parent: window,
  top: window,
  close() { this.closed = true; },
  focus() {},
  blur() {},
  postMessage() {},
  location: {
    href: url,
    assign() {},
    replace() {},
    reload() {}
  },
  document: {
    open() { return this; },
    close() {},
    write() {},
    createElement(tag) { return document.createElement(tag || 'div'); }
  }
};
```
Because the caller receives an object with `.closed === false` and standard window methods, the ad network assumes the popup succeeded and terminates its retry loops.

### Same-Host Evaluation
The internal helper `_isSameHost(targetUrl)` compares the target URL against the current `window.location.hostname`:
- Allows hash anchors (`#section`), `mailto:`, and `tel:`.
- Allows exact hostname matches (`example.com` $\rightarrow$ `example.com`).
- Allows sub-domains (`sub.example.com` $\rightarrow$ `example.com` and vice-versa).
- Intercepts disparate external domains (e.g. `example.com` $\rightarrow$ `adnetwork-track.biz`).

---

## 4. Standalone Userscript Usage

To run standalone without the BESing manager:
1. Paste [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js) into Tampermonkey or Violentmonkey.
2. The script runs at `document-idle` on `*://*/*`.
3. Inspect blocked redirects in the browser developer console under `[BESing Prevent Redirect] Blocked: ...`.
