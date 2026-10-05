# Grok Exporter

**Script Identifier:** `grok-exporter`  
**Current Version:** 1.0.0  
**Category:** Tools  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [grok-exporter.user.js](../../scripts/grok-exporter/grok-exporter.user.js)  
**Distribution Bundle:** [besing-manager.user.js](../../userscript/besing-manager.user.js) | [content.js](../../extension/content.js)

---

## 1. Summary

Grok Exporter copies or downloads the whole Grok conversation on the current page as Markdown. Grok only renders the messages near your scroll position, so selecting the page and copying it misses most of a long chat. This script asks Grok's own web API for the conversation instead, so every message on the branch you are viewing is included, whether or not it is on screen.

---

## 2. Key Capabilities

| Feature | Description |
| :--- | :--- |
| **Copy Full Chat** | Writes the full conversation to the clipboard as Markdown. |
| **Download .md** | Saves the conversation as `Grok - <title> - <YYYY-MM-DD>.md`. |
| **Branch Aware** | Exports the branch you are looking at when a message was regenerated or edited. The toast notes `current branch of N` when other branches exist. |
| **Clean Output** | Strips Grok's inline citation markup and links generated images. |
| **Optional Extras** | Thinking trace, per-message timestamps, and web search sources, each toggled in the secondary menu. All are off by default. |
| **Scroll-Capture Fallback** | If the API is unavailable, scrolls through the transcript and captures each message as it renders (plain text). |

---

## 3. How to Use

1. Open a conversation on grok.com (the URL looks like `https://grok.com/c/<id>`).
2. Click **Copy chat** or **Download .md** at the bottom right of the page, or open the BESing menu, go to **Grok Exporter**, and use the buttons there.
3. A toast at the top right reports how many messages were exported.

When bundled in BESing, turn the script on with **SITE ONLY** on grok.com or **ON (GLOBAL)**. It does nothing on other sites. The menu buttons work even while the script is OFF; the floating page buttons need it on.

---

## 4. Configuration

| Option | Config key | Default |
| :--- | :--- | :--- |
| Floating Buttons on Grok | `showFloatingButtons` | On |
| Include Thinking | `includeThinking` | Off |
| Include Timestamps | `includeTimestamps` | Off |
| Include Web Sources | `includeSources` | Off |

---

## 5. How It Works

See [design.md section 7.25](../design.md) for the endpoints, branch selection rule, and fallback behavior.

The API endpoints are undocumented and belong to Grok's web app, so they can change without notice. If an export comes back as "page capture", the API call failed; the browser console logs the reason under `[BESing Grok Exporter]`.

---

## 6. Standalone Userscript Usage

1. Install [grok-exporter.user.js](../../scripts/grok-exporter/grok-exporter.user.js) in Tampermonkey or Violentmonkey.
2. It runs at `document-idle` on `https://grok.com/*` with `@grant none`.
3. The floating buttons appear on any conversation page.
