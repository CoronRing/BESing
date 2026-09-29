# Reading Assistant

**Script Identifier:** `reading-assistant`  
**Current Version:** 1.0.0  
**Category:** Productivity  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [reading-assistant.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/reading-assistant/reading-assistant.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Reading Assistant provides real-time document analytics and quick navigation for long articles, documentation sites, and research papers. It automatically counts body words, computes an estimated reading duration based on standard reading speeds, and displays a glassmorphism pill badge at the bottom-left of the screen. Clicking the badge opens an interactive document outline drawer with one-tap smooth scrolling to any section heading.

---

## 2. Key Capabilities

| Feature | Description | Metric / Position |
| :--- | :--- | :--- |
| **Word Count Calculation** | Scans and tallies all readable body text, filtering whitespace and punctuation. | Formatted with commas (e.g. `1,420 words`) |
| **Reading Duration Estimate** | Computes estimated completion time assuming standard adult reading velocity. | 200 words per minute (e.g. `7 min`) |
| **Heading Structure Indexer** | Extracts `h1`, `h2`, and `h3` tags across the page, capturing title text and hierarchical depth. | Indexes up to 15 key document sections |
| **Floating Glassmorphism Pill** | Non-intrusive floating indicator positioned at the bottom-left corner of the viewport. | Fixed at `bottom: 24px; left: 24px` |
| **Interactive Outline Drawer** | Popover menu presenting the document hierarchy with indented levels and hover states. | Fixed at `bottom: 74px; left: 24px` |
| **Smooth Section Jumping** | Clicking any heading inside the outline instantly scrolls the page directly to that section. | `scrollIntoView({ behavior: 'smooth' })` |

---

## 3. How It Works

### Word Count & Reading Time Formula
When initialized at `document-idle`:
1. Reads `document.body.innerText`.
2. Splits tokens via regex whitespace splitting: `text.trim().split(/\s+/).filter(Boolean).length`.
3. Calculates reading time: `readMin = Math.max(1, Math.ceil(words / 200))`.

### Hierarchical Heading Extraction
The script queries headings via `document.querySelectorAll('h1, h2, h3')`, filters out empty strings, and extracts their numerical level (`level = parseInt(h.tagName[1], 10)`):
- **Level 1 (`h1`):** Indent 6px, bright white text (`#f8fafc`).
- **Level 2 (`h2`):** Indent 18px, slate text (`#cbd5e1`).
- **Level 3 (`h3`):** Indent 30px, muted grey text (`#94a3b8`).

### Navigation & Auto-Dismiss
Clicking an item in the outline executes `h.scrollIntoView({ behavior: 'smooth', block: 'start' })` and automatically removes the outline popover. Outside clicks anywhere on the document cleanly dismiss the popover.

---

## 4. Visual Layout & Styling

- **Badge Layer:** `#besing-reading-assistant-badge` sits at `z-index: 999980` with a dark slate background (`rgba(15, 23, 42, 0.88)`), subtle border, and high-quality background blur (`backdrop-filter: blur(12px)`).
- **Popover Layer:** `#besing-reading-assistant-popover` sits at `z-index: 999981` with clean custom scrollbars and rounded borders.
- **Independence:** Operates independently of the main BESing widget on the bottom-right, avoiding visual collisions.

---

## 5. Standalone Userscript Usage

To install as an independent userscript:
1. Paste [reading-assistant.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/reading-assistant/reading-assistant.user.js) into Tampermonkey or Violentmonkey.
2. The script runs on all pages (`*://*/*`) at `document-idle`.
3. The reading duration badge will appear in the bottom-left corner of every article you browse.
