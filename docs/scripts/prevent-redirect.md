# Prevent Redirect & Tab Hijack

**Script Identifier:** `prevent-redirect`  
**Current Version:** 1.2.0  
**Category:** Security  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Prevent Redirect & Tab Hijack shields users from deceptive redirects, forced new-tab popups, ad-network clickjacking, and evasive mobile-specific redirect vectors. Aggressive ad networks (particularly on mobile web portals and novel/reading sites like `shudugu.org`) deploy multi-stage injection scripts that bypass simple popup blockers by using WebSocket tunnels on non-standard ports, dynamic `<script>` insertion, invisible fixed fullscreen touch tiles, `devicemotion` sensor traps (shake-to-redirect), and direct `top.location` or `window.location.href` assignment. Prevent Redirect v1.2.0 establishes a multi-layered shield operating from `document-start` in both isolated extension and native page execution worlds, neutralizing malicious script injections before execution, disabling mobile motion sensor traps, suppressing invisible touch overlay tiles, and intercepting unauthorized automatic redirects while keeping legitimate intra-site reading and navigation completely seamless.

---

## 2. Key Capabilities

| Feature | Description | Interception Method |
| :--- | :--- | :--- |
| **`document-start` Shielding** | Initializes hooks before any inline or external page scripts execute, preventing early ad scripts from taking over window navigation. | Userscript `@run-at document-start` & early `app.init()` |
| **Dynamic Script & Iframe Neutralization** | Neutralizes dynamic `<script>` and `<iframe>` injections pointing to known ad/redirect tracking domains or evasive non-standard ports (`:8001`, `:8003`, `:8080`, `:8081`). | Hooked `HTMLScriptElement.prototype.src`, `HTMLIFrameElement.prototype.src`, `Node.prototype.appendChild`, `insertBefore` |
| **WebSocket Ad Tunnel Defense** | Intercepts evasive WebSocket connections used by mobile ad networks to fetch encrypted redirect payloads over raw sockets (`:20091`, `:20093`). | Wraps `window.WebSocket` with compliant mock socket |
| **Mobile Sensor Trap Neutralization** | Strips `devicemotion` and `deviceorientation` event listener bindings, stopping mobile "shake-to-redirect" traps entirely. | Proxies `window.addEventListener` and `document.addEventListener` |
| **Invisible Touch Tile Suppression** | Prevents ad scripts from tiling the viewport with high z-index, zero-opacity fixed tiles that hijack reading taps into redirects. | Filters `Element.prototype.insertAdjacentHTML` and dynamic overlays |
| **Popup Window Interception** | Blocks external popup windows spawned via `window.open`. | Monkey-patches `window.open` & `unsafeWindow.open` |
| **Mock Window Spoofing** | Returns a functional mock window object with dummy methods (`focus`, `close`, `postMessage`, `location`) so ad scripts do not trigger fallback `location.href` assignments. | Synthetic `_createFakeWindow(url)` |
| **Programmatic Click Interception** | Blocks deceptive JavaScript triggers that invoke `.click()` on hidden external anchor tags. | Wraps `HTMLAnchorElement.prototype.click` and `HTMLElement.prototype.click` |
| **Location Assign Interception** | Blocks scripts attempting to force-redirect the current page to another domain via `location.assign` or `location.replace`. | API proxy guard on `Location.prototype` |
| **Unprompted Auto-Redirect Interceptor** | Tracks intentional user clicks on same-origin links and intercepts unprompted background `location.href` assignments. | `window.addEventListener('beforeunload', ...)` with user click correlation |
| **Same-Host Whitelisting** | Automatically allows valid same-origin and sub-domain links, intra-page anchors (`#`), and protocol links (`mailto:`, `tel:`). | Sub-domain and hostname evaluation |
| **Main-World Page Context Guard** | Injects an active prototype guard into the page's native window scope to neutralize main-world inline scripts. | Document-start `<script>` injection with automatic self-cleanup |

---

## 3. How It Works

### The Evasive Mobile Redirect Vector
Standard ad blockers and traditional userscripts running at `document-idle` fail against modern mobile ad networks because:
1. **Timing**: Ad scripts inject dynamically during initial HTML parsing or via inline loaders (such as `/config/v7.js`), triggering before `document-idle` userscripts execute.
2. **Non-Configurable `location.href`**: In modern browser engines, `window.location.href` and `top.location` have `configurable: false` and cannot be redefined via `Object.defineProperty`.
3. **The `window.open` Fallback Trap**: When `window.open` is blocked by the browser and returns `null`, the ad script immediately executes its fallback branch: `top.location != self.location ? top.location = purl : window.location.href = purl`.
4. **Sensor and Invisible Overlay Traps**: Scripts attach `devicemotion` listeners or inject dozens of tiny fixed `opacity: 0.01` tiles across the viewport so that scrolling or holding the phone triggers the redirect.

### The Multi-Layered Defense Architecture
Prevent Redirect v1.2.0 neutralizes this through five coordinated mechanisms:
1. **Preemptive Prototype Hooks at `document-start`**: Prototype setters for `HTMLScriptElement.prototype.src` and `HTMLIFrameElement.prototype.src` are hooked immediately. When an ad loader attempts to assign a URL containing ad networks (`lkg6odg.com`, `kt6th8f.com`, `comprelu.cc`, etc.) or ad tracking ports (`:8001`, `:8003`), the value is neutralized to `'data:text/javascript,/*besing-blocked*/'`. The ad script never executes.
2. **WebSocket Tunnel Neutralization**: Evasive WebSocket connections to ad coordination servers (`wss://...:20091`, `:20093`) return an inert mock socket in a closed state, cutting off encrypted payload delivery.
3. **Motion Trap Neutralization**: Calls to `window.addEventListener('devicemotion')` and `'deviceorientation'` are discarded, preventing shake triggers.
4. **Realistic Mock Window Return**: Calls to `window.open(adUrl)` return an object where `closed === false` and mock navigation methods succeed, preventing the script from executing fallback `location.href` assignments.
5. **Legitimate User Navigation Preservation**: When a user physically clicks a legitimate chapter or internal link, `_recordUserClick` arms a 3-second intentional navigation window. Legitimate same-origin navigation proceeds without hindrance, while unprompted background `beforeunload` navigation hijacks are intercepted.

---

## 4. Standalone Userscript Usage

To run standalone without the BESing manager:
1. Install [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js) in Tampermonkey or Violentmonkey.
2. The script runs at `@run-at document-start` on `*://*/*`.
3. Inspect blocked redirects in the browser developer console under `[BESing Prevent Redirect] Blocked ...`.
