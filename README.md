# BESing - Browser Extension Script Framework & Manager

**BESing** is a dual-compatible browser scripting system designed to unify **Greasy Fork userscripts** (Tampermonkey, Violentmonkey) and **Chrome Extensions (Manifest V3)** under a single secure architecture.

---

## 🌟 Key Highlights

- **Dual-Compatible Runtime**: Write once, deploy as a Tampermonkey userscript or unpack as a Chromium Extension.
- **Draggable & Non-Intrusive Floating Widget**: Sleek, glassmorphic floating trigger with screen boundary clamping and persistent coordinate memory.
- **Auto-Installed Sub-Scripts**: Out of the box, auto-installs and manages:
  - 📖 **Reading Assistant**: Word counter, estimated reading duration, and heading outline navigator.
  - 🌙 **Night Comfort Dimmer**: Screen tint and dimming filter for nighttime reading.
  - 🔗 **Markdown Link Copier**: Instant `Alt + C` shortcut and one-click Markdown link generator.
- **Per-Site Disabling & Granular Blocklist**:
  - Disable BESing on any site with one click. When disabled, all scripts and the floating button disappear completely from that site.
  - View all blocked sites ordered chronologically by added time.
  - Easily unblock any domain with an instant click.
  - Emergency summon hotkey (`Alt + Shift + B`) or Tampermonkey menu command to manage blocked sites even when the widget is hidden.
- **Absolute Security**: Zero dynamic code execution (`eval` / `new Function()` prohibited), full Shadow DOM styling and script isolation, context-isolated persistent storage, and strict sanitization.

---

## 📁 Directory Structure

```
BESing/
├── docs/
│   ├── design.md              # System design, data flow, & architecture
│   ├── SECURITY.md            # Security manifesto & threat models
│   └── README.md              # Documentation overview
├── src/
│   ├── core/                  # Adapter, storage, registry
│   ├── ui/                    # Draggable widget, menu modal, settings panel, styles
│   ├── modules/               # Sub-script definitions (Reading Assistant, Dimmer, Copy)
│   └── main.js                # Core orchestrator
├── userscript/
│   └── besing-manager.user.js # Standalone Greasy Fork / Tampermonkey userscript
├── extension/
│   ├── manifest.json          # Chrome Manifest V3 configuration
│   ├── content.js             # Extension content script
│   ├── popup.html & popup.js  # Toolbar action popup
│   └── icons/                 # Extension PNG icons (16, 48, 128)
├── demo/
│   ├── index.html             # Interactive live sandbox page
│   └── server.py              # Lightweight local server
└── README.md
```

---

## 🚀 Running the Interactive Demo

Launch the local demo server using Python in the workspace venv:

```powershell
.\.venv\Scripts\python.exe BESing\demo\server.py
```

Then open:
👉 **[http://127.0.0.1:8765/demo/index.html](http://127.0.0.1:8765/demo/index.html)**

### Testing Guide
1. **Move the Widget**: Grab the glowing circular trigger in the bottom-right and drag it around the viewport.
2. **Open Manager**: Click the widget to open the glassmorphic manager dialog.
3. **Toggle Sub-Scripts**: Switch *Night Comfort Dimmer* on or off to see live screen tinting. Check out the *Reading Assistant* badge on the bottom-left.
4. **Disable on Current Site**: Go to the Settings tab (gear icon) and click **"Disable BESing on this site"**. Notice how the widget and scripts disappear cleanly.
5. **Summon & Unblock**: Press `Alt + Shift + B` (or click the test button in the page) to open Settings, view the Blocked Sites list sorted by added time, and click **"Unblock"** to restore BESing!
