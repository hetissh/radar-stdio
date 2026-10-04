# RADAR STUDIO — Gallery to Archive

## Project map

| File | Role |
|---|---|
| `index.html` | Homepage: entrance radar, four collection rails, collection locator. Page-specific CSS is inline; page script at the end. |
| `collections.css` | Homepage-only styles: collection rails, arcs, locator and their light overrides. |
| `product.html` | Product page shell: header, `<main id="piece">`, footer, bag dialog. |
| `product.css` | Product page styles. |
| `product.js` | Renders the product page from `?id=` and runs the lock-on radar, sizes, views, loupe and orbit navigation. |
| `catalogue.html` | Catalogue page shell: header, `<main id="catalogue">` with the intro, footer, bag dialog. |
| `catalogue.css` | Catalogue styles: filters, toolbar, grid, index, field, contact panel. |
| `catalogue.js` | Builds the catalogue: filters, sort, search, URL state, and the grid, index and field views. |
| `shared.css` | Shared by every page: tokens (dark and light), reset, header and menu, dialogs, garments and lighting, captions, footer, bag, view transitions. |
| `shared.js` | Shared by every page: the data loader (`radarData`, `collectionData`, `products` once loaded), `art()`, `money()`, `productCard()`, `productUrl()`, `productById()`, `bearingOf()`, theme (`applyTheme`, `tones`, `echoInk`), concept bag, header menu, garment-morph naming. |
| `export.py` | Builds the portable `RADAR-Gallery-to-Archive.html` (about 5 MB), inlining shared.css, collections.css, shared.js, the logo and one 640px JPEG thumbnail per artwork. Homepage only. |
| `data/products.json` | **Source of truth for the catalogue**: collections and every piece, with explicit price, original price, colour (`dark`), bearing and curated position. Edit this, then run `build_data.py`. |
| `build_data.py` | Checks `data/products.json` (unique ids, positions and bearings per collection) and splits it into the files pages load: `data/home.json`, `data/index.json`, `data/collections/<id>.json`, `data/pieces/<id>.json`, plus `data/inline.js` for pages opened from disk. Generated files must not be edited by hand. |
| `build_images.py` | Makes display-size thumbnails of every reference image with macOS `sips` (no installs). Run it after adding or changing an image. |
| `assets/` | Supplied logo and the 34 reference images (originals, unchanged). |
| `assets/pieces/<id>/` | Product media files (photos, MP4 videos, posters, `.vtt` captions) referenced from a piece's `media` list. |
| `tools/make_demo_video.swift` | Makes a stand-in MP4 (slow push-in across a still) and its poster with macOS's built-in AVFoundation: `swift tools/make_demo_video.swift in.png out.mp4 poster.jpg 6`. Demo use only. |
| `assets/thumbs/` | Generated: `reference-NN-320` and `-640`, each as `.avif` and `.jpg`. |

Adding or changing a piece: edit `data/products.json` (give a new piece a free bearing; `freeBearing()` in the console prints one), add its image to `assets/`, then run `python3 build_images.py && python3 build_data.py && python3 export.py`.

Load order on every page: inline theme script in `<head>`, then `shared.css`, then page CSS. At the end of `<body>`, `shared.js` runs, then the page script. Page scripts rely on the globals from shared.js.

Browser storage keys: `radar-theme` (`light` or `dark`) and `radar-bag` (JSON `[{id,size,qty}]`) in localStorage, plus `radar-catalogue` (the catalogue's last query string) in sessionStorage. A bag change in one tab updates other open tabs through the `storage` event.

## Production hardening (code review, 2026-10-05)

A full review of the front end found 10 issues. Five blockers are fixed:

1. **Escaping.** Every catalogue value placed into HTML goes through `esc()` in shared.js: names, titles, descriptions, status, labels, alt text, media paths and bag lines. `productUrl()` encodes the id. Collection blurbs now store real line breaks (`\n`) instead of `<br>` markup and render through `escLines()`, so data never carries HTML. Tested with a product named `Test "quote" <img src=x onerror=…> tee`: it shows as literal text on the homepage, catalogue (grid, index, field, contact) and product page, and in the bag; nothing executes.
2. **Positions are no longer list indexes.** The product page sorts its collection by position and uses the rank (so a removed piece doesn't make "previous" point at itself or skip numbers), and the homepage return finds the card by product id. Tested by removing a piece from Tees: piece 27 shows "05 of 09" with correct neighbours, and the return lands on it.
3. **Empty and one-piece collections.** A collection with no pieces shows "No pieces on this orbit yet" (counter 00 / 00) instead of crashing every rail on scroll. Arrow keys do nothing on a single-card rail. The catalogue ignores, and clears from the URL, a `?ring=` with no pieces.
4. **Error states.** `getData()` records the HTTP status. A missing piece file (404) still shows "Signal lost". Any other failure (offline, server error, a missing collection file) shows a "Signal interrupted" panel with a Retry button, on the homepage (under the entrance, which keeps running), the catalogue and the product page. Tested by hiding each data file.
5. **Dev tools are local only.** `?stress` and `?perf` work only on `localhost`, `127.0.0.1`, `*.localhost` and files opened from disk (`isDevHost()` in shared.js). On any other host they're ignored and a leftover stress session is cleared. Note that a LAN address such as `192.168.x.x` counts as public, so stress testing from a phone over Wi-Fi needs a `.localhost` name or a tunnel.

Still open from the review:
- **Collection locator:** the homepage's mini collection radar is hard-coded to 4 collections.
- **Data checks:** `build_data.py` validates with `assert`, which `python -O` removes.
- **Cache versions:** browser-cache versions are hand-edited `?v=` strings, and thumbnails are unversioned.
- **Image sizes:** card thumbnails declare widths (`320w`/`640w`) that are really longest-side sizes for portrait images.
- **Duplicated chrome:** the header, footer, bag dialog and theme script are copied across three pages, and `pad`/`clamp` are redefined per script.

Also outside the code: search engines (content is rendered in the browser, there are no meta descriptions or social tags, and "Signal lost" returns 200), inline scripts that block a strict content-security policy, no git, tests or monitoring, and commerce and legal (see docs/shopify-plan.md).

## Product media: photos and video

A piece can show any number of views on its product page (up to 8): the illustrated garment's front and back, photos, and videos. They're listed in order in the piece's `media` in `data/products.json`. Paths are relative to `assets/`, and each item has a short `label` for the strip:

```json
"media": [
 { "type": "garment", "side": "front", "label": "Front" },
 { "type": "garment", "side": "back",  "label": "Back" },
 { "type": "image", "src": "pieces/21/detail.jpg", "label": "Detail", "alt": "…" },
 { "type": "video", "mode": "loop", "src": "pieces/21/loop.mp4", "poster": "pieces/21/loop.jpg", "label": "Loop", "alt": "…" },
 { "type": "video", "mode": "film", "src": "pieces/25/film.mp4", "poster": "pieces/25/film.jpg", "captions": "pieces/25/film.vtt", "label": "Film", "alt": "…" }
]
```

- **No `media`** means Front and Back of the garment, so all pieces without media look as before. The strip reads "01 Front · 02 Back" where it used to read "Front / Back".
- **Build checks** (`build_data.py` refuses to build otherwise): at most 8 items and a label for each. Images and videos need alt text, and their files must exist. Videos must be MP4 (H.264), have a poster, be `loop` (silent) or `film`, and be at most 8 MB. A film must have a `.vtt` captions file. Media goes only into `data/pieces/<id>.json`, so the homepage and catalogue files don't grow.
- **Images**: `build_images.py` makes 160/640/1280px AVIF + JPEG versions of every media photo and video poster (resized by width, never upscaled), named after the path with `/` as `--` (e.g. `pieces--21--loop-poster-1280.jpg`). The stage uses 640/1280 by screen size; the strip's hover preview uses 160.
- **The stage**: the strip (`.media-strip`) is a radio group with one tab stop. Arrows move along it, Home/End jump, and changes are announced ("Detail, 3 of 5"). The readout adds "Media 03 / 05 · Detail".
  - Items change with the same radar wipe as front/back.
  - Photos sit in `.media-frame`. The garment stays laid out but invisible, so the lock-on radar keeps its centre, and the page-to-page garment morph still lands on the garment.
  - The art-detail lens works on the garment front (original artwork, 3.2×) and on photos (their 1280px version, 2.4×), and is disabled for the back and for video.
  - The next item's image or poster is preloaded.
- **Video**:
  - The `<video>` is created the first time its item is shown, with `preload="none"`, so nothing but the poster loads until then. It's kept, so coming back resumes it.
  - **Loops** are muted, repeating, have no controls, and autoplay. They get a visible "Pause loop ‖ / Play loop ▶" button (motion longer than 5 s must be pausable). They don't autoplay with reduced motion, and they pause when the stage scrolls out of view or the tab is hidden.
  - **Films** have native controls and captions on by default, and never autoplay.
  - Leaving a video item pauses it.
- **Phones**: a horizontal swipe on the stage now moves between this piece's media, not to the next piece. Pieces are reached from the orbit strip (and arrow keys on a keyboard). The strip scrolls sideways.

Demo content: no real product photos or films exist yet, so two pieces carry clearly labelled **stand-ins**, marked `"demo": true` with alt text starting "Stand-in":
- **Numbered tee (21):** Front, Back, Detail (its own artwork), Context (Sport study's artwork), and a 6 s silent loop.
- **Fragments tee (25):** Front, Back, Detail, and an 8 s "film" with a captions file.

The videos were generated from the artwork with `tools/make_demo_video.swift` (1.3 MB and 1.8 MB). To remove them, delete those `media` entries and `assets/pieces/21` and `25`, then rebuild.

Checked:
- Strip and keyboard, announcements, photo display at 1280px AVIF, the lens on photos, preloading.
- The loop downloads only when selected, is muted with no controls, and its pause button toggles. Leaving pauses it; returning reuses the element.
- The film: controls, captions showing (2 cues), no autoplay.
- Phone swipes step through media, and the URL stays on the piece.
- A piece without media is unchanged in behaviour.
- No console errors.

Not seen: a loop actually autoplaying. The preview pane was hidden during testing, so the page was in the "tab hidden" state, which deliberately keeps video paused; playing it manually worked.

## Scaling: stored coordinates and stress test

**Stored coordinates.** A piece's bearing used to be calculated as position ÷ collection size × 360°, so adding one piece moved every other piece on its ring. It is now data, each piece's `bearing` in `data/products.json` (it began as a `bearings` table in shared.js), frozen at the values the old calculation produced, so nothing on screen moved (checked: all 34 match). A new piece should be given `freeBearing(ring)`, the midpoint of the widest free gap on its ring, and that number written into the piece's `bearing`. A piece without a stored bearing still works, but gets a temporary slot and a console warning, and so does a duplicate bearing on the same ring. `bearingLabel()` prints whole degrees as `045°` and fractional ones as `331.9°`. The catalogue's Orbit sort now orders each ring by stored bearing. `productById()` uses a Map, so lookups don't slow down as the catalogue grows.

**Stress test.** Add `?stress=N` (1–5000) to any page URL to append N synthetic pieces for the rest of the browser tab's session. They reuse the 34 artworks, are named "Signal NNNN tee", are spread across the four collections, and get bearings from `freeBearing()`. A black "Stress test · N pieces · Exit" badge stays on screen; Exit or `?stress=0` turns it off. With `?stress` or `?perf`, pages record timings: in the console, `radarPerf.report()` prints build time, catalogue apply time, field paint time, homepage rail layout time, long tasks, page element count and image megabytes. Without either flag nothing is recorded.

Results, in-app browser at about 800px wide (milliseconds; 1,034 = 34 real + 1,000 synthetic):

| Measure | 34 pieces | 1,034 pieces |
|---|---|---|
| Catalogue build | 3.9 | 41 |
| Catalogue page elements | 802 | 20,304 |
| Filter click (catalogue apply), avg / worst | 8 / 20 | **1,761 / 5,724** |
| Same filtering while typing (no fade-in) | – | 3–42 |
| Switch to Index / Field | 12.5 / 20 | **5,724 / 3,371** |
| Field radar paint per frame | 2.1 | 1.7 |
| Longest blocking task | 72 | **15,839** |
| Homepage build | 5.3 | 71.5 |
| Homepage rail layout per scroll, avg / worst | 0.7 / 2.4 | 5.5 / **19.8** (over the 16 ms frame budget) |
| Product page build | – | 6.3 |
| Product orbit strip dots / "More" cards | 10 / 9 | **260 / 259** (the dots merge into a solid line) |
| Field: spacing between blips on the inner ring | ~33 px | **2.3 px** (rings become solid bands; 1,034 tab stops) |
| Images on first catalogue load | 23 MB (26 full-size PNGs) | similar here, because the test reuses 34 images; a real catalogue with unique images would be far heavier |

What this shows, in priority order:
1. **The catalogue's slowness is almost entirely the fade-in restart**: `apply()` forces a layout (`void el.offsetWidth`) for every card and row, about 2,000 per filter click. Filtering and reordering itself takes 3–42 ms at 1,034. Fix first: restart the animation once for the whole batch, and only for items near the viewport.
2. **Too many page elements.** All three views are built up front (20k elements). Build only the active view, then add load-more / windowed rendering for Grid and Index.
3. **The Field needs levels of detail**, not speed. Drawing is cheap (under 2 ms); legibility and keyboard access break. Plan: per-collection summaries with zoom, blips drawn on the canvas with hover lookup, one focusable radar with arrow keys, and a mirrored list for screen readers.
4. **Images are already the biggest cost at 34 pieces** (about 850 KB per PNG). Thumbnails and modern formats matter before anything else ships publicly.
5. **Homepage rails and the product page** need caps: about 12 featured per rail, and a window of ±5 dots plus about 12 "More" cards on the product page.

**Fixes applied after the first stress run** (catalogue.js):
- **The fade-in restarts once per batch.** Only the first 24 items animate, after a single layout for the whole batch. Before, every card and row forced its own layout.
- **Views are built when first shown.** Cards and index rows are created on demand and cached; Field blips are built the first time Field opens.
- **Grid and Index render in batches** of 48 cards / 120 rows.
  - A "Showing N of M · Show more ↓" row loads the next batch automatically when it comes within 600px of the viewport.
  - Clicking the button loads a batch and moves keyboard focus to its first new item.
  - Any filter, sort or view change starts again from the first batch.
- **Returning from a product page** renders as many batches as needed to reach that piece before scrolling to it.

Re-run at 1,034 pieces (same steps):

| Measure | Before | After |
|---|---|---|
| Filter click, avg / worst | 1,761 / 5,724 ms | **8.5 / 35 ms** |
| Switch to Index / Field | 5,724 / 3,371 ms | **5 / 35 ms** |
| Longest blocking task | 15,839 ms | **74 ms** |
| Page elements on load | 20,304 | **553** |
| Catalogue build | 41 ms | **2.7 ms** |

With the real 34 pieces, the catalogue now starts with 433 elements (was 802), and everything fits in the first batch, so nothing visible changed.

**Field levels of detail** (catalogue.js, "Field: levels of detail"). The Field picks one of three modes on every update:
- **Detail:** every piece in range is a blip on its collection ring. Used while 150 or fewer are in range and each ring has room (one blip per ~14px of ring circumference, so it depends on the radar's size). The real 34-piece catalogue is always in Detail.
- **Summary:** too many to plot. Each ring is drawn on the canvas as a textured density band (`:` per piece). Its label becomes a zoom button ("02 · 258"), and the contact panel becomes an Overview listing every ring with its count. Clicking near a ring also zooms in.
- **Zoom** (`?ring=<collection id>` in the URL): one collection fills the radar. Each piece keeps its stored bearing, so coordinates still match the product page. Pieces are dealt across up to 6 bands, more to the outer bands, by a smooth weighted round-robin, so spacing is even. The bands are a display layout, not part of the coordinate. "← All rings" or Escape zooms out and returns focus to that ring's button. When a busy field has only one ring in range (e.g. a collection filter at scale), it opens that ring directly and says "only ring in range".

How it scales:
- Only pieces that are in range and plotted get a link. Filtered-out pieces are faint canvas dots, so the page never holds more blips than are plotted.
- The radar is one tab stop (roving tabindex): arrows step around the orbit, Home/End jump to the ends, Enter opens. Screen readers hear each blip's full label.
- On touch screens (`hover: none`) the first tap on a blip selects it and shows "Selected · name · coordinate · Open ↗" just above the radar. A second tap on the same blip, or Open, goes to the product page. A slightly-off tap can't open the wrong piece.
- Returning from a product page to a busy field opens that piece's ring and focuses it.

Measured at 1,034 pieces, Field view:
- **Summary:** the whole page is 150 elements, with 0 links on the radar.
- **Zoom:** 260 blips, one tab stop, an 11–21 ms update and a 1.8 ms paint per frame, with no long tasks.
- **Spacing on a 375px phone, zoomed into 260 pieces:** a median of 12.9px between neighbours and at least 9.2px for 90% of them. A few pairs sit close (2.6px), where the synthetic bearings cluster; the tap-to-select step covers those.

**Images: thumbnails and modern formats.** The 34 supplied PNGs average about 880 KB (29 MB in total) but are shown at 90–300 CSS px wide.
- `build_images.py` writes 320px and 640px versions of each, as AVIF (quality 70) and JPEG (quality 82): 136 files, 7.2 MB, built in about 8 s. Re-running skips files already up to date.
- `art()` in shared.js now returns a `<picture>`: AVIF source first, JPEG `<img>` fallback, with `srcset` 320w/640w and a `sizes` hint. Cards use `160px`, the contact panel `200px`, the product stage `(max-width: 900px) 40vw, 300px`. The browser picks the format and size.
- The art-detail lens still uses the full-resolution original, because it magnifies 3.2×. It now sets that background only the first time the lens opens, instead of downloading it on every product view.
- The portable export inlines the 640px JPEG per artwork instead of the original, and stops with a message if a thumbnail is missing.
- The originals in `assets/` and their hashes in IMAGE-SOURCES.json are unchanged; thumbnails are derived files.

Measured (image bytes actually downloaded, in-app browser, 2× screen):

| | Before | After |
|---|---|---|
| Catalogue, first load | 23.3 MB (26 originals) | **0.47 MB** (25 AVIF thumbnails) |
| Homepage, scrolled through all four collections | about 28 MB | **0.36 MB** (30 thumbnails, about 12 KB each) |
| Product page, on load | original PNG (~1.9 MB for this piece) plus others | **0.09 MB** (640px AVIF on the stage) |
| Product page, art-detail lens opened | – | the original loads then (1.85 MB for this piece) |
| Portable export | 39.3 MB | **5.1 MB** |

**Limits on the homepage and product page.** Each limit only switches on above the current collection sizes (8–10), so the real site is unchanged.
- **Homepage rails** (`RAIL_LIMIT = 12` in index.html) show the first 12 pieces of a collection in curated order. A larger collection's rail ends with a "View all" card on the same orbit: a dotted circle with "+N", linking to `catalogue.html?collection=<id>`. The rail counter counts pieces, not that card. Returning from a product page for a piece beyond the 12 lands on the "View all" card. The shared garment-morph click handler now tolerates cards without a garment.
- **Product page orbit strip** (`ORBIT_WINDOW = 5` in product.js): above 11 pieces it shows the current piece and five either side, wrapping around the ring, with "···" at both ends. Dot labels use each piece's real position (e.g. "259").
- **"More on this orbit"** (`MORE_LIMIT = 12`): above 12 other pieces it shows the six before and six after the current one, in orbit order. Its link becomes "View all N in the catalogue ↗" (filtered to the collection) instead of the homepage rail.

Measured at 1,034 pieces:

| | Before | After |
|---|---|---|
| Homepage build | 71.5 ms | **4.6 ms** |
| Homepage rail layout per scroll, avg / worst | 5.5 / 19.8 ms | **0.67 / 2.1 ms** |
| Homepage, 21 scroll steps | 287 ms | **27 ms** |
| Homepage page elements | 9,698 | **706** |
| Product page elements (260-piece collection) | 3,250 | **308** |
| Product orbit strip dots / "More" cards | 260 / 259 | **11 / 12** |

**Catalogue data moved out of shared.js.** Until now all 34 pieces (about 20 KB, and about 0.5 MB at 1,000) were embedded in shared.js and downloaded by every page.
- **Source file.** The data now lives in `data/products.json`, made once from the old embedded data and checked field by field against the live site: 34 pieces × 14 fields plus the 4 collections, 0 differences. Prices, original prices, colours and names, which used to be calculated from position, are now explicit per piece, as a real catalogue would have them. "Reduced" now means `original > price`, not "in collection 3".
- **What each page loads** (sizes at 34 pieces):
  - Homepage: `data/home.json`, 9.2 KB. Collection counts plus each collection's first 12 pieces, so it stays the same size as the catalogue grows. The entrance radar no longer waits for anything; only the rails wait for the data.
  - Catalogue: `data/index.json`, 9.2 KB. Every piece, without the long description and status text.
  - Product page: `data/pieces/NN.json` (0.4 KB) for the piece, then `data/collections/<id>.json` (2.6 KB) for its orbit strip and "More" row. Loaded in about 9 ms locally.
- **Loading.** `getData()` asks the server to revalidate (`cache: 'no-cache'`), so edited data appears without bumping versions. Opened from disk (`file://`), where browsers block loading JSON, it loads `data/inline.js` once instead. The portable export embeds `data/home.json` and the featured thumbnails, so it still needs nothing else.
- **The bag** keeps the name and price from when each line was added, like a real basket, so it renders on any page without the whole catalogue. Older bag lines without that snapshot are filled in the first time their piece's data loads.
- **The homepage** knows only its featured pieces, so the product page's back link now also carries the collection (`index.html?piece=NN&collection=<id>`). A piece beyond the first 12 lands on that rail's "View all" card.
- **Unknown or malformed ids** (`?id=99`, `?id=../x`) show "Signal lost"; malformed ones never reach the network.
- **Stress mode** builds its synthetic pieces from `data/index.json` on whichever page it runs, so every page sees the same 1,034 pieces. A synthetic piece's product page borrows its description from the real piece it copies.

Checked: homepage, catalogue, product page (real and synthetic pieces, a reduced price, add to bag), the old-bag fill-in, "Signal lost", stress mode on all three pages, the `inline.js` fallback (all 40 files served under the loader's paths with no network requests), and the portable export (no requests to `assets/` or `data/`). No console errors. The `file://` path itself couldn't be run in the in-app browser, which shows local files as static snapshots.

Still open, for a real catalogue: server-side search and pagination once there are thousands of pieces or prices change often, and a build step that fingerprints file names instead of the hand-bumped `?v=` (data files no longer need it).

## Catalogue page

URL: `catalogue.html`, linked as CATALOGUE in the header on every page and as "View all 34 ↗" under the homepage COLLECTIONS intro. It lists all 34 pieces in three views of the same data. Grid is the default; Field and Index are one click away (`FIELD / GRID / INDEX` in the toolbar).

- **Grid**: the same garment cards as the homepage and the product page's "More" row. Each card's tag shows its coordinate (`R04 / 108°`) instead of "SIGNAL".
- **Index**: dense rows with number, piece, collection, colour, artwork, coordinate and price. A sweep line passes down the rows. Below 1100px the Colour column is dropped; on phones each row shows number, name, coordinate and price.
- **Field** (what makes this page different): one radar, with a ring per collection (01 innermost, as on the homepage locator) and a blip per piece at its bearing. These are exactly the coordinates its product page reports, because both use `bearingOf()` in shared.js. Filled blips are chalk; hollow blips are washed black. An ASCII sweep turns counterclockwise, and each blip pings as the beam crosses it. The **contact panel** beside the radar tracks what the sweep finds, changing at most every 1.7 s so it stays readable. Hover, focus or the arrow keys select a blip and lock the panel to it, releasing back to tracking 2.5 s after you leave. "Open piece" (or the blip itself) opens the product page with the garment morph.

Filters: Collection, Colour and Artwork, plus Sort (Orbit, Price ↑, Price ↓, Name) and Search.
- Search matches name, artwork title, discipline, category, collection and colour. It ignores accents ("lótus" finds Lotus), and every word must match.
- Pressing `/` focuses the search box.
- The plan's "End of season" price toggle was dropped: only that collection has markdowns, so the Collection filter already covers it.
- In Grid and Index, filtered-out pieces are removed and the rest fade in. In Field they stay as faint, non-interactive dots, so the map keeps its shape.
- The count reads "NN of 34 in range" or "No signal". A polite live region announces it, waiting until typing pauses.
- "Clear ×" resets filters and search but keeps the view and sort.
- The filters scroll away; the slim toolbar stays pinned. On phones the filters (and sort) live behind "Filter +", which opens directly under the pinned toolbar and scrolls itself into view.

State lives in the URL, e.g. `catalogue.html?view=field&colour=black&q=leaf`; default values are left out. The browser's address is updated with `replaceState` (debounced while typing), so shared links restore the same view.

Round trip with the product page: catalogue links add `&from=catalogue`. The product page then shows "← Catalogue" as its crumb, and its previous/next, orbit dots, arrow keys, swipes and "More" cards keep that flag. The crumb returns to `catalogue.html?<last catalogue query>&piece=NN`, using `radar-catalogue` from sessionStorage. The catalogue then centres that piece's card, row or blip, focuses it, flashes a dashed outline, selects it in the contact panel (Field), and tidies the URL. Without the flag, the product page behaves as before ("← Collections / Tees" back to the homepage rail).

Also changed for the catalogue:
- `bearingOf()` moved from product.js into shared.js.
- `.crumb`, `.visually-hidden` and `[hidden]` moved into shared.css.
- `.nav a[aria-current=page]` is underlined.
- The garment-morph reset on `pageshow` also clears `[data-morph]` (the contact panel's garment).
- The garment light on catalogue cards, the contact panel and the product page's "More" cards uses the same feathered oval as the product stage, so none shows a hard top edge.

Checked in the in-app browser:
- Desktop (1440 and ~800 wide) and 375×812, dark and light.
- Filters, sort, accented search, the empty state, URL and sessionStorage state.
- View switching by real clicks.
- Field hover, focus and arrow keys (dimmed blips are skipped).
- The return landing for Field.
- The mobile filter panel from deep in the page.
- No console errors once the browser had fresh copies of the files.

Homepage: the only changes are the CATALOGUE nav link and the "View all 34 ↗" link. Compared with the pre-catalogue homepage, computed style by computed style (1,272 element and pseudo-element entries at 1280×800 and 375×812, dark and light, with the three new elements excluded): the only differences are the nav's width, the intro paragraph's height and, on mobile, the page height growing by 32px to make room for the link. That temporary harness is in the macOS Trash (`radar-catalogue-baseline-…`).

Caching: the local preview server sends no cache headers, so a browser can keep an old shared.js after edits. That happened here as "bearingOf is not defined". Every page now links its CSS and JS with a version string (`?v=2026-10-05b`). Bump it in index.html, product.html and catalogue.html whenever shared or page files change. export.py matches the links with or without the version.

## Product page

URL: `product.html?id=NN`, where NN is the two-digit catalogue id (`01`–`34`; `?id=1` also works). The page reads name, price, collection, artwork and position from the shared catalogue, so homepage and product page can never disagree. An unknown id shows a "Signal lost" state with a link back.

It follows the homepage look: black or warm paper, mono uppercase labels, ASCII radar, dotted orbits, lit garments, the same header, footer and bag. Layout on desktop: a sticky stage (garment and radar, about 60% wide) beside a scrolling details column. Below both: an orbit strip, then "More on this orbit". At 900px and below it stacks, and the Add to bag button sticks to the bottom of the screen.

What is different from the homepage:

- **Lock-on radar** (`.lock-field` canvas, the "Lock-on radar" block in product.js). On arrival the ASCII sweep makes 2¼ decelerating turns and stops at the piece's bearing. A dotted reticle closes from 2.6× to 1× around the garment, with cardinal ticks. A `:` beam marks the bearing. The readout counts `Scanning 000–100%` → `Locking` → `● Signal locked / NN`. After the lock, a dim slow sweep keeps the field alive. It uses the same tone table and glyph gradient as the entrance, pauses offscreen and in hidden tabs, and with reduced motion draws the locked state once.
- **Bearing**: the piece's place around its collection orbit (`position / count × 360°`). Ring `R0N` is the collection number, matching the homepage locator.
- **Size rings**: XS (innermost) to XL as concentric dotted SVG rings; the chosen ring turns solid. It is a real `radiogroup`: roving tabindex, arrow keys / Home / End, `aria-checked`. Chest readings (96–120 cm) are illustrative.
- **Add to bag**: disabled until a size is chosen. Adding updates the persistent bag, pings the BAG counter, and announces through a polite live region. The button reads "Added / M ✓", then "Add another / M".
- **Front / Back**: the back is plain fabric with a small RADAR neck mark, because no back artwork was supplied. The switch reveals the new side with a conic "radar wipe" mask (`@property --sweep`). Art detail is disabled on the back.
- **Art detail loupe**: a 3.2× circular lens over the artwork, with a dotted ring, a crosshair and an `X / Y` readout. It follows the mouse, or a finger drag on touch. With the keyboard, the garment becomes focusable: arrow keys move the lens and Escape closes it. It measures the drawn (contained) image, so the zoom lines up exactly.
- **Readout**: colour, shape, artwork, discipline, category, bearing and source, set as instrument rows. Then "Signal notes" (the reference description and status).
- **Orbit strip**: previous and next pieces (wrapping around) with all pieces of the collection as dots on a shallow arc; the current one is haloed. Left/right arrow keys (when nothing is focused) and horizontal swipes on the stage move along the orbit.
- **Garment morph**: cross-document View Transitions (`@view-transition` in shared.css). Clicking a card names only that card's garment `piece`, so it morphs into the product stage, whose `.tee-view` carries the same name. Names are cleared on `pageshow`, so going back and choosing again never duplicates a name. Reduced motion disables it. Browsers without support navigate normally.
- **Back to the homepage**: the crumb ("← Collections / Tees", shortened to "← Tees" on phones) and "View all" link to `index.html?piece=NN`. On its first frame, the homepage scrolls so that piece is in focus on its rail (or sets the rail directly with reduced motion). It then tidies the URL to `#collection-id`.

Garment light on the stage: the shared halo (`.garment-space:before`) is a radial gradient sized to the farthest corner. On the tall product stage it was still visible where its box ended, leaving a hard top edge and side edges. The box is enlarged and masked with `radial-gradient(closest-side, #000 62%, transparent)`, so the light always fades to nothing inside its own box, for every tee colour and theme. This rule now lives once in shared.css (`.garment-space:before`), so it covers homepage rail cards too (where the same hard top edge showed on tall cards), catalogue cards, the contact panel, the product stage and the "More" row. The earlier page-specific copies in product.css and catalogue.css were removed.

Decisions taken when building it (the defaults proposed in the plan):

1. Back view: plain fabric with a neck mark.
2. The standalone export stays homepage-only. Its product links work only when opened from this folder.
3. Everything in the plan is built: lock-on, size rings, loupe, readout, orbit strip and morph.

Checked in the in-app browser at 1440×900, 800px wide and 375×812, in dark and light mode: rendering, keyboard size selection, adding and changing quantities across pages, front/back, loupe, the sticky stage releasing at the orbit strip, return landing, the not-found state and the console (no errors). The morph's wiring was checked: exactly one element is named on each side, and the browser supports it. The animation itself wasn't watched, because the preview pane was hidden at the time.

## Shared-file refactor

Before building the product page, the data, theme, bag and menu code moved from index.html into shared.js. The tokens, reset, header, dialogs, garments, footer and bag rules moved from index.html and collections.css into shared.css. The light token block became `:root[data-theme=light]`, so it still beats `:root` now that shared.css loads before the inline style. Dead rules from the old inline detail panel (`.inline-piece`, `.piece-add`, `.size-choice`, `.open-collection`, `[aria-expanded]`) were deleted.

Verified by loading the pre-refactor homepage and the new one in same-size frames and diffing the computed style of every element and pseudo-element: 1,272 per view, at 1280×800 and 375×812, dark and light. The only difference is the BAG button becoming `position: relative` (no offsets) to anchor its add-to-bag ping. That temporary harness is in the macOS Trash (`radar-refactor-baseline-…`).

Other small changes from the move: the bag now persists and has quantity controls and a total. Escape now also resets the mobile menu button's label to "Menu +" (it used to stay "Close −"). Product links are now `product.html?id=NN` only.

## Locator and footer cleanup

The collection locator (bottom-right ring radar) no longer overlaps the footer. As the footer scrolls into view, `syncCollections()` sets `--lift` on `.mini-radar` to the footer's overlap. That raises its `bottom` offset, so the locator stays inside the last collection tile.

Locator rings are now inline SVG circles inside each ring button, replacing the 1px CSS `dotted` borders, which rendered unevenly and blurred under the mobile scale. `pathLength` plus `stroke-dasharray:0 1` with round caps gives evenly spaced round dots, about one every 3px. The current collection's ring is a solid line, and hover brightens the dots. Strokes are thicker below 700px to offset the 0.64 scale. Both themes are styled.

The footer's "View previous version" link and "Rollback checkpoint saved" note are removed. All previous-version backups (`checkpoints/` and `rollback_frontliners.py`, `rollback_contrast.py`) were moved to the macOS Trash, in a `radar-previous-versions-…` folder, not deleted.

## Light mode

A LIGHT / DARK control sits in the header nav (and in the mobile menu) on the homepage, and top right on product.html. The choice is stored in `localStorage` under `radar-theme` and shared by both pages. Dark stays the default. A small inline script in `<head>` applies the stored theme before first paint, so light-mode visitors see no dark flash.

How it works: the theme is a `data-theme` attribute on `<html>`. Light rules are scoped to `[data-theme=light]`; shared ones live in shared.css, homepage-only ones at the end of collections.css. It sets warm paper `#f3f2ee`, ink `#141414`, muted `#6b6b6b` and rule `#d9d8d3`, and overrides the hardcoded greys for the entrance, collections, captions, mini radar, footer and bag dialog. No dark rule was edited, so dark mode looks the same as before. The white logo is darkened with `filter: invert(.92)`; no new asset is needed.

Canvases: all three renderers (entrance ASCII radar, collection arc fields, focus echoes) now take colours from a shared `tones` table. In dark mode, `tones[v]` is `rgb(v,v,v)`, exactly the strings used before. In light mode, the same value is subtracted from the paper colour, so every mark keeps its contrast against the background. The entrance's static grid and rings moved into `paintBase()`, so a theme switch repaints them without resetting the sweep's afterglow. A `radar:theme` event redraws all collection canvases, so inactive ones never keep marks in the old theme. Reduced motion is covered by the same redraw.

Garments are product imagery and are identical in both themes. Only the backdrop behind them changes. In light mode, chalk garments get the stronger soft-grey halo and washed-black garments the faint one, the reverse of dark mode.

## Product cards link to a product page

Clicking a product card no longer opens the inline detail footer (size picker / add-to-bag panel under the rail). Cards are now real links (`<a class="product-card">`) to the product page, so open-in-new-tab and keyboard Enter work. (Superseded: see "Product page" above.)

Removed from index.html: the card click handler, `closePiece()`, the `.inline-piece` panel markup, the `openId` rail state (rail pause, arc re-centre and scan freeze when a piece was open) and the Escape-to-close hook. Rail scrolling, arc layout and the collection radar are unchanged. The leftover dead CSS was deleted in the shared-file refactor, and add-to-bag now lives on the product page.

The standalone RADAR-Gallery-to-Archive.html does not include product.html; open it from this folder.

## Current experiment: COLLECTIONS

The entrance radar renderer is unchanged. The prior feature, selection, archive and index sections have been replaced by four clothing collections: New arrivals, Best sellers, End of season and Tees. Vertical page scroll advances each rail along a shallow dotted arc. Horizontal trackpad input, dragging, swiping and arrow keys also browse the cards. The miniature collection radar supports direct ring clicks and keyboard activation. Product details open inline, centre the selected card and pause the rail. Sizes and a local concept bag are interactive; checkout is not connected. All 34 supplied references appear on clearly illustrative garment placeholders; prices are samples.

## Earlier iterations

### Garment contrast refinement

Feathered charcoal lighting separates garments from the black catalogue background, with stronger lighting for washed black shirts. The centred garment has a modest scale and lighting emphasis; neighbouring products remain legible. Names and prices sit on a clean black surface with brighter type and a fine divider. Catalogue ASCII scanning is softly masked around garments and fully masked around captions; dotted arcs are positioned below the focused garment's hem. Foreground masks are cached when layout changes, rather than measured every animation frame. The entrance radar renderer and browsing controls are unchanged.

### Orbit alignment and spacing

Garment centres and the primary ASCII radar layer now use the same circle equation. Card positioning accounts for the caption height and garment scale, so the clothing centre lies on the orbit while browsing, after resize and when inline details open. All three radar layers share one centre and evenly spaced text marks. The primary layer is slightly brighter so its path is readable between garments. Product spacing increases from 42px to 88–160px on desktop and from 24px to 80px on mobile. Keyboard navigation uses the actual card interval. Rail focus no longer causes a vertical scroll offset. Static orbit alignment remains in reduced motion mode.

Directly authored browser mockup. Quiet monochrome entrance → full featured photograph → four selected references → dense 34-image archive → index.

Every content image is copied unchanged from an attachment supplied by the user. The new lotus photograph is the Signal in the wild feature. The 17 earlier nature/digital references and all 16 later culture/documentary references are included, with the new feature bringing the collection to 34. The supplied logo is preserved.

Generated campaign/product imagery and generated graphic placeholders are removed from this mockup. All entries are labelled as references rather than claimed RADAR commissions. Existing marks and photographer credits inside the images are preserved.

Images display in full within their frames. Archive filters group Images, Graphics, and Objects & clothing. The original reference files and their hashes are recorded in IMAGE-SOURCES.json.

index.html is the editable source. RADAR-Gallery-to-Archive.html is the self-contained browser version.

The canvas is black throughout, including media frames and detail dialogs. The logo is horizontally centered in the header. A very faint static radar field and procedural grain are confined to the entrance. The bottom-right entrance annotation is removed.

- Entrance now fills the viewport on desktop and mobile, with radar contrast increased for visibility and slightly stronger fine grain.

- Radar centered in the entrance. Added locally drawn animated grain in the scanning beam, with scroll velocity driving a temporary acceleration. Animation pauses off screen and respects reduced motion.

- Expanded centered radar past all viewport edges. Replaced instrument rings with irregular broken contours and offset echoes; scan uses diffuse torn grain and interference bands. Scroll acceleration is retained.

- Restored evenly spaced circular rings and straight axes. Leading scan remains straight; abstract grain and animated wavy echoes appear only in the fading wake. Full viewport coverage and scroll acceleration retained.

- Simplified the scan to a straight regular sweep with a smooth grainy gradient. Removed the wavy wake; retained even rings, full viewport coverage, and scroll acceleration.

- Updated to the newly supplied logo, preserving the previous asset. Replaced radar visuals with upright ASCII glyphs for the grid, circular rings, sweep and fading trail. The existing counterclockwise animation clock and scroll speed behavior are retained. This mockup had no mouse detection listener, so a passive pointer hook now renders brief cats, rabbits, sparkles and hearts in the background; it also accepts a radar:detect event. Cached static geometry, capped rendering and blip counts, resize handling and reduced motion support keep the layer lightweight and unobtrusive.

- Current scanner: removed all mouse creatures, clouds, impacts and bursts. Concentric outlines use identical dots at equal arc intervals; grid characters and spacing are consistent. A broad 117-degree ASCII sweep draws every cell with a continuous character-weight gradient. Recently scanned cells retain a dim, gently shimmering afterglow that decays exponentially. Counterclockwise rotation, scroll acceleration, full viewport entrance and reduced motion behavior are retained.
