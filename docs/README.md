# BESing: Browser Extension Script Hub & Manager

Welcome to **BESing** (**B**rowser **E**xtension **S**cript), a unified framework and script manager engineered for **Greasy Fork userscripts** and native **Chrome/Chromium Browser Extensions (Manifest V3)**.

BESing combines an edge-folding desktop pet widget, an anchored non-blocking speech bubble manager, and a curated suite of modular productivity, visual comfort, accessibility, and security tools.

---

## 1. Feature Scripts Documentation

Each bundled script provides specialized browser enhancements and includes its own dedicated documentation page detailing capabilities, technical architecture, and standalone usage:

| Script Name | Category | Version | Summary | Documentation | Source Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Ad Cleaner & Element Zapper** | Privacy | 1.3.0 | Suppresses cookie overlays and provides an interactive point-and-click Element Zapper (`Alt + Z`). | [ad-cleaner.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/ad-cleaner.md) | [ad-cleaner.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/ad-cleaner/ad-cleaner.user.js) |
| **Page Color & Brightness** | Visual | 1.2.0 | Background presets (Eye Protect, Old Paper, Dark), live brightness dragger, and high-contrast text color presets. | [color-change.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/color-change.md) | [color-change.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/color-change/color-change.user.js) |
| **Text Size Enhancer** | Accessibility | 1.1.0 | Scales page text (125%, 150%, 200%+) with smart paragraph unlock & text-only mode for novel/article reading. | [text-size-control.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/text-size-control.md) | [text-size-control.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/text-size-control/text-size-control.user.js) |
| **Force Allow Copy & Paste** | Tools | 1.0.0 | Unlocks restricted text selection, copy, cut, paste, and right-click context menus via capture-phase interceptors. | [force-copy.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/force-copy.md) | [force-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/force-copy/force-copy.user.js) |
| **Reading Assistant** | Productivity | 1.0.0 | Tallies body word count, estimates reading duration, and provides a floating heading outline navigation drawer. | [reading-assistant.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/reading-assistant.md) | [reading-assistant.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/reading-assistant/reading-assistant.user.js) |
| **Night Comfort Dimmer** | Accessibility | 1.0.0 | Hardware-accelerated contrast-preserving dark backdrop filter for late-night viewing comfort. | [dark-dimmer.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/dark-dimmer.md) | [dark-dimmer.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/dark-dimmer/dark-dimmer.user.js) |
| **Markdown Link Copier** | Tools | 1.0.0 | Global shortcut `Alt + C` captures page title and URL formatted as `[Title](URL)` with confirmation toast. | [quick-copy.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/quick-copy.md) | [quick-copy.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/quick-copy/quick-copy.user.js) |
| **Prevent Redirect** | Security | 1.3.1 | Blocks unwanted automatic navigation, popup spam, and tab hijacking by returning mock window objects. | [prevent-redirect.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/prevent-redirect.md) | [prevent-redirect.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/prevent-redirect/prevent-redirect.user.js) |
| **PageStream** | Productivity | 1.0.0 | Continuous page streaming via smart pagination detection, history tracking, and HTTP 429 flood protection. | [pagestream.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/pagestream.md) | [pagestream.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/pagestream/pagestream.user.js) |

---

## 2. Core Architecture Highlights

### Dual-Channel Distribution
BESing provides two distinct installation channels depending on your update preferences:
1. **BESing Stable (`besing-stable.user.js`):** A lightweight dynamic bootstrapper (~13 KB) that automatically fetches and caches the latest mega-bundle in the background from GitHub releases, Greasy Fork, or jsDelivr CDNs with failover. Updates apply silently and seamlessly without requiring manual userscript reinstallations.
2. **BESing Packed (`besing-manager.user.js`):** A monolithic offline bundle (~169 KB) containing the manager core and all 8 pre-installed scripts. Ideal for offline environments or strict Greasy Fork distributions where external CDN downloads are prohibited.

### Edge-Folding Desktop Pet Widget
- **Intelligent Docking:** When dragged within 50px of any screen boundary or corner, the widget folds 65% of its width into the margin, leaving only an animated peek tab and ears visible. Hovering expands it back out smoothly.
- **Customizable Avatar Themes:** Choose between **Cyber Pet** (blinking animated eyes), **Neon Orb**, **Prism Crystal**, and **Minimal Dot** via the Settings panel.

### Non-Blocking Anchored Bubble Menu
- The manager opens as an anchored speech bubble attached directly to the widget via a directional pointer tail.
- Unlike full-page modal backdrops that freeze the underlying site, the host webpage remains completely interactive and scrollable while managing scripts.
- An expand button in the upper right allows switching to full modal mode when desired.

### Multi-Tier Configuration & Site Isolation
- **Global Mode (`ON`):** Settings apply across all websites.
- **Site-Only Mode (`SITE`):** Settings apply exclusively to the current domain and bypass global settings. Switching a script to `OFF` automatically wipes custom site settings, preventing stale configurations.
- **Domain Exclusion (`OFF (SITE)`):** Disables a script specifically on one domain (such as banking portals) while keeping it active everywhere else.
- **Centralized Settings:** All domain overrides across all scripts can be reviewed, toggled, or removed from the **Site Specific Rules** section in Settings.

---

## 3. Directory Layout

- [docs/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs)
  - [README.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/README.md): Master documentation hub and index.
  - [design.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/design.md): System architecture, technical specifications, and release notes.
  - [SECURITY.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/SECURITY.md): Security manifesto, threat models, and safety checklist.
  - `scripts/`: Dedicated documentation pages for each feature script.
- [scripts/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts)
  - [SCRIPT_LIST.json](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/SCRIPT_LIST.json): Catalog metadata and bundle registry.
  - Subdirectories containing standalone userscripts (`ad-cleaner`, `color-change`, etc.).
- [src/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/src)
  - `core/`: Storage adapter, runtime registry, and updater logic.
  - `ui/`: Shadow DOM components, floating widget, speech bubble layout, and CSS styles.
- [userscript/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript)
  - [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js): Monolithic userscript distribution.
  - [besing-stable.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-stable.user.js): GitHub stable automatic bootstrapper.
- [extension/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension)
  - Chrome Manifest V3 extension bundle (`manifest.json`, `content.js`, `background.js`, `popup.html`).
- [demo/](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/demo)
  - Interactive live testing sandbox with rich sample webpage and local preview server.

---

## 4. Quick Start

### As a Userscript
1. Install a userscript manager (Tampermonkey, Violentmonkey, or Greasemonkey).
2. Install [besing-stable.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-stable.user.js) for automatic updates, or install [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) for the offline standalone build.
3. Visit any website. The floating pet emblem will appear on the bottom-right.

### As a Chrome Extension (Manifest V3)
1. Open Chromium and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the [`BESing/extension`](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension) folder.

### Interactive Live Demo
Run the local preview server from the repository root:
```powershell
& "..\.venv\Scripts\python.exe" demo/server.py
```
Open `http://127.0.0.1:8765/demo/index.html` to explore the interactive sandbox.
