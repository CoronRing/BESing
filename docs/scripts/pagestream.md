# PageStream

**Script Identifier:** `pagestream`  
**Current Version:** 1.3.1  
**Category:** Productivity  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [pagestream.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/pagestream/pagestream.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

PageStream turns paginated sites (novel chapters split into pages, search results, article series) into one continuous page. When you scroll far enough into the current page, it fetches the next page, extracts its content container and inserts it below with a divider, so you keep reading without a page load. The browser URL and title follow the page you are reading.

Besides comfort, this reduces full page loads. On iOS, where the userscript manager sometimes injects BESing late or not at all, every avoided page load is one less chance for that to happen.

---

## 2. Key Capabilities

| Feature | Description |
| :--- | :--- |
| **Next-page detection** | Custom selector, then a built-in site rule, then heuristics (`rel="next"`, common pagination classes, link text such as 下一页, 下一章, Next). |
| **Content extraction** | Custom selector, then the site rule's `pageElement`, then (on fetched pages) the same container page 1 used, then common container names and a text-density heuristic. A whole `<body>` is never spliced. |
| **Script-written content** | Text written by `document.write` from a script inside the content container is recovered without running the script (see 3.2). |
| **When to Load** | `Start` (15%), `Half Point` (50%) or `Bottom` (90%) of the newest page. Progress is measured within the newest streamed page, so one trigger loads one page. |
| **Preload** | Fetches the next N pages in the background (default 1) so they appear instantly. |
| **History sync** | Pushes each page's URL as you scroll into it; Back/Forward scrolls to that page. |
| **Rate limiting** | At least 2.5s between streamed pages and 1.5s between fetches, at most 50 pages per session, and streaming stops on HTTP 429, 403 or repeated server errors. |
| **Graceful stop** | A page with no readable text stops streaming with a message instead of inserting a blank block, and a "Continue reading" link to that page is added. |
| **Footer navigation** | With a site rule, every page keeps the site's footer navigation (previous, contents, next) right under its text, with that page's own links (see 3.3). |
| **Turning off keeps your place** | Turning PageStream off only stops further loading. Streamed pages stay on screen, and turning it back on continues after the newest page (see 3.4). |

### Built-in site rules

| Rule | Sites | Content | Next link |
| :--- | :--- | :--- | :--- |
| `suduguu` | suduguu.com chapter pages (`/<book>/<chapter>[-<page>].html`) | `.con` | 下一页, then 下一章 inside `.prenext` |
| `shudugu` | shudugu.org | `#content`, `#txtContent`, `.chaptercontent` | `#next_url`, 下一页, 下一章 |
| `biquge` | biquge-style mirrors | `#content`, `#htmlContent`, `.showtxt` | `#next_url`, 下一页, 下一章 |
| `generic-novel` | URLs containing `novel` | common novel containers | `rel="next"`, 下一章, 下一页 |
| Search | Google, Bing, Baidu result pages | result lists | the engine's next-page link |

With a rule, only next links matching the rule's URL pattern are followed. A finished book's last "next chapter" link usually points at the table of contents, and streaming stops there.

---

## 3. How It Works

### 3.1 Streaming and preloading

The scroll handler checks progress within the newest streamed page. A check that falls inside the 2.5s cooldown or during a load is re-run once that ends, and one check runs a second after start, because a reader who stops at the very bottom produces no further scroll events. Once the threshold is reached, the next page comes from the preload cache if it is there, otherwise it is fetched. If a background preload of that page is still in flight, the trigger waits for it rather than fetching the same page again, and a preload whose page was already inserted is discarded. Pages are numbered when inserted, and a page whose URL is already on screen is never inserted twice.

### 3.2 Script-written content (v1.2.0)

Some sites put only a script in the content container on later pages, for example suduguu.com pages 2 and up:

```html
<div class="con"><script src="/i/a.aspx?id=4419499&p=2&bid=51"></script></div>
```

The script answers with `document.write("<p>...</p>")`. A fetched page never runs scripts (PageStream strips them so ad code cannot run), so the text used to be missing, the container was not recognised, and the whole page body was spliced instead.

PageStream now resolves such scripts before extracting content:

1. Candidates are scripts inside the rule's or custom content container, or whose parent's id or class looks like content (`con`, `content`, `chapter…`, `txt…`, `article`, `read…`, `book…`, `novel…`, `entry`, `post`). At most 3 per page.
2. Only same-origin scripts are fetched (with the user's cookies, as the page itself would).
3. The script is never executed. PageStream finds the string literals passed to `document.write` / `document.writeln`, decodes their escapes, parses the result as HTML, removes any scripts, iframes, objects and embeds, and puts it in the script's place.

### 3.3 Footer navigation (v1.3.1)

A site rule's `replace` selector names the site's own page navigation, for example suduguu.com's `.prenext` bar (上一页 / 目录 / 下一页). Every page keeps its own bar directly under its text:

1. Page 1's bar stays where the site put it; the first streamed page is inserted after it rather than between page 1's text and its bar.
2. From each fetched page, the `replace` elements that follow its content are cloned (scripts removed, links made absolute) and appended to that page's streamed block, under its text. Navigation inside the content is already part of the streamed content.

A single bar at the end of the stream does not work: with streaming on, the next page loads before the reader reaches the end, so that bar is always pushed out of reach.

Without a site rule, the site's pagination is left untouched.

### 3.4 Turning PageStream off and on (v1.3.0)

Turning PageStream off (or disabling it for the site) stops scrolling triggers, preloads and history sync. Streamed pages (with their footer navigation), their dividers and any Continue link stay, so the reader keeps their place and the last page's next link still works. A fetch that finishes after PageStream was turned off is discarded.

Each streamed page records its next page's URL (`data-pagestream-next`). When PageStream is turned on again in the same page view, it reads the streamed pages already on screen and continues after the newest one.

---

## 4. Settings

- **When to Load**: Start, Half Point or Bottom.
- **Preload Pages**: how many pages to fetch ahead (0 turns preloading off).
- **History Sync**: whether the URL follows the page being read.
- **Custom Selectors**: next-link and content-container selectors for sites the detection gets wrong. `:contains("text")` is supported, e.g. `.pager a:contains("Next")`.

---

## 5. Version History

| Version | Changes |
| :--- | :--- |
| 1.3.1 | Every page keeps its own footer navigation under its text; a single bar at the end of the stream was always pushed out of reach by the next page. |
| 1.3.0 | Turning off keeps streamed pages and turning on resumes after them; the site's footer navigation stays at the end of the stream, pointing at the newest page; settings changes no longer reset the next link to page 2; a scroll check skipped during the cooldown or a load is re-run, so stopping at the bottom no longer stalls streaming. |
| 1.2.0 | Script-written content recovery, suduguu.com rule, page 1 container reused on fetched pages, no whole-body splicing, empty-page stop with Continue link, duplicate-page race fix, insert-time page numbering, rule URL check on next links. |
| 1.1.0 | Page-boundary progress, rate limiting, HTTP 429/403 protection, chronological insertion. |
| 1.0.0 | Initial release. |
