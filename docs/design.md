# BESing (Browser Extension Script) Specification & Design

**Version:** 1.5.0  
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


