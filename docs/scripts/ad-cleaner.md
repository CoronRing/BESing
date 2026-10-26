# Ad Cleaner & Element Zapper

**Script Identifier:** `ad-cleaner`  
**Current Version:** 2.1.0  
**Category:** Privacy  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [ad-cleaner.user.js](../../scripts/ad-cleaner/ad-cleaner.user.js)  
**Distribution Bundle:** [besing-manager.user.js](../../userscript/besing-manager.user.js) | [content.js](../../extension/content.js)

---

## 1. Summary

Ad Cleaner is an aggressive page cleaner meant to run alongside a normal ad blocker and catch what it leaves behind. It works the other way round from a filter list: it first finds the page's main content, then hides what floats over it, what looks like an ad, and, at higher levels, everything around it. A single **Aggressiveness** slider from 0 to 4 controls how far it goes. The default is **3.4**, which hides every fixed or sticky element, third-party frames, image ads, widgets and sidebars, and keeps the main content, the top navigation and page links.

The **Element Zapper** hides anything the cleaner missed with one tap or click. While it is open, a transparent overlay covers the page, so neither the page nor its ad frames receive the tap and an ad cannot open.

---

## 2. Aggressiveness Levels

Each rule turns on at its level, and every level includes the rules below it. The slider moves in steps of 0.1.

| Level | Name | What it hides |
| :--- | :--- | :--- |
| 0 | Zaps Only | Only elements you zapped on this site. |
| 0.5 | Known Ads | Ad network slots (`ins.adsbygoogle`, `div-gpt-ad`, Taboola, Outbrain and others) and cookie consent managers (OneTrust, Cookiebot, Quantcast, Didomi and others), plus generic cookie and consent banners. |
| 1 | Popups | Fixed elements covering at least a quarter of the screen. Unlocks scrolling, page blur, `inert` and disabled clicks left behind by the popup, and closes modal `<dialog>` and popover elements it hides. |
| 1.5 | Floats | Every fixed element except a top header: bottom bars, corner floats, chat bubbles. Also scroll followers, which are positioned elements that a script keeps at the same screen spot while you scroll. |
| 2 | Third-Party | Third-party frames, except video and other embeds (YouTube, Vimeo, Bilibili, maps and others) and essential ones (captcha, payment, sign-in). Boxes of a standard ad size holding a frame or ad element. Elements whose id or class names it as an ad (`ad`, `ads`, `advert`, `sponsored`, `promoted`, `dfp` and others). Sticky elements stop sticking, except a header or navigation bar. |
| 2.5 | Image Ads | Image links to other sites, blocks labelled "Advertisement", "Sponsored", "广告", "推广", "Anzeige" and similar, and script-written blank frames (except rich text editors). |
| 3 | Nothing Floats | Every fixed element including headers, every sticky element stops sticking, and video embeds outside the main content. |
| 3.2 | No Widgets | Related, recommended, trending, share, social, follow, newsletter, subscribe, promo, banner, popup and app-download widgets outside the main content. |
| **3.4** | **No Sidebars (default)** | `<aside>`, `role="complementary"` and sidebar or rail columns outside the main content. |
| 3.6 | No Comments | Comment sections, including Disqus. |
| 3.8 | Main Content Only | Everything beside the path from `<body>` to the main content, except headers, navigation and page links (next, previous, chapter lists). |
| 4 | Text Only | Also headers and navigation, plus all images, video, audio, frames, SVG, canvas and background images. Page links stay. |

**Popups you open yourself.** Below 3.5, a fixed element that first appears within 1.5 seconds of you pressing a button, menu or other control is kept, so menus and dialogs you open still work. It is still hidden if an ad rule matches it. From 3.5 up there is no exception.

**Lowering the level** restores everything immediately, including frames and sticky positions, without a reload.

---

## 3. How It Works

### Main content detection

The cleaner scores text blocks the way reader modes do. Each run of text adds its length to the block that holds it and half to that block's parent. Text inside links, `nav`, `header`, `footer`, `aside` and comment sections does not count, and Chinese, Japanese and Korean text counts double. The highest-scoring block becomes the main content, and it climbs to its parent when that adds the headline (`h1`/`h2`) and little else. Pages with less than about 500 characters of prose have no main content. Rules that depend on it (widgets, sidebars, main content only) then do nothing, and a fixed element holding more than 2000 characters is kept in case it is the page itself.

The main content and all its ancestors are never hidden, except by a zap. If the detected main content changes, anything hidden that now contains it is shown again.

### Hiding

There are two ways to hide an element, depending on why it is hidden:

- **Cloaking, for ads and popups.** Hiding an ad with `display: none`, or blanking its frame, tells the ad script its slot failed, and many scripts then re-insert or reload the ad. That is a loop the user sees as a flashing ad. So ads, popups and fixed or floating elements are cloaked instead: `position: absolute`, moved 99,999 px up and to the left, `opacity: 0`, `pointer-events: none` and no transitions. The element keeps its size and still counts as rendered (non-zero `offsetHeight`, an `offsetParent`, `display` unchanged), so ad-block checks pass. Because it is never on screen, refresh-when-visible logic never fires. Frames inside keep running off screen, and video and audio inside are muted and paused.
- **`display: none`, for page structure:** sidebars, widgets, comments, the parts hidden by Main Content Only, emptied ad wrappers and level 4 media. Nothing reloads these, so they come out of the layout entirely.

Both are inline `!important` styles, which beat the site's own stylesheets and inline styles. If a script writes the style back, a `MutationObserver` puts it back before the next paint.

- **A constructed stylesheet** (`document.adoptedStyleSheets`) cloaks zapped selectors and known ad selectors the moment a matching element is inserted, and holds the level 4 media rules. A strict `style-src` Content Security Policy blocks `<style>` elements but not constructed sheets. If constructed sheets are unavailable it falls back to a `<style>` element.
- **Empty wrappers collapse.** After an ad is hidden, up to three parents that no longer show any text or media outside hidden elements are hidden too, so no gap is left behind.
- Elements are hidden, never removed, so sites built with React and similar frameworks do not break when they update the page.

### Scanning

Two passes keep the page clean:

- **Before paint.** The `MutationObserver` callback runs after a script changes the page and before the browser draws it. It runs every rule on added elements, and on elements whose `class`, `style`, `id`, `src` or `open` changed. An ad that is inserted, replaced with a fresh node or switched to `position: fixed` by a class is therefore hidden before it is ever drawn. It looks at up to 400 elements per callback (60 under a changed attribute); anything beyond that is left to the next full scan, which is then brought forward.
- **Full scan.** Runs at start, at `DOMContentLoaded` and `load`, after page changes, and after scrolling or resizing, for rules that need the whole page: main content, scroll followers, scroll unlocking and Main Content Only. It reads every element's computed position and size first, then applies all changes at once, so layout is calculated once per scan. Scans are spaced at least 250 ms apart (400 ms when the before-paint pass handled everything), or eight times the last scan's duration on heavy pages. On a test page with about 16,000 elements a scan took about 70 ms. Main content detection reruns every 2 seconds, and when the page finishes parsing.

BESing's own elements (`besing-*`, PageStream pages and controls) are never touched.

---

## 4. Element Zapper

Open it with **Launch Element Zapper** on the detail page, or `Alt + Z` on desktop.

- **Isolation.** The Zapper covers the page with a transparent same-origin `<iframe>`, shown in the browser's top layer (popover) where supported. Taps and clicks land inside that frame, so page listeners, click-anywhere traps and ad frames never receive them. Earlier versions relied on window capture listeners, which miss taps on cross-origin ad frames and lose to page listeners registered first.
- **Picking.** Hover (desktop) or touch (mobile) highlights the element under the pointer, and releasing hides it. Tapping any part of a fixed or sticky bar picks the whole bar, and otherwise the pick grows to the outermost wrapper that draws the same box.
- **Scrolling.** Mouse wheel and touch drags scroll the page underneath, so you can keep zapping down the page.
- **HUD buttons.** **Undo** shows the last hidden element again. **Bigger** replaces the last pick with its parent. **Done** (or `Esc`, or right-click) leaves the Zapper. `Ctrl/Cmd + Z` also undoes.
- **Selectors.** Each zap is saved as the shortest selector that matches only that element, built from stable ids and class names. Generated names such as `css-1x2y3z`, `sc-…`, or names with long digit runs are skipped, and `:nth-of-type` is added where needed.

### Where zaps are stored

Zaps are saved per host in the script settings as `zapped: { "<host>": [selectors] }`, so a zap only applies on the site where it was made. Lists from versions before 2.0 (`blockedSelectors`) were not keyed by host and could apply on every site. They still apply, and show in the list as `[all sites]` so you can remove them.

If the script's settings are locked to a site (see the design doc, "Settings Lock"), zaps are written to that site's copy, and unlocking the site discards them along with its other settings.

---

## 5. Configuration

| Setting | Key | Default | Notes |
| :--- | :--- | :--- | :--- |
| Aggressiveness | `level` | `3.4` | 0 to 4, step 0.1. Can be locked per site. |
| Zapped elements | `zapped` | `{}` | Map of host to selector list. |
| Old zapped list | `blockedSelectors` | none | Read only for compatibility, removable from the list. |

The detail page shows the current level's name and what it does, a status line (how many elements are hidden on this page and why, how many sticky elements were released, and which element was taken as the main content), the Zapper button and this site's zap list.

The earlier `enableAutoClean` switch no longer exists. Level 0 is the equivalent of turning it off.

### Debug log

The BESing load checks record a line like `ad L3.4 adopted hidden=14(fixed:3,iframe:2,...) static=2 main=article.post scans=3/1ms`. `adopted` or `style` says which stylesheet method is active; `NO-SHEET` means neither could attach.

---

## 6. Standalone Userscript Usage

The script also runs on its own in Tampermonkey, Violentmonkey or Stay without the BESing manager. It starts at `document-start` in the top frame only, at the default level, and saves its settings in the site's `localStorage` under `besing-ad-cleaner`. To use another level without the manager, set that key to a JSON value such as `{"level": 2}`. `Alt + Z` opens the Zapper.
