# BESing: Browser Extension Script Hub & Manager

Welcome to **BESing** (**B**rowser **E**xtension **S**cript), a unified framework and script manager engineered for **Greasy Fork userscripts** and **Chrome/Chromium Browser Extensions (Manifest V3)**.

---

## 🎯 Repository Intention & Mission

The primary goal of this repository is to author, organize, and distribute browser scripts that:
1. **Bridge Userscripts & Extensions**: Every script authored in BESing is architected to run seamlessly as a Greasy Fork / Tampermonkey userscript (`.user.js`) and as a standalone Chrome Extension.
2. **Built-in Smart Script Manager**: A lightweight, floating, draggable script manager that automatically injects onto pages, auto-installs sub-scripts, provides instant on/off toggles, and provides granular domain controls.
3. **Site Blocker & Privacy Controls**: Easily turn off BESing for any specific site with a single click. When turned off, all UI and scripts completely vanish from that site. A blocked sites manager allows inspecting and unblocking domains ordered chronologically by added time.
4. **Absolute Security**: Zero dynamic code execution (`no eval`), robust Shadow DOM styling encapsulation, context-isolated storage, and strict sanitization.

---

## 📂 Directory Layout

- `docs/`
  - [`design.md`](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/design.md): System architecture, design decisions, and data flow.
  - [`SECURITY.md`](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/SECURITY.md): Security manifesto, threat models, and safety checklist.
- `src/`
  - `core/`: Unified runtime adapter (`adapter.js`), persistent storage (`storage.js`), registry (`registry.js`).
  - `ui/`: Draggable floating trigger, glassmorphism modal, switch controls, and settings panel.
  - `modules/`: Auto-installed bundled sub-scripts (Reading Assistant, Dark Dimmer, Quick Copy).
- `userscript/`
  - `besing-manager.user.js`: Ready-to-install Greasy Fork / Tampermonkey userscript.
- `extension/`
  - Chrome Manifest V3 extension bundle (`manifest.json`, `content.js`, `background.js`, `popup.html`).
- `demo/`
  - Interactive live testing sandbox with rich sample webpage and local preview server.

---

## 🚀 Quick Start

### As a Userscript (Greasy Fork / Tampermonkey)
1. Install Tampermonkey, Violentmonkey, or Greasemonkey in your browser.
2. Install [`besing-manager.user.js`](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js).
3. Visit any web page to see the draggable BESing emblem!

### As a Chrome Extension (Developer Mode)
1. Navigate to `chrome://extensions/` in your Chromium browser.
2. Enable **Developer mode** (toggle in upper right).
3. Click **Load unpacked** and select the [`BESing/extension`](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension) directory.

### Interactive Live Demo
Run the local demo server:
```powershell
.\.venv\Scripts\python.exe BESing\demo\server.py
```
Open `http://127.0.0.1:8765` in your browser.
