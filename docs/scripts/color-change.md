# Page Color & Brightness Customizer

**Script Identifier:** `color-change`  
**Current Version:** 1.1.0  
**Category:** Visual  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [color-change.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/color-change/color-change.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Page Color & Brightness customizes website backgrounds for visual comfort during extended reading sessions. Unlike naive dark mode scripts that invert all colors or break site layouts, this script provides two complementary visual systems: a collection of warm, contrast-preserving reading presets and an interactive brightness slider that operates directly on top of the website's existing background colors.

---

## 2. Key Capabilities

| Feature | Description | Range / Values |
| :--- | :--- | :--- |
| **Reading Background Presets** | One-click reading palettes designed to reduce glare and visual fatigue. | Eye Protect, Old Paper, Dark Mode, Soft Sepia, Cool Mint, Original |
| **Custom Color Picker** | Native color picker accompanied by an editable hex code input to select any custom background tone. | Any valid hex color code (e.g. `#cce8cf`) |
| **Site Background Brightness Dragger** | Continuous slider operating directly on top of the website's existing background, lightening or darkening existing colors while leaving fonts readable. | `-100%` (Lighter) to `+100%` (Deep Dark), with `0%` as neutral |
| **Non-Destructive Restoration** | Stores previous inline body and documentElement styles and restores them cleanly upon reset or deactivation. | Automatic upon `destroy()` or reset |
| **Site-Specific Isolation** | Supports isolated configuration per website. Switching to OFF cleanly removes site-specific color customizations. | Managed via secondary tri-toggle |

---

## 3. Presets Catalog

The script provides five curated reading palettes:

| Preset Name | Target Color | Overlay Tint | Visual Feel |
| :--- | :--- | :--- | :--- |
| **Eye Protect** | `#cce8cf` | `rgba(204, 232, 207, 0.45)` | Gentle tea/bean green, scientifically proven to soothe eye strain during long document reading. |
| **Old Paper** | `#f4ecd8` | `rgba(244, 236, 216, 0.48)` | Warm antique book paper feel, ideal for long essays and technical documentation. |
| **Dark Mode** | `#18181b` | `rgba(24, 24, 27, 0.65)` | Deep charcoal dark theme with multiply blending for night viewing. |
| **Soft Sepia** | `#eee4cd` | `rgba(238, 228, 205, 0.42)` | Classic e-reader sepia tint with balanced warmth. |
| **Cool Mint** | `#e0f2fe` | `rgba(224, 242, 254, 0.42)` | Crisp, refreshing pastel blue tint for daytime reading. |
| **Original** | `transparent` | `transparent` | Original website background untouched. |

---

## 4. How the Brightness Dragger Works

Websites often use specific brand colors (e.g., deep blue headers, grey cards, or tinted sections). The Brightness Dragger manipulates the brightness of these existing backgrounds rather than replacing them with a flat color.

### Layer Stacking
- **Page Elements:** Standard document content (`z-index: auto` to `1000`).
- **Preset Tint Overlay (`#besing-bg-preset-overlay`):** `position: fixed; inset: 0; pointer-events: none; z-index: 2147483625`.
- **Brightness Overlay (`#besing-bg-brightness-overlay`):** `position: fixed; inset: 0; pointer-events: none; z-index: 2147483630`.
- **BESing Widget & Manager:** `z-index: 2147483647` (always on top and crisp).

### Blending Mathematics
- **Dragging Left (`< 0`):** Lightens existing background colors. Injects a pure white overlay with `mix-blend-mode: screen`. A blue website background smoothly transforms into soft pastel blue.
- **Center (`0`):** Neutral. The overlay background is completely transparent (`rgba(0, 0, 0, 0)`).
- **Dragging Right (`> 0`):** Deepens and darkens existing background colors. Injects a black overlay with `mix-blend-mode: multiply`. A blue website background deepens into rich navy blue and eventually deep dark.

---

## 5. Configuration & Controls

In the BESing secondary menu for **Page Color & Brightness**:
- **Brightness Slider:** Continuous range from `-100` to `+100` with live badge indicator (`☀️ Lighter (+45%)`, `🎯 Normal (Original BG)`, `🌙 Deep Dark (+60%)`).
- **Preset Grid:** Clickable cards for each reading preset with live color swatches.
- **Custom Color Row:** Native color picker and monospace hex text input (`#cce8cf`) with an **Apply** button.
- **Reset Button:** A single click resets brightness to `0` and preset to `Original`, cleanly restoring the host website styles.

---

## 6. Standalone Userscript Usage

To run standalone without the BESing manager:
1. Copy [color-change.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/color-change/color-change.user.js) into your userscript manager.
2. The script runs at `document-idle` and applies default Eye Protect soothing green.
3. You can customize the default configuration inside `init()`:
```javascript
ColorChange.init({
  preset: 'old-paper',
  brightness: -15
});
```
