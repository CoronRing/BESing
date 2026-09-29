# Text Size Enhancer

**Script Identifier:** `text-size-control`  
**Current Version:** 1.0.0  
**Category:** Accessibility  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [text-size-control.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/text-size-control/text-size-control.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Text Size Enhancer enlarges text, headings, and entire page layouts beyond standard browser zoom limits. On high-density monitors (4K / Retina) or poorly styled websites with hardcoded sub-12px font sizes, standard browser zoom often caps out at 200% or breaks horizontal viewport boundaries. This script provides continuous scaling up to 350-400% with preset pills, stepper adjusters, and intelligent counter-zoom architecture that keeps the BESing manager and desktop pet crisp at 1x proportion.

---

## 2. Key Capabilities

| Feature | Description | Range / Options |
| :--- | :--- | :--- |
| **Beyond-System Zoom** | Enlarges entire document layouts and fonts up to 350-400% without horizontal scroll degradation. | 80% to 350% (slider) / up to 400% (programmatic) |
| **Hero Zoom Display** | Large visual readout in the secondary menu showing current scale percentage with real-time feedback. | e.g. `125%`, `150%`, `200%` |
| **Quick Presets** | One-tap scale buttons for standard readability levels. | 100%, 115%, 125%, 150%, 175%, 200%, 250%, 300% |
| **Stepper Controls** | Convenient `−` and `+` decrement and increment buttons for fine-tuning in 10% steps. | Increments/decrements by 10% |
| **Counter-Zoom Protection** | Automatically calculates and applies an inverse zoom transform to the BESing widget root, ensuring the manager never grows blurry or oversized. | `zoom: calc(1 / scale)` applied to `#__besing_root__` |
| **Site-Specific Scaling** | Zoom settings can be applied globally or isolated strictly to the current website domain. | Managed via secondary tri-toggle |

---

## 3. How Counter-Zoom Works

When a script applies CSS zoom (`document.documentElement.style.zoom = scale`), every child element on the webpage expands proportionally. If unmitigated, a 200% zoom makes floating widgets, pet avatars, and settings dialogs twice as large, consuming half the viewport.

To solve this, Text Size Enhancer injects a dynamic style element (`#besing-text-size-style`):
```css
#__besing_root__ {
  zoom: 0.5000 !important; /* When page zoom is 2.0 (200%) */
}
```
The mathematical formula `counterScale = (1 / scale).toFixed(4)` guarantees that regardless of whether the webpage is zoomed to 80% or 350%, the BESing desktop pet, speech bubble menu, and config sliders always display at their intended native 1x pixel dimensions.

---

## 4. Configuration & Controls

In the BESing secondary menu for **Text Size Enhancer**:
- **Hero Display:** Live percentage banner displaying the current text scale with ambient glowing text shadow.
- **Range Slider:** Continuous dragger from 80% to 350% in steps of 5%.
- **Stepper Buttons:** `−` and `+` buttons flanking the slider to adjust in 10% increments.
- **Preset Pills:** Horizontal row of pill buttons (`100%`, `115%`, `125%`, `150%`, `175%`, `200%`, `250%`, `300%`). The active preset highlights in cyan.
- **Reset Button:** One click restores text and page layout to native `100%`.

---

## 5. Site Isolation & Automatic Wiping

When set to **SITE ONLY** mode via the top status toggle:
- The selected zoom percentage is stored exclusively under `siteRules[host].configs['text-size-control'].fontSizePercent`.
- Visiting other websites leaves their zoom at universal global defaults.
- When toggled to **OFF**, custom site zoom is automatically wiped to prevent stale settings when re-enabling in the future.

---

## 6. Standalone Userscript Usage

To use standalone in your browser without the BESing manager:
1. Paste [text-size-control.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/text-size-control/text-size-control.user.js) into your userscript manager.
2. The script runs at `document-idle` and applies a default 125% zoom scale.
3. You can modify the default scale directly in the code:
```javascript
TextSizeControl.init({ fontSizePercent: 150 });
```
