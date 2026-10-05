# Refactor changelog (October 2026)

The refactor of RADAR STUDIO from a flat folder of files into the current
layout, with shared coding rules and automated checks. It ran in four phases,
from the snapshot `ed6dc91` to the commit that adds this file. The Shopify
work (commits `9f6d3ee`, `06d919c`, `996480b`) happened alongside it and is
described in [docs/shopify-plan.md](docs/shopify-plan.md).

**Behaviour:** the site, the generated data and the scripts work exactly as
before, apart from the few intentional changes listed under
[Intentional behaviour changes](#intentional-behaviour-changes). Each step
was compared old against new (see [Verification](#verification)).

## Where things moved

There were two moves. The first organised the flat folder into `site/` and
`tools/` (Phase 1). The second renamed those to `public/` and `scripts/`,
following the folder-structure guide, and split the large scripts into
modules (Phase 2). The table maps every original path, and the interim
path, to where it lives now.

| Original (snapshot) | Interim (Phase 1) | Now |
|---|---|---|
| `index.html` | `site/index.html` | `public/index.html` (inline script → `public/js/home/`, inline styles → `public/css/home.css`) |
| `catalogue.html` | `site/catalogue.html` | `public/catalogue.html` |
| `product.html` | `site/product.html` | `public/product.html` |
| `shared.css` | `site/styles/shared.css` | `public/css/shared.css` |
| `collections.css` | `site/styles/collections.css` | `public/css/home.css` (merged with index.html's live inline styles) |
| `catalogue.css` | `site/styles/catalogue.css` | `public/css/catalogue.css` |
| `product.css` | `site/styles/product.css` | `public/css/product.css` |
| `shared.js` | `site/scripts/shared.js` | `public/js/core/`: `format.js`, `storage.js`, `dev-tools.js`, `data.js`, `artwork.js`, `pieces.js`, `theme.js`, `bag.js`, `navigation.js` |
| (new) | | `public/js/core/radar.js`: radar drawing shared by every page's radar |
| `catalogue.js` | `site/scripts/catalogue.js` | `public/js/catalogue/`: `catalogue.js`, `catalogue-state.js`, `catalogue-field.js`, `catalogue-radar.js`, `catalogue-contact.js` |
| `product.js` | `site/scripts/product.js` | `public/js/product/`: `product.js`, `product-lock.js`, `product-media.js`, `product-lens.js`, `product-sizes.js` |
| (inline in `index.html`) | | `public/js/home/`: `home.js`, `home-entrance.js`, `home-collections.js`, `home-arcs.js`, `home-locator.js` |
| | `site/scripts/config.js` (generated) | `public/js/core/config.js` (generated) |
| `data/`, `assets/` | `site/data/`, `site/assets/` | `public/data/`, `public/assets/` |
| | `site/_routes.json` | `public/_routes.json` |
| `RADAR-Gallery-to-Archive.html` (tracked) | `site/RADAR-Gallery-to-Archive.html` (generated, ignored) | `public/RADAR-Gallery-to-Archive.html` (generated, ignored) |
| `build_data.py`, `build_images.py`, `export.py` | `tools/…` | `scripts/…` |
| | `tools/build_config.py`, `check_shopify.py`, `shopify_api.py`, `shopify_import.py`, `sync_shopify.py`, `shopify_webhooks.py` | `scripts/…` (same names) |
| | `load_env()` in `tools/build_config.py` | `scripts/environment.py` |
| (new) | | `scripts/paths.py`: every repository path, defined once |
| `tools/make_demo_video.swift` | `tools/make_demo_video.swift` | `scripts/make_demo_video.swift` (unchanged) |
| `NOTES.md` | `docs/NOTES.md` | `docs/notes.md` |
| `IMAGE-SOURCES.json` | `docs/IMAGE-SOURCES.json` | `docs/image-sources.json` |
| screenshots, mockups, 9 unused images | `legacy_assets/` | `legacy_assets/` (`mockups/`, `previews/`, `unused-references/`) |

New at the root: `README.md`, `AI_CODING_RULES.md`, this file, `package.json`
(Prettier, ESLint, TypeScript and the npm commands), `pyproject.toml` (ruff,
mypy), `eslint.config.mjs`, `tsconfig.json`, `.prettierrc.json`,
`.prettierignore`, `types/` and `tests/`. The type check (below) added
`public/js/core/dom.js`.

## Phase 1: organise the folders

`256ab82`: the publish root became `site/` and the build scripts moved to
`tools/`, repointed at it. `NOTES.md` and `IMAGE-SOURCES.json` moved to
`docs/`. Unreferenced screenshots, mockups and 9 unused reference images
moved to `legacy_assets/` (nothing links to them). The generated portable
export stopped being tracked.

## Phase 2: refactor and modularise

**Tooling.**
- `be9d568`: Prettier formats the code.
- `1f0f268`: ESLint checks it against Google JavaScript style and
  clean-code rules: at most three parameters, descriptive names, braces, no
  silent `catch`, typed JSDoc. Prettier moved to 80 columns.
- `46ce834`: the CSS was formatted with Prettier.

**Shared code.**
- `a9db79d`: `shared.js` was formatted and documented, and gained shared
  helpers (`pad`, `priceHtml`, `colourOf`, `localStore`/`sessionStore`,
  `STORAGE_KEYS`) that replaced copies in other files.
- `ace428a`: it then split into the nine core modules. Each module defines
  only the globals it lists, keeps its internals private, and declares its
  interface in `/* exported */` and `/* global */` lines.
- `radar.js` holds the canvas primitives shared by the site's ASCII radars.
  Its functions take options objects.

**Pages.**
- Catalogue (`c8d8b44`, `32a9ee8`): `catalogue.js` split into the page,
  pure URL/filter state (testable), the field view, its canvas and the
  contact panel.
- Product (`cf39be0`, `fd1c6e9`): `product.js` split into the page, the
  lock-on radar, media, the art-detail lens and sizes.
- Home (`90d905d`, `c4ece67`): the ~340-line inline script in `index.html`
  became the home modules, with the rail canvases split out to
  `home-arcs.js`.
- Across all three:
  - every page module exposes `markup()` and `mount({...})`
  - boolean flag parameters became separate functions
  - long functions were split into named parts
  - single-letter names are gone

**Folders.** `23c8bbb` applied the folder-structure guide:
- `site/` became `public/`, and `site/scripts/` became the feature folders
  `public/js/{core,home,catalogue,product}/`.
- `site/styles/` became `public/css/`.
- `tools/` became `scripts/`.
- File names in `docs/` are lowercase.

**CSS.** Each page now has one stylesheet, every selector is defined once,
and there are no inline styles.
- `ed163a8`: `shared.css` duplicate rules were merged, and the dead `.close`
  rule was removed.
- `18e9165`: `collections.css` became `home.css`, merged with the live parts
  of `index.html`'s inline `<style>`. About 110 dead rules from the old
  Gallery-to-Archive design were removed.
- `bdd0f8e`: `catalogue.css` and `product.css` were merged and grouped. New
  shared classes replace patterns repeated across pages: `.page-title`,
  `.radar-canvas`, `.ring-svg`, `.readout-label`/`.readout-value` and the
  `.product-card` basics.

**Python** (`88d2269`), following the Google Python style guide:
- Every script now has a docstring, a `main()`, `argparse` options and type
  annotations. Nothing runs at import time.
- Shared code moved into `paths.py`, `environment.py` and `shopify_api.py`.
- `build_data.py` raises `CatalogueError` instead of using `assert`, which
  `python -O` strips.
- Long functions became small classes: `CatalogueReader` and `StoreCheck`.
- ruff (lint and format) and mypy (strict) check the scripts.

**Webhook and tests** (`be13772`): the Pages Function was brought to the
same standard. `tests/` holds 29 JavaScript tests (Node's runner, a fake
browser in a `vm` context). `88d2269` added 46 Python tests.

## Phase 3: documentation

- Every JavaScript file starts with `@fileoverview` and has typed JSDoc on
  every function. Every Python file starts with a module docstring.
- Comments explain only what isn't obvious from the code.
- `README.md` covers purpose, layout, setup, commands, environment variables
  and deployment.
- `docs/notes.md` opens with a current project map. Its later sections are
  a dated working log, so they keep the file names of their time; use the
  table above to translate them.
- `docs/shopify-plan.md` uses the current paths.

## Phase 4: coding rules

[AI_CODING_RULES.md](AI_CODING_RULES.md) (`e578183`, rewritten in `620c61a`
and extended with the CSS and Python sections) is the standard for every
change. It covers:
- project structure and tooling
- Google JavaScript style, clean code and modularisation
- site rules, CSS, Python and documentation
- cache-busting
- deliberate deviations
- verification, git and deployment

`npm run check` enforces what can be enforced: Prettier, ESLint, ruff, mypy
and both test suites.

## Type checking

The JavaScript stays plain JavaScript, served exactly as written, but
TypeScript's compiler now checks it (`tsc` in `npm run lint`, strict mode,
nothing compiled). Converting the files to `.ts` was ruled out: browsers
can't run `.ts`, and the site depends on having no build step (pages open
from disk, and `export.py` inlines the source).
- **Setup:**
  - `tsconfig.json` checks `public/js/` and `functions/`.
  - `types/browser.d.ts` declares the two globals the scripts read but don't
    define.
  - TypeScript 6.0 is pinned for Node 18.
  - ESLint's JSDoc rules now expect TypeScript's dialect: `object`,
    `Record<…>`, function types with a return type.
- **First run:** 542 errors. About 220 were element lookups that could
  return null, and 126 were properties missing from a declared type.
- **The fixes:**
  - `core/dom.js` adds typed lookups. `element()` fails straight away,
    naming the selector, if the markup is missing an element; before, the
    page failed at that element's first use. It also adds `elements()`,
    `closestTarget()` and `targetElement()`.
  - `radar.context2d()` returns a canvas's 2D context.
  - Typedefs replace loose `Object` types: radar cells and points, ring
    bands, ping targets, foreground zones and `PieceRecord`.
  - `MediaItem` became a union of `GarmentView`, `ImageView` and
    `VideoView`, matching what `build_data.py` already checks.
  - Real loose ends were tightened: `hidden` can be the string
    `'until-found'`, and a deployment may have no stage.
- **Not type-checked:** the tests. ESLint still checks their JSDoc.

## Intentional behaviour changes

- A bag changed in another tab is validated like the bag on load
  (`a9db79d`).
- Homepage collection numbers use `pad()`, which gives identical output
  below 10 collections. Collection ids are escaped in markup like every
  other data value (`90d905d`).
- The Python scripts reject unknown options and gain `--help`. A store with
  no Headless channel stops the sync with a message instead of a traceback
  (`88d2269`).
- An invalid catalogue makes `build_data.py` exit with
  `build_data: <message>` instead of an assert traceback. The checks, their
  order and their messages are unchanged.
- A missing element now fails with `Missing element: <selector>`, where the
  page used to fail later with a null-property error. The art-detail lens
  ignores input before the page has given it a view, where it used to
  throw (type checking).
- Asset versions were bumped with each change. They are now `?v=2026-10-05j`
  on every page.

## Verification

Each step was checked old against new, with a control that catches a
deliberate one-line change. Results that vary between runs were also
compared old against old.
- **JavaScript:**
  - rendered HTML, URL, focus, scroll, bag and storage state across 20–35
    states and interactions per page, side by side in the browser
  - core helpers compared in a Node `vm` harness
- **CSS:** the computed style of every element and pseudo-element on all
  three pages, in 39 states, at widths 1280, 950, 820, 720 and 390, in both
  themes.
- **Type checking:** old and new matched across 33 scenarios on the three
  pages:
  - every view, filter, search and keyboard path
  - field zoom
  - media, lens and sizes
  - the bag
  - stress mode and mobile width
  - returning from a product page

  Two differences appeared once each, and both were sweep or animation
  timing: the re-runs matched exactly.
- **Python:**
  - generated data, `config.js`, the portable export and the thumbnails are
    byte-identical
  - the Shopify scripts made identical requests, printed identical output
    and wrote the same `products.json` when run against a fake store with
    edge cases; nothing touched the real store

## Deployment note

Cloudflare Pages must use the new paths, or production builds of `main` will
fail (the site stays up on the last good deployment):

| Setting | Value |
|---|---|
| Build command | `python3 scripts/sync_shopify.py --if-configured && python3 scripts/build_data.py && python3 scripts/build_config.py` |
| Build output directory | `public` |
