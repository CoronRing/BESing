# BESing Official Script Hub

Collection of modular, plug-and-play userscripts designed for the **BESing** framework or any standard userscript manager (Tampermonkey, Violentmonkey, Greasemonkey).

---

## Script Catalog

| Script | Version | Category | Description | Documentation |
| :--- | :--- | :--- | :--- | :--- |
| **[Ad Cleaner & Element Zapper](./ad-cleaner/ad-cleaner.user.js)** | 1.2.0 | Privacy | Suppresses annoying cookie banners and provides an interactive point-and-click Element Zapper (`Alt + Z`). | [ad-cleaner.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/ad-cleaner.md) |
| **[Page Color & Brightness](./color-change/color-change.user.js)** | 1.1.0 | Visual | Background presets (Eye Protect, Old Paper, Dark) and site background brightness slider. | [color-change.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/color-change.md) |
| **[Text Size Enhancer](./text-size-control/text-size-control.user.js)** | 1.0.0 | Accessibility | Scales text and page zoom (up to 350-400%) with preset pills, step adjusters, and counter-zoom widget guard. | [text-size-control.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/text-size-control.md) |
| **[Force Allow Copy & Paste](./force-copy/force-copy.user.js)** | 1.0.0 | Tools | Unlocks restricted text selection, copy, cut, paste, and right-click context menu via capture interceptors. | [force-copy.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/force-copy.md) |
| **[Reading Assistant](./reading-assistant/reading-assistant.user.js)** | 1.0.0 | Productivity | Word count calculation, reading duration estimate, and interactive heading outline drawer. | [reading-assistant.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/reading-assistant.md) |
| **[Night Comfort Dimmer](./dark-dimmer/dark-dimmer.user.js)** | 1.0.0 | Accessibility | Gentle, contrast-preserving dark backdrop filter for late-night viewing comfort. | [dark-dimmer.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/dark-dimmer.md) |
| **[Markdown Link Copier](./quick-copy/quick-copy.user.js)** | 1.0.0 | Tools | Shortcut `Alt + C` captures page title and URL formatted as Markdown `[Title](URL)` with toast. | [quick-copy.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/quick-copy.md) |
| **[Grok Exporter](./grok-exporter/grok-exporter.user.js)** | 1.0.0 | Tools | Copies or downloads the full Grok conversation as Markdown, including messages Grok has not rendered yet. | [grok-exporter.md](../docs/scripts/grok-exporter.md) |
| **[Prevent Redirect](./prevent-redirect/prevent-redirect.user.js)** | 1.1.0 | Security | Blocks unwanted automatic navigation, popup spam, and tab hijacking by returning mock window objects. | [prevent-redirect.md](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/docs/scripts/prevent-redirect.md) |

---

## Installation & Distribution

All scripts can be used in two ways:
1. **Bundled with BESing:** Pre-installed and managed inside the BESing speech bubble menu with site-isolated persistence, secondary configuration cards, and global updates.
2. **Standalone:** Installed individually as independent `.user.js` files in Tampermonkey, Violentmonkey, or Greasemonkey.
