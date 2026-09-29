# Night Comfort Dimmer

**Script Identifier:** `dark-dimmer`  
**Current Version:** 1.0.0  
**Category:** Accessibility  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [dark-dimmer.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/dark-dimmer/dark-dimmer.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Night Comfort Dimmer applies a gentle, contrast-preserving screen dimming filter and tint to soothe eyes during late hours. Unlike crude browser extensions that simply invert page colors or apply jarring sepia masks, this script mounts a hardware-accelerated dark backdrop layer with fine-tuned brightness and contrast filters that reduces harsh glare while keeping text legible and media vivid.

---

## 2. Key Capabilities

| Feature | Description | Implementation |
| :--- | :--- | :--- |
| **Glare Reduction** | Attenuates harsh white backgrounds across the entire viewport. | `background: rgba(15, 23, 42, 0.32)` |
| **Contrast Preservation** | Slightly reduces contrast to soften edges and decrease optical fatigue. | `backdrop-filter: contrast(0.95) brightness(0.9)` |
| **Zero Interaction Interference** | Never intercepts clicks, mouse movements, or touch gestures. | `pointer-events: none !important` |
| **Non-Destructive DOM Injection** | Leaves all host page CSS styles, fonts, and inline colors completely untouched. | Single floating viewport overlay |
| **Smooth Transition** | Fades in and out smoothly on toggle without abrupt visual flashes. | `transition: opacity 0.3s ease` |

---

## 3. How It Works

Upon activation, the script appends a single fixed division (`#besing-dark-dimmer-layer`) to `document.documentElement`:
```css
#besing-dark-dimmer-layer {
  position: fixed !important;
  inset: 0 !important;
  background: rgba(15, 23, 42, 0.32) !important;
  backdrop-filter: contrast(0.95) brightness(0.9) !important;
  pointer-events: none !important;
  z-index: 999970 !important;
  transition: opacity 0.3s ease !important;
}
```

### Why Hardware Backdrop Filters?
Applying CSS filters directly to `html` or `body` (`filter: brightness(0.8)`) frequently breaks CSS `position: fixed` elements on modern websites, causing floating navbars and sticky headers to jump out of place. 

By applying `backdrop-filter` to a dedicated `pointer-events: none` overlay:
1. The page layout engine is completely undisturbed.
2. Sticky and fixed headers remain fixed in place.
3. Memory and GPU consumption remain negligible.
4. The BESing manager trigger and menu (`z-index: 2147483647`) sit safely above the dimmer, remaining bright and easy to operate.

---

## 4. Standalone Userscript Usage

To run standalone without the BESing manager:
1. Copy [dark-dimmer.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/dark-dimmer/dark-dimmer.user.js) into Tampermonkey or Violentmonkey.
2. The script runs at `document-idle` on `*://*/*`.
3. The dimming layer will activate automatically upon page load.
