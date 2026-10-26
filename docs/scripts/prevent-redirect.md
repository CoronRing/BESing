# Prevent Redirect & Tab Hijack

**Script Identifier:** `prevent-redirect`  
**Current Version:** 1.7.0  
**Category:** Security  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Prevent Redirect & Tab Hijack shields users from deceptive redirects, forced new-tab popups, ad-network clickjacking, and evasive mobile-specific redirect vectors. Aggressive ad networks (particularly on mobile web portals and novel/reading sites like `shudugu.org`) deploy multi-stage injection scripts that bypass simple popup blockers by using WebSocket tunnels on non-standard ports (`:20091`, `:20093`, `:8887`), dynamic base64 decryption executed through dynamic `new Function()` evaluation, delayed timers (`compel_skip_delay`, `seo_skip_delay`), invisible fixed fullscreen touch tiles, `devicemotion` sensor traps (shake-to-redirect), and direct `top.location` or `window.location.href` assignment. Crucially, modern browser engines do not cancel programmatic navigation via `beforeunload` if no user gesture was performed on that frame; Chromium silently drops the confirmation dialog and allows the redirection to proceed. Therefore, Prevent Redirect v1.3.0 establishes an airtight defense operating from `document-start` in both isolated extension and native page execution worlds, neutralizing dynamic code evaluation constructors, disarming delayed auto-redirect timers, dropping malicious touch listeners, suppressing invisible overlay tiles, and severing WebSocket tunneling before harmful redirect code can ever run.

---

## 2. Key Capabilities

| Feature | Description | Interception Method |
| :--- | :--- | :--- |
| **`document-start` Shielding** | Initializes hooks before any inline or external page scripts execute, preventing early ad scripts from taking over window navigation. | Userscript `@run-at document-start` & early `app.init()` |
| **Dynamic `new Function()` Payload Interceptor** | Analyzes dynamically constructed functions before execution and returns an inert no-op function if ad redirect patterns or evasive parameters (`_tdcs`, `purl`, `target=1`, `compel_skip_delay`) are detected. | Intercepted `window.Function` & `unsafeWindow.Function` |
| **Delayed Redirect Timer Suppression** | Intercepts `setTimeout` and `setInterval` handlers, scanning callback code for auto-redirect tokens and discarding malicious delayed timers entirely. | Hooked `window.setTimeout`, `unsafeWindow.setTimeout`, `setInterval` |
| **Malicious Event Listener Dropper** | Checks event listener functions attached to `window` or `document` and discards any listener whose source contains ad redirect keywords, preventing delayed click/touch hijacking. | Wrapped `EventTarget.prototype.addEventListener` |
| **WebSocket Ad Tunnel Defense** | Intercepts evasive WebSocket connections used by mobile ad networks to fetch encrypted redirect payloads over raw sockets (`:20091`, `:20093`, `:8887`, `:8001`, `:8003`). | Wraps `window.WebSocket` with compliant mock socket |
| **Dynamic Script & Iframe Neutralization** | Neutralizes dynamic `<script>` and `<iframe>` injections pointing to known ad/redirect tracking domains or evasive non-standard ports. | Hooked `HTMLScriptElement.prototype.src`, `HTMLIFrameElement.prototype.src`, `Node.prototype.appendChild`, `insertBefore` |
| **Mobile Sensor Trap Neutralization** | Strips `devicemotion` and `deviceorientation` event listener bindings, stopping mobile "shake-to-redirect" traps entirely. | Proxies `window.addEventListener` and `document.addEventListener` |
| **Invisible Touch Tile Suppression** | Prevents ad scripts from tiling the viewport with high z-index, zero-opacity fixed tiles that hijack reading taps into redirects. | Filters `Element.prototype.insertAdjacentHTML` and dynamic overlays |
| **Popup Window Interception** | Blocks popup windows and new tabs spawned via `window.open`, `anchor.click()` or new-tab links. A new tab to a page on the same site is allowed when the user tapped or clicked (see "Same-Site New Tabs"). | Monkey-patches `window.open` & `unsafeWindow.open`, click and auxclick guards |
| **Mock Window Spoofing** | Returns a functional mock window object with dummy methods (`focus`, `close`, `postMessage`, `location`) so ad scripts do not trigger fallback `location.href` assignments. | Synthetic `_createFakeWindow(url)` |
| **Programmatic Click Interception** | Blocks deceptive JavaScript triggers that invoke `.click()` on hidden external anchor tags. | Wraps `HTMLAnchorElement.prototype.click` and `HTMLElement.prototype.click` |
| **Location Assign Interception** | Blocks scripts attempting to force-redirect the current page to another domain via `location.assign` or `location.replace`. | API proxy guard on `Location.prototype` |
| **Same-Host Whitelisting** | Automatically allows valid same-origin and sub-domain links, intra-page anchors (`#`), and protocol links (`mailto:`, `tel:`). | Sub-domain and hostname evaluation |
| **Main-World Page Context Guard** | Hooks the page's own `window.open`, `Function`, timers, listeners, WebSocket and script loading, which an isolated JS world cannot reach. Follows the module: turning Prevent Redirect off switches the guard's hooks off too. | Userscript: document-start `<script>` injection. Extension: MAIN-world content script `pr-main.js` (see "Extension Page-World Guard") |
| **Late-Start Navigation Guard** | Cancels script-driven navigations that leave the site (or go to known ad URLs) at the moment they start, including redirects scheduled by timers or tap handlers registered before BESing was injected. Tapped links, form posts, reloads, back/forward and downloads pass through. Needs the Navigation API (Chrome/Edge, Firefox 147, Safari and iOS 26.2+). | `navigation` `navigate` event with `preventDefault()` |
| **Existing Trap Sweep** | Removes invisible tap overlays and ad iframes that were already in the page when the module started, at init and again at `DOMContentLoaded`. | `querySelectorAll` sweep (`_sweepExisting`) |
| **Strict: Block Page Scripts** | Off by default. Stops scripts from other sites, or all page scripts, before they run. | DOM observer at document-start, `appendChild`/`insertBefore` and `script.src` hooks |
| **Strict: Late Start** | Off by default. When BESing starts after the page, cancels the page's pending timers, or also swaps in a script-free copy of the page. | Timer id sweep, sanitized `cloneNode` of `<html>` |
| **Missed Navigation Report** | Off-site navigations the browser would not let the guard cancel are written to the debug log as `MISSED`. | `navigate` event with `cancelable: false` |

---

## 3. How It Works

### The Evasive Mobile WebSocket & `new Function` Vector
Standard ad blockers and traditional userscripts running at `document-idle` fail against modern mobile ad networks because:
1. **Timing & Obfuscation**: Ad loaders such as `/config/v7.js` cycle cookies and dynamically open WebSockets to rotating subdomains on custom ports (e.g., `wss://*.qq26oeg.com:20093` or `wss://*.oybhpsij.com:8887`).
2. **Dynamic Decryption**: The server streams base64 encrypted JavaScript, which the loader decrypts in memory and executes via `new Function("_tdcs", payload)(config)`.
3. **Delayed Execution**: Inside the decrypted payload, timers (`setTimeout(function() { top.location = purl + "&target=1"; }, 1e3 * compel_skip_delay)`) wait 3 to 5 seconds before hijacking the page.
4. **Browser Engine Bypass**: In modern Chromium engines, `window.addEventListener('beforeunload')` cannot silently prevent programmatic navigation without an active user gesture; Chromium discards the confirmation dialog and navigates anyway.

### The v1.3.0 Multi-Layered Defense Architecture
Prevent Redirect v1.3.0 eliminates the threat at the root by disarming execution before `location.href` is ever reached:
1. **Dynamic Payload Neutralization via `Function` Interception**: When `new Function(..., code)` is invoked, the constructor inspects the source code. If signatures matching redirect payloads (`_tdcs`, `purl`, `target=1`, `compel_skip_delay`, `seo_skip_delay`) are found, a safe no-op function is returned instead of executable code.
2. **Auto-Redirect Timer Dropper**: Any `setTimeout` or `setInterval` callback whose code string contains redirect triggers is dropped immediately and returns ID 0.
3. **Listener Filtering**: Calls to `addEventListener` for `click`, `touchend`, `devicemotion`, or `deviceorientation` with ad signatures are intercepted and suppressed.
4. **WebSocket Tunnel Neutralization**: Evasive WebSocket connections to ad coordination servers return an inert mock socket in a closed state, cutting off encrypted payload delivery.
5. **Realistic Mock Window Return**: Calls to `window.open(adUrl)` return an object where `closed === false` and mock navigation methods succeed, preventing fallback redirection triggers.
6. **Legitimate User Navigation Preservation**: When a user physically clicks a legitimate chapter or internal link, `_recordUserClick` arms a 3-second intentional navigation window so natural reading flows unhindered.

### Late Injection (v1.5.0)
Every hook above has to be installed before the page's ad code runs. Userscript managers on iOS (Stay in Edge, for example) cannot guarantee `document-start`: in a field log, 9 of 20 loads started BESing after the page had parsed (`readyState` `interactive` or `complete`), so the ad code had already scheduled its redirect timers and registered its tap traps. Those cannot be found or unregistered afterwards.

Two defenses do not depend on timing:
1. **Navigation guard**: the Navigation API's `navigate` event fires when any navigation starts, whatever code triggered it, and `preventDefault()` cancels it. The guard cancels navigations that leave the current site or go to a known ad URL, unless they are reloads, back/forward, downloads, form submissions, or (for non-ad URLs) links the user tapped. This matches the module's existing policy, which already blocks external link clicks, external popups and `location.assign`/`replace`; it extends that to `location.href` and `top.location` assignments, which cannot be hooked. Browsers without the Navigation API (before Safari / iOS 26.2) do not get this guard; BESing's debug log shows `nav-guard-on` or `NAV-GUARD-OFF`.
2. **Trap sweep**: invisible fixed or absolute overlays (opacity `0` or `0.01`) and iframes pointing at ad URLs that are already in the page are removed.

### Same-Site New Tabs (v1.6.0)
New tabs used to be blocked on every route, including a site's own "open in new tab" links and BESing's own links (PageStream's ↗ on each page divider). A new tab is now allowed when all of these hold:

| Condition | Why |
| :--- | :--- |
| The URL is `http(s)` and on the current site (same host or a subdomain either way) | Ad popups go to other sites. |
| The URL is not an ad or redirect URL (`_isAdOrRedirectUrl`) | Some ad URLs sit on the site's own host. |
| The user caused it: a trusted click, tap or middle-click on the link, or for `window.open` and `anchor.click()`, an active user gesture (`navigator.userActivation.isActive`) | Pop-unders opened by timers or synthetic clicks have no user gesture. |

Blank popups (`window.open()` with no URL, later pointed at an ad) are still blocked, as are all new tabs to other sites. Where the User Activation API is missing, `window.open` and `anchor.click()` new tabs stay blocked; real link taps are still allowed through the trusted-event check.

---

### Strict Protection (v1.7.0)
Some sites still redirect, on desktop as well as mobile. The strict options trade site features for protection, so all are off by default. Use them together with **Lock Settings to This Site** (the script's detail page) so they apply to the problem site only.

| Option | Values | What it does |
| :--- | :--- | :--- |
| **Block Page Scripts** (`blockScripts`) | Off, Other Sites (`third-party`), All Scripts (`all`) | Stops scripts before they run. Other Sites stops scripts whose host is a different site from the page (`img.example.com` and `www.example.com` count as the same site, and so do `a.example.co.uk` and `b.example.co.uk`). All Scripts stops every page script, inline ones included, leaving the server-rendered page. |
| **Always allow scripts from** (`scriptAllowlist`) | Host names, comma separated | Hosts the gate never stops, subdomains included (for example `cdnjs.cloudflare.com`). |
| **If BESing Starts Late** (`lateStart`) | Off, Cancel Timers (`purge-timers`), Rebuild Page (`rebuild`) | Applies only when BESing starts after the page has parsed, in the top frame. Cancel Timers clears every timer and interval the page scheduled, so redirects set for later never fire. Rebuild Page also replaces the page with a sanitized copy of itself. |

**How the gate stops a script.** Browsers run a microtask checkpoint before preparing each parser-inserted `<script>`, which is when BESing's DOM observer runs. The observer changes the element's `type` to `javascript/blocked`, so the browser never prepares it. Scripts that page code inserts are caught by the `appendChild`, `insertBefore` and `script.src` hooks. The browser's preload scanner may still download a blocked file, but it is not executed. The gate needs BESing to start before the page's scripts, which is normal on desktop and not guaranteed on iOS (see "Late Injection"). Stops are counted in the debug log (`gate=third-party gated=N`, plus up to 5 `gated script` events) and shown on the detail page as "Stopped on this page".

**How Rebuild Page works.** It does not download the page again. It copies the live `<html>` (`cloneNode`), so text that scripts already wrote, such as suduguu.com's `document.write` chapter pages, is kept. From the copy it removes scripts, iframes, objects, embeds, meta refresh, script preloads, inline `on*` handlers, `javascript:` URLs and invisible tap-trap overlays. It fills `data-src`, `data-original` and `data-lazy-src` images that lazy loaders had not reached, then swaps the copy in. Listeners the page attached to elements stay with the discarded originals. Listeners on `window` and `document` survive, which is why the timer purge, click guard and navigation guard keep running. BESing re-mounts its widget and restarts its other running modules on the new page. Canvas content, shadow DOM and anything else that needs page scripts is lost.

**When settings are read.** At document-start the manager reads modes and settings synchronously (userscript manager storage, or the extension's localStorage mirror for the site) and arms the module with them, so a site lock and the strict options are in force before the page's first script. In the extension the mirror for a site exists after its first visit; on a first visit the gate starts once extension storage answers. The late-start options are applied once, at boot, so a change takes effect from the next page load.

### Extension Page-World Guard (v1.7.0)
Manifest V3 applies the extension's own CSP (`script-src 'self'`) to inline scripts that a content script inserts. The page-world guard, which the module injected as an inline `<script>`, therefore never ran in the extension, on any site. The extension only had the defenses that work through the DOM (click and touch guards, navigation guard, DOM observer, trap sweep), and page code could still call `window.open`, schedule redirect timers, build payloads with `new Function` and open WebSocket tunnels. The userscript was not affected.

The guard now lives in `_guardMain`, a self-contained function between the `<besing-guard>` markers in the module source. The userscript injects it with `toString()`. `build.py` copies it into `extension/pr-main.js`, which the manifest loads as a `"world": "MAIN"` content script before `content.js` (Chrome and Edge 111+). It starts inactive. The module finds it with a `besing:pr-ping` / `besing:pr-pong` event pair (events on `document` reach every JS world), skips the inline injection, and switches it on with `besing:pr-config`, which carries `{ active, mode, allow }` as a JSON string. A site where Prevent Redirect is off never switches it on, and turning the module off live sends `active: false`. The debug log reports `page-guard-ok`, `page-guard-OFF` or `page-guard-MISSING`.

## 4. Standalone Userscript Usage

To run standalone without the BESing manager:
1. Install [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js) in Tampermonkey or Violentmonkey.
2. The script runs at `@run-at document-start` on `*://*/*`.
3. Inspect blocked redirects in the browser developer console under `[BESing Prevent Redirect] Blocked ...`.
4. The standalone script has no settings storage, so the strict options stay off. They need the BESing manager.

---

## 5. Version History

| Version | Changes |
| :--- | :--- |
| 1.7.0 | Strict Protection (script gate with allowlist, late-start timer purge and page rebuild); the extension's page-world guard runs as a MAIN-world content script; the guard follows the module on and off; navigations that cannot be cancelled are logged. |
| 1.6.0 | Same-site new tabs are allowed when the user tapped or clicked. |
| 1.5.0 | Navigation API guard and existing-trap sweep for late injection; the DOM observer skips the module's own guard script. |
