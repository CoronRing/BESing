# BESing (Browser Extension Script) Specification & Design

**Version:** 1.5.7  
**Status:** Active  
**Author:** BESing Architecture Team  

---

## 1. Vision & Intention

`BESing` (**B**rowser **E**xtension **S**cript) is a unified framework and script manager designed to bridge the gap between **Userscripts** (Greasemonkey / Tampermonkey / Violentmonkey on Greasy Fork) and native **Browser Extensions** (Chrome / Chromium Manifest V3).

Historically, developers had to choose between writing a userscript or building a full browser extension. Userscripts offer rapid iteration and decentralized distribution via Greasy Fork, while browser extensions offer native browser APIs, packaging, and commercial distribution. 

**BESing** provides a unified script runtime where:
1. **Dual-Compatibility**: A single codebase runs as a Tampermonkey userscript or packs directly as a Chrome Manifest V3 extension.
2. **Draggable & Edge-Folding Widget with Desktop Pet Themes**:
   - The floating trigger is draggable across the screen with unified Pointer and Touch events.
   - When positioned near screen edges or corners, it automatically **folds in** (tucking into the edge like a curious desktop pet), expanding back out with a smooth spring transition on hover.
   - Fully customizable display patterns: **Cyber Pet** (interactive animated eyes with blinking/expressions), **Glowing Orb**, **Prism Crystal**, and **Minimal Dot**.
3. **Non-Blocking Anchored Bubble Menu**:
   - The manager menu opens as an anchored **speech bubble** directly connected to the floating widget with a directional pointer tail.
   - It does **not** freeze or block the underlying website with a heavy dark overlay; the host page remains visible and interactive.
   - A top-right expand toggle allows users to expand the bubble into a full modal when complex configurations are needed.
4. **Targeted Push / Pull Agent Sync Engine**:
   - Connects securely to local or remote AI agents (e.g. `http://localhost:8765/api/sync` or custom agent RPC).
   - Real-time telemetry, full script content extraction (`init.toString()`), remote dynamic script insertion, and remote toggle execution (`set_status`).
5. **Mobile-First Touch Architecture**:
   - Native support for mobile browsers (iOS Safari, Android Edge/Chrome) with touch drag gesture isolation (`e.preventDefault()`) so widget repositioning does not trigger page scrolling or pull-to-refresh.
   - Responsive layouts, min 44px tap targets, and safe-area insets.
6. **Security via Safe Authenticated Connections**:
   - Security stems from authenticated, origin-verified channels (restricted host validation, token authentication, and sandboxed execution) rather than prohibiting live script updates.
7. **Fine-grained Domain Control**:
   - Single-click disable for specific domains. When disabled, the widget and scripts disappear completely from that site.
   - Chronological Blocked Sites manager with instant unblocking and global emergency shortcut (`Alt + Shift + B`).

---

## 2. Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                                 Target Web Page                                   |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                    Shadow DOM Boundary (#__besing_root__)                   |  |
|  |                                                                             |  |
|  |  +-------------------------------+   +-----------------------------------+  |  |
|  |  | Edge-Folding Trigger Widget   |   | Non-Blocking Anchored Bubble Menu |  |  |
|  |  | - Corner fold & peek tab      |   | - Positioned relative to button   |  |  |
|  |  | - Desktop Pet / Orb patterns  |   | - Directional speech arrow        |  |  |
|  |  | - Blinking & idle animations  |   | - Non-blocking page interaction   |  |  |
|  |  | - Touch & pointer drag engine |   | - Compact / Expand toggle         |  |  |
|  |  +---------------+---------------+   +-----------------+-----------------+  |  |
|  |                  |                                     |                    |  |
|  |                  +------------------+------------------+                    |  |
|  |                                     |                                       |  |
|  +-------------------------------------|---------------------------------------+  |
|                                        v                                          |
|  +-----------------------------------------------------------------------------+  |
|  |                           BESing Core Engine                                |  |
|  |                                                                             |  |
|  |   [ BESRegistry ] <---> [ BESStorage ] <---> [ BESAdapter ]                 |  |
|  |          |                                          |                       |  |
|  |          +------------------+                       v                       |  |
|  |                             |               Platform Runtime API:           |  |
|  |                             |               - GM_* storage & commands       |  |
|  |                             |               - chrome.storage.local          |  |
|  |                             v               - localStorage fallback         |  |
|  |                   [ BESSyncEngine ]                                         |  |
|  |                           ^                                                 |  |
|  |                           | (Safe Authenticated RPC /api/sync)              |  |
|  |                           v                                                 |  |
|  |             Local / Remote AI Agent Server                                  |  |
|  |             - GET  /api/sync/status   (Inspect live status & script source) |  |
|  |             - POST /api/sync/command  (Remote toggle & dynamic injection)   |  |
|  |             - POST /api/sync/push     (Telemetry heartbeat from browser)    |  |
|  |             - POST /api/sync/pull     (Browser command polling queue)       |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 3. UI/UX Specifications

### 3.1 4-Direction Edge & Corner Folding Behavior
- **Detection Zone:** When the widget center is within 40px of ANY screen boundary (top, bottom, left, or right), it enters its corresponding `folded` state:
  - **`folded-left`**: Tucks into the left edge (`translateX(-65%)`) with a right indicator tab.
  - **`folded-right`**: Tucks flush against the right edge / scrollbar with a left indicator tab.
  - **`folded-top`**: Tucks into the top of the viewport (`translateY(-65%)`) with a bottom indicator tab (ears/eyes peeking down).
  - **`folded-bottom`**: Tucks into the bottom of the viewport (`translateY(65%)`) with a top indicator tab (pet peeking up).
  - **Corner Folds**: Top-Left, Top-Right, Bottom-Left, and Bottom-Right corner folding via combined transforms (`translate(±55%, ±55%)`).
- **Hover Expansion:** Hovering over any peek tab immediately transitions the widget back onto the screen (`transform: translate(0, 0) scale(1.08)` with spring bezier `cubic-bezier(0.175, 0.885, 0.32, 1.275)`).
- **Idle Auto-Fold:** If left untouched near an edge for 1.2 seconds, it automatically re-folds into the margin.

### 3.2 Scrollbar Awareness & Collision Elimination
- **Root Cause of Scrollbar Blocking:** In desktop browsers (Windows Chrome/Edge/Firefox), the native vertical scrollbar occupies 15–17px along the right boundary. Using `window.innerWidth` includes the scrollbar in coordinate bounds, causing right-docked elements to sit directly underneath the scrollbar track or intercept native scrolling clicks.
- **Client Width Clamping:** All horizontal boundaries, dragging limits, and bubble positioning use `document.documentElement.clientWidth` (which represents the viewable area strictly inside the scrollbar gutter).
- **Scrollbar-Safe Right Folding:** When `folded-right`, CSS `clip-path: inset(-12px 32px -12px -12px)` clips the translated portion of the element so that **not a single pixel enters or overlaps the scrollbar track**. The peek tab sits cleanly flush with the content boundary, ensuring native page scrolling is never obstructed and the widget remains 100% clickable.

### 3.3 Desktop Pet Themes
The visual appearance of the widget can be switched live in Settings:
- **`cyber-pet` (Default)**: Friendly digital cyber creature with animated LED eyes that blink periodically (`petBlink` keyframes) and express curiosity on hover.
- **`orb`**: Luminous glassmorphic sphere with rotating neon gradient ring.
- **`crystal`**: Faceted prismatic diamond with subtle rhythmic breathing glow.
- **`minimal`**: Subtle compact pill with single status dot.

### 3.4 Non-Blocking Anchored Bubble Menu
- When clicked, the menu mounts as an anchored floating bubble attached directly to the widget's current bounding box.
- A triangular arrow pointer indicates the connected button.
- **No Global Screen Overlay:** Unlike modal dialogs that lock and dim the host webpage, the bubble permits normal page scrolling and viewing. Clicking anywhere outside the bubble cleanly dismisses it.
- **Expand Mode:** Clicking the expand button (`⤢`) at the top right transforms the bubble into an expanded centered modal for deep configuration.

---

## 4. Agent Sync Engine & RPC Protocol (`/api/sync`)

BESing facilitates seamless live integration with autonomous local or remote AI agents through a dedicated RPC protocol:

1. **`GET /api/sync/status`**:
   - Queries real-time telemetry from the active browser session.
   - Returns site hostname, page URL, total count, active/inactive status of every extension (reading actual dynamic state rather than static defaults), and complete script source codes (`code` and `destroyCode`).
2. **`POST /api/sync/command`**:
   - Allows external AI agents to queue remote operations for the browser:
     - `set_status`: Toggle any script on or off live (`{ "action": "set_status", "id": "reading-assistant", "enabled": true }`).
     - `insert_script`: Dynamically registers and executes a brand-new userscript (`{ "action": "insert_script", "script": { "id": "...", "code": "..." } }`) without page reload.
     - `modify_script`: Updates code or metadata for an existing script live.
3. **`POST /api/sync/push`**:
   - Sent by the browser client heartbeat (every 2.5s) to push updated local extension statuses, blocked domains, and runtime scripts.
4. **`POST /api/sync/pull`**:
   - Polled by the browser client heartbeat to retrieve and immediately execute pending agent commands.

---

## 5. Mobile Browser Support & Touch Gestures

BESing is optimized for mobile touchscreens across Android (Edge, Chrome, Firefox) and iOS (Safari, Orion):
1. **Touch Drag Gesture Isolation:**
   - Registers explicit `touchstart`, `touchmove`, and `touchend` handlers with `{ passive: false }`.
   - Calls `e.preventDefault()` during active dragging so repositioning the pet does not trigger native page scrolling, swipe navigation, or pull-to-refresh.
2. **Viewport Boundary Clamping:**
   - Clamps widget coordinates within `[0, window.innerWidth - 48]` and `[8, window.innerHeight - 56]`.
3. **Mobile CSS & Safe Areas:**
   - Panel widths adapt on screens <= 520px to `calc(100vw - 20px)`.
   - Tap targets for switches and action buttons are sized to a minimum of 40-44px to prevent accidental taps.

---

## 6. Automated Self-Update System (Dual-Channel Architecture)

BESing provides an automated self-update engine (`BESUpdater`) that keeps userscripts and extension scripts updated with minimal friction, zero data loss, and dual-channel flexibility.

### 6.1 Architectural Comparison: GitHub vs. Greasy Fork

| Dimension | GitHub Direct (`raw.githubusercontent.com`) | Greasy Fork (`update.greasyfork.org`) |
| :--- | :--- | :--- |
| **Delivery Speed** | **Instant (Zero-lag)** upon `git push`. Ideal for continuous deployment. | **Delayed sync (10–30 mins)** or manual webhook trigger. |
| **Channel Branching** | Native support for multi-branch channels (e.g. `main` for stable, `dev` for bleeding-edge). | Single public release stream per script ID. |
| **Update Mechanism** | Direct HTTP fetch of `.meta.js` and `.user.js`. | Native Greasy Fork CDN update URLs. |
| **Discovery & Community**| Code repository only; no public ratings or community search directory. | High organic visibility, install statistics, and community reviews. |
| **Moderation Policies** | Developer-controlled; no arbitrary execution restrictions. | Strict policies against dynamically downloading non-declared remote scripts. |
| **Caching Behavior** | ~5-minute TTL on raw GitHub CDN (bypassed with cache-busting queries). | Centralized CDN cache with periodic sync. |

### 6.2 The Dual-Channel Strategy
Rather than forcing an either/or compromise, BESing adopts a hybrid multi-channel strategy:
1. **GitHub Raw (`github`)**: Default channel for bleeding-edge and instant fixes. Pushing a git commit immediately makes the update available.
2. **Greasy Fork (`greasyfork`)**: Curated stable channel for standard users relying on the public repository directory.
3. **Local Server (`local`)**: Dedicated channel connecting to `http://127.0.0.1:8765/userscript/besing-manager.meta.js` for developers testing hot updates locally.

### 6.3 Lightweight Meta-File Protocol (`.meta.js`)
To prevent unnecessary bandwidth consumption, updates use the `.meta.js` companion file protocol:
- The full `.user.js` script is 60KB+, but the `.meta.js` file is only ~800 bytes containing just the `==UserScript==` header block.
- `BESUpdater` fetches only the `.meta.js` file, parses `@version`, and executes semantic version comparison.
- Only when `compareVersions(remote, current) > 0` is the user prompted.

### 6.4 1-Click Update Installation Flow
1. When a newer version is detected, the UI displays a vibrant pink/purple update indicator and reveals an **Update Now** button in Settings.
2. Clicking **Update Now** calls `BESUpdater.triggerInstall(downloadUrl)`, which executes `window.open(scriptUrl, '_blank')`.
3. Userscript managers (Tampermonkey, Violentmonkey, Greasemonkey) intercept `.user.js` URLs natively and prompt the user with a 1-click update confirmation overlay showing code differences.
4. All existing user data (`GM_setValue`, site blocklists, custom themes, agent URLs) is preserved safely during the update.

---

## 7. Secondary Menu & Per-Script Configuration Architecture (v1.5.0)

BESing v1.5.0 introduces a dedicated **Secondary Menu & Configuration Engine** for modular scripts, enabling fine-grained, site-isolated configuration with instant visual feedback and automatic lifecycle persistence.

### 7.1 Architecture of Secondary Menus
- Each script card in the extension list includes an explicit gear button (`⚙️`) and clickable metadata zone to pull up its dedicated secondary menu.
- The anchored bubble menu cleanly transitions into the script's configuration view with an instant navigation back button (`← All Scripts`), live active scale/dragger widgets, preset swatches, and the 3-stage mode tri-toggle (`OFF | SITE | ON`).
- Changes made in the secondary menu update the running script instance live via `m.onConfigChange(cfg)` or reactive reload, offering immediate feedback without requiring page reload.

### 7.2 Site-Isolated Configuration Persistence & Automatic Wiping on `OFF`
- **Global Mode (`ON`)**: Configurations are written to `script_configs[scriptId]` and act as universal defaults across all websites.
- **Site-Isolated Mode (`SITE`)**:
  - Configurations are stored exclusively under `siteRules[hostname].configs[scriptId]`, completely bypassing global defaults for that site.
  - A visual badge indicates `[📍 hostname Config]` in the secondary menu.
  - **Automatic Wiping on `OFF`**: When a script is toggled to `OFF`, any custom site-specific configuration under `siteRules[hostname].configs[scriptId]` is **immediately wiped**. When switched back to `SITE` or `ON`, the script starts fresh from defaults, ensuring no stale configurations persist.

### 7.3 Text Size Enhancer Script (`text-size-control`)
- **Problem**: Modern high-resolution monitors and poorly formatted websites often leave fonts unreadably small even at standard browser 200% system zoom limits.
- **Engine**: Applies documentElement zoom scaling (up to 350-400%) while automatically applying counter-zoom transforms (`zoom: calc(1 / scale)`) on the `#___besing_root__` host element so that the BESing widget, pet animations, and bubble menu maintain crisp, native 1x proportions.
- **Controls**: Hero live percentage display (`125%`), step adjusters (`−` / `+`), precision range slider (80% to 350%), quick presets (`100%`, `115%`, `125%`, `150%`, `175%`, `200%`, `250%`, `300%`), and one-click reset.

### 7.4 Force Allow Copy & Paste Script (`force-copy`)
- **Problem**: Websites frequently employ restrictive CSS properties (`user-select: none`) and event blocking scripts (`e.preventDefault()`, `e.stopPropagation()`) on `copy`, `cut`, `paste`, `contextmenu`, and `selectstart`.
- **Engine**:
  1. Injects high-priority CSS overrides (`* { user-select: text !important; -webkit-touch-callout: default !important; }`).
  2. Registers capture-phase event listeners (`addEventListener(..., handler, true)`) on `window` and `document` to intercept and stop propagation of blocking calls before the host page's scripts can cancel them.
  3. Periodically neutralizes legacy inline event handlers (`document.oncopy = null; document.oncontextmenu = null;`).
- **Controls**: Feature toggles for selection, copy/cut, paste, context menu, and an embedded sandbox test area to verify unblocked functionality immediately.

### 7.5 Page Color & Brightness Customizer Script (`color-change`)
- **Problem**: Harsh web contrast strains eyes during extended reading, while naive dark mode scripts destroy existing site styling.
- **Engine**:
  1. **Background Comfort Presets**: Offers curated reading palettes:
     - `Eye Protect`: Soft bean/tea green (`#cce8cf`)
     - `Old Paper`: Antique warm parchment paper (`#f4ecd8`)
     - `Dark Mode`: Deep modern charcoal (`#18181b`)
     - `Soft Sepia`: Warm reader tint (`#eee4cd`)
     - `Cool Mint`: Soft sky tint (`#e0f2fe`)
     - `Custom Tone`: Native color picker with hex input.
  2. **Site Background Brightness Dragger**:
     - Operates directly **on top of the current website-set background** via an overlaid blend layer (`#besing-bg-brightness-overlay`) sitting between page content and the BESing root widget.
     - **Dragging Left (`< 0`)**: Lightens the current website background (e.g., deep blue becomes soft light pastel blue).
     - **Center (`0%`)**: Neutral (100% original site background untouched).
     - **Dragging Right (`> 0`)**: Deepens and darkens the current website background (e.g., blue becomes rich navy blue and eventually deep dark).

### 7.6 Site-Specific Overrides & Exclusion Isolation (v1.5.1)
- **Universal Visibility & Management Across Domains**: Previously, configuring a site-specific rule for domain A (e.g. google.com) could only be viewed or modified while physically browsing domain A. When visiting domain B (e.g. bing.com), the script appeared simply as OFF without indicating that active overrides existed on other sites. Furthermore, disabling a script on a bank or secure site (e.g. RBC) inadvertently wiped the global enabled state, disabling it across every other website.
- **Site-Specific Exclusion (`site-off`)**: BESing v1.5.1 adds an explicit `site-off` mode (`siteRules[host].scripts[scriptId] = false`). When a script is globally active and the user disables it on a specific site (e.g., RBC), the script is excluded only on that host, while remaining fully active across all other domains.
- **Cross-Domain Site Override Control**: The secondary menu for each script features a dedicated "Site-Specific Overrides" card. Users can view all existing domain overrides (e.g., `google.com: Site ON`, `rbc.com: Excluded`), toggle their active states, remove them, or add new domain overrides directly by typing the domain name, without needing to navigate to that site first.
- **Visual Override Badges**: In the main extensions list, scripts with site overrides display a subtle interactive indicator (e.g. `📍 1 site override`), which links directly to the secondary menu.

### 7.7 Clean Typography & Tooltip Protocol
- To keep the script list minimalist and clutter-free, version badges (`v1.0.0`) and category tags (`Tools`, `Accessibility`) are no longer rendered as distracting inline pills beside the script name.
- Instead, script metadata is smoothly embedded into hover tooltips (`name • version • category`) and prominently detailed within the secondary configuration header.

### 7.8 Dual-Context Stable Bootstrapper Auto-Update Hook
- **Cross-Sandbox Bridge**: When running under the GitHub Stable Bootstrapper (`besing-stable.user.js`), userscript execution environments isolate Tampermonkey sandbox `window` from page `unsafeWindow`. BESing ensures that bootstrapper environment flags (`__BESING_ENVIRONMENT__`), auto-update hooks (`__BESING_AUTO_UPDATE__`), and reload triggers (`__BESING_RELOAD_LATEST__`) are exported across both `window` and `unsafeWindow`.
- **Self-Healing Fallback Caching**: If the environment hook is not callable, `BESUpdater` performs a direct fetch of the latest mega-script from GitHub and caches it immediately into userscript storage (`besing_cached_code` and `besing_cached_version`), providing seamless silent updates and a 1-click "Reload Page" prompt.

### 7.9 Host Stacking, Viewport Hardening & Strict CSP Architecture (v1.5.2)
- **Host Element Hardening**: To prevent complex Single Page Applications (SPAs) such as LinkedIn from trapping or layering modal scrims or fixed chat drawers over the floating widget, `<besing-host>` is explicitly styled with `position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; overflow: visible !important; display: block !important;`. The widget and menu wrappers explicitly declare `pointer-events: auto !important; z-index: 2147483647 !important;`, guaranteeing that BESing commands the highest possible visual stacking context in modern browsers.
- **Dynamic Body Re-attachment**: Rather than blindly appending to `document.documentElement` as a detached root sibling, BESing mounts to `document.body || document.documentElement` and dynamically migrates the host into `document.body` as soon as the body becomes ready during SPA lifecycle re-renders.
- **Content Security Policy (CSP) & Bootstrapper Mechanics**: Websites enforcing strict W3C Content Security Policies (such as LinkedIn, GitHub, or financial portals) prohibit runtime dynamic evaluation (`eval` and `new Function`) via `script-src` directives. The standalone mega-script (`besing-manager.user.js`) is completely pre-compiled with zero calls to `eval`, executing natively within Tampermonkey's privileged userscript world without restriction. For users running the minimal stable bootstrapper, `@sandbox JavaScript` is declared to utilize privileged userscript execution realms where available, and clear fallback guidance is provided.

### 7.10 Centralized Site-Specific Rules & Polished Secondary Header UI
- **Unified Settings Site Management**: Site-specific overrides and cross-domain exclusions (`site-off` / `site`) are unified into the primary Settings page under the "Site Specific Rules" section. Script-specific secondary configuration menus no longer feature duplicate or cluttered override lists, keeping each script's sub-panel laser-focused on its own functional controls (e.g. font zoom levels, background brightness filters, force-copy checkboxes). Users can manage, toggle, remove, or add domain-specific rules directly from Settings across all bundled modules.
- **Two-Tier Secondary Header Layout**: The secondary configuration page features a clean two-row header: a top utility bar housing the `< All Scripts` back button and a segmented tri-state status toggle (`OFF`, `SITE ONLY`, `ON (GLOBAL)` or `OFF (ALL)`, `OFF (SITE)`, `ON (GLOBAL)`), followed by a dedicated title row displaying the script's icon, full name, version, and category tag.

### 7.11 Interactive Element Zapper & Ad Cleaner Architecture (v1.5.3)
- **Point-and-Click DOM Elimination**: Unlike traditional native OS right-click context menu options (which are prohibited by browser security in userscript sandbox environments and require Chrome MV3 `contextMenus` permissions), BESing provides an interactive in-page Element Zapper modeled after uBlock Origin.
- **Floating HUD & Target Precision Highlighter**: When launched via the secondary menu button or global shortcut (`Alt + Z`), the Zapper closes the manager popover and attaches a high-stacking floating head-up display (`#besing-zapper-hud`) at `z-index: 2147483647` with live action guidance (`Hover to target • Left-Click to Zap • Esc / Right-Click to Exit`). A non-interactive targeting highlight box outlines hovered elements in real time, projecting a precision tag badge displaying the computed CSS selector and element dimensions.
- **Resilient Selector Engine**: The selector calculation algorithm (`computeSelector`) prioritizes clean DOM identifiers (omitting numeric or internal `__besing` IDs), falls back to concise non-utility CSS classes when document frequency is low, and constructs stable nth-child parent-path selectors if classes are dynamic.
- **Smooth Animation & Live Dynamic Style Injection**: Clicking an element executes an instant shrink-and-fade animation (`scale(0.88)` and `opacity: 0`), immediately hides the element, and appends the computed selector to `blockedSelectors`. A dynamic `<style id="besing-ad-cleaner-style">` element applies `display: none !important; visibility: hidden !important;` to all blocked selectors across the page.
- **Bi-Directional Persistence & Restoration**: Elements zapped via point-and-click or `Alt + Z` are automatically synchronized to persistent storage under `siteRules[host].configs['ad-cleaner'].blockedSelectors`. In the script's secondary menu, users are presented with a scrollable list of all zapped elements on the current website, complete with individual restore buttons (`✕`) to unblock specific elements and a "Clear All" button to restore all zapped content simultaneously.

### 7.12 Shadow DOM SVG Hardening, Dimensional Resets & SPA Error Boundary (v1.5.4)
- **Problem**: When running on complex SPAs such as LinkedIn, host stylesheets apply aggressive global resets (e.g. `body { overflow: hidden; height: 11039px; font-size: 10px; }`) and flex-shrink constraints. Furthermore, in userscript versions prior to v1.5.2, without explicit `!important` dimensional guards and flex-shrink protections inside Shadow DOM, `.besing-bubble-panel` collapsed into an empty 22px bar showing only the header text `BESing v1.5.1`. In addition, inline SVGs (`.besing-pet-face`, `.besing-header-actions svg`, `.besing-logo-icon svg`) collapsed to 0px or disappeared when host styles affected SVG rendering, and any unhandled exception in `renderBody()` could result in a blank panel.
- **Dimensional & Layout Hardening**: `.besing-bubble-panel` enforces strict `min-width: 360px !important; min-height: 380px !important;` with `.besing-header { flex-shrink: 0 !important; }` and `.besing-body { min-height: 280px !important; flex: 1 1 auto !important; }`. This completely eliminates dimensional collapse regardless of host page flex, height, or overflow overrides.
- **Global Shadow DOM SVG Rule**: All SVG elements within `#__besing_root__` are explicitly protected via `svg { display: block !important; overflow: visible !important; flex-shrink: 0 !important; }`, guaranteeing that vector icons, pet faces, and navigation controls render crisply across all websites.
- **Docked Edge Peeking**: The edge-tucking transform when docked on the right margin is refined to `translateX(20px) !important; clip-path: inset(-12px 20px -12px -12px) !important;` so the pet's animated facial features and glance animations remain clearly visible and interactive while parked.
- **Defensive Error Boundary in `renderBody()`**: A top-level `try...catch` wrapper surrounds `renderBody()`. If any runtime or data parsing error occurs during panel assembly, a styled error card is rendered with an intuitive "Retry Loading" button rather than leaving the menu in an unrecoverable blank state.

### 7.13 Script Architecture Naming: BESing Stable vs BESing Packed, CORS Resilience & Collision Guard (v1.5.5)
- **Unambiguous Script Identity**: To prevent confusion between the lightweight dynamic bootstrapper and the standalone bundle, scripts declare distinct identities: **BESing Stable** (`besing-stable.user.js`, ~13 KB loader) vs **BESing Packed** (`besing-manager.user.js`, ~169 KB monolithic offline bundle).
- **Environment Detection via Metadata**: Previous versions evaluated `isStableLoader()` solely against window environment variables (`window.__BESING_ENVIRONMENT__`), which resulted in false positives if a user had installed both scripts or if residual window state persisted. In v1.5.5, `isStableLoader()` directly inspects `GM_info.script.name`. If the script name contains `Packed`, it deterministically operates as BESing Packed. If it contains `Stable`, it operates as the bootstrapper.
- **Cross-Origin & @connect Failover**: When userscript managers enforce strict CORS or unapproved `@connect` restrictions that reject `GM_xmlhttpRequest` (e.g. `Blocked by @connect CORS check`), network fetchers automatically fall back to native `fetch()` and mirror requests to public CDNs with universal CORS headers (`cdn.jsdelivr.net`).
- **Dual-Script Collision Shield**: If a user accidentally enables both BESing Stable and BESing Packed simultaneously in their userscript manager, BESing Stable detects the active Packed instance and gracefully aborts execution, while BESing Packed presents a non-intrusive warning card in Settings advising the user to disable the redundant script.

### 7.14 Trusted Types Immunity, Native `safeParseHTML` DOM Engine & SVG Namespaces (v1.5.7)
- **Root Cause Analysis on Strict CSP Websites (LinkedIn, Enterprise Portals)**: Modern enterprise single-page applications like LinkedIn enforce strict Content Security Policies with Trusted Types (`require-trusted-types-for 'script';`) paired with an aggressive sanitizer hooked into `window.trustedTypes.defaultPolicy.createHTML()`. Any string assigned to `.innerHTML` or processed via `DOMParser('text/html')` is intercepted by this policy, which strips `<input>`, `<svg>`, `<button>`, and unwhitelisted elements entirely. This caused `<input class="besing-search-input">` to be stripped, resulting in `Cannot set properties of null (setting 'oninput')`. Furthermore, parsing SVG via `DOMParser('image/svg+xml')` without an explicit XML namespace (`xmlns="http://www.w3.org/2000/svg"`) produces elements with `namespaceURI: null` that Chromium renders with 0x0 dimensions, causing vector graphics to disappear on both Google and LinkedIn. Finally, on `SVGElement`, `className` is an `SVGAnimatedString` with only a getter; assigning `el.className = ...` throws an immediate TypeError that halts widget mounting.
- **Native `safeParseHTML` DOM Engine**: Rather than relying on HTML injection sinks or browser XML parsers, BESing v1.5.7 introduces an internal, zero-dependency tokenization engine (`safeParseHTML`). The engine walks HTML/SVG token streams and builds elements exclusively through native DOM construction: standard HTML tags are instantiated via `document.createElement(tagName)`, while vector graphics and their child shapes are created via `document.createElementNS('http://www.w3.org/2000/svg', tagName)`. Attributes, classes (`setAttribute('class', ...)`), styles, values, and boolean properties (`checked`, `disabled`, `selected`) are bound directly without touching `innerHTML` or `TrustedHTML` sinks.
- **Pure Native SVG Ingestion via `createSVG`**: All vector icons and desktop pet graphics are parsed via `this.safeParseHTML(svgString)`, guaranteeing proper SVG namespace inheritance (`http://www.w3.org/2000/svg`), non-zero bounding boxes, and 100% rendering fidelity across all host environments.
- **Zero-Failure Event Binding**: Header actions, settings toggles, search inputs, and launcher controls are wrapped in defensive null-checks and debounced event handlers. Even under adverse DOM conditions or complex single-page application navigation, the menu and launcher remain interactive, resilient, and visually intact.



