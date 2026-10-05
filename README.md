# RADAR STUDIO

A storefront for RADAR STUDIO's clothing pieces, built around an ASCII radar:
every piece sits at a coordinate on its collection's ring. Shopify holds the
catalogue (headless); the site itself is plain HTML, CSS and JavaScript with no
framework and no build step, hosted on Cloudflare Pages.

- **Home** (`index.html`): an entrance radar, then one section per collection
  with its pieces riding an orbit.
- **Catalogue** (`catalogue.html`): every piece as a grid, an index table or
  one radar field, with filters, sort and search.
- **Product** (`product.html`): one piece, located on its orbit, with its
  views, sizes and the concept bag.

## Folder structure

```text
radar-stdio/
├── public/               everything served to visitors (Cloudflare's output directory)
│   ├── index.html, catalogue.html, product.html
│   ├── js/
│   │   ├── core/         shared foundations: shared.js (data, artwork, theme, bag, menu),
│   │   │                 radar.js (radar drawing helpers), config.js (generated)
│   │   ├── home/         homepage modules
│   │   ├── catalogue/    catalogue modules
│   │   └── product/      product page modules
│   ├── css/              shared.css plus one stylesheet per page
│   ├── data/             catalogue data: products.json (source) and generated JSON
│   ├── assets/           images and media; assets/thumbs/ is generated
│   └── _routes.json      Cloudflare: only /api/* runs Functions
├── functions/api/        Cloudflare Pages Functions (the Shopify webhook)
├── scripts/              developer and build scripts (Python 3, standard library only)
├── tests/                automated tests (Node's built-in test runner)
├── docs/                 notes, the Shopify plan, image provenance
├── legacy_assets/        unused files kept for reference; nothing links to them
├── AI_CODING_RULES.md    coding rules for people and AI assistants
└── package.json          developer tooling (Prettier, ESLint)
```

How the JavaScript is organised (classic scripts, one global per file, load
order) is described in [AI_CODING_RULES.md](AI_CODING_RULES.md).

## Requirements

- Python 3 (standard library only).
- Node.js 18.18 or later, for the developer tooling only. The site itself
  needs nothing installed.
- macOS for `scripts/build_images.py` (uses the built-in `sips`) and
  `scripts/make_demo_video.swift`.

## Local development

```bash
npm install
python3 -m http.server 8417 --directory public
```

Then open http://localhost:8417. The pages also work opened straight from
disk, using the bundled `public/data/inline.js`.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Everything below that verifies: formatting, lint, tests. Run before committing. |
| `npm run format` | Format JavaScript, CSS and JSON with Prettier. |
| `npm run lint` | Check JavaScript against the Google style and clean-code rules (ESLint). |
| `npm test` | Run the automated tests. |
| `python3 scripts/build_data.py` | Split `public/data/products.json` into the files each page loads, and validate it. |
| `python3 scripts/build_images.py` | Make the AVIF/JPEG thumbnails in `public/assets/thumbs/`. |
| `python3 scripts/build_config.py` | Write `public/js/core/config.js` (public Shopify settings) from the environment. |
| `python3 scripts/export.py` | Build `public/RADAR-Gallery-to-Archive.html`, a self-contained copy of the homepage. |
| `python3 scripts/sync_shopify.py` | Read the catalogue from Shopify into `products.json`. |

The Shopify import, webhook and check scripts are described at the top of each
file in `scripts/`.

## Environment variables

Copy `.env.example` to `.env` (never commit `.env`) and fill in what you need.
Without any Shopify settings the site runs on the committed catalogue.

| Variable | Used by |
|---|---|
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION` | all Shopify scripts, `config.js` |
| `SHOPIFY_STOREFRONT_PUBLIC_TOKEN` | `config.js` (safe to expose) |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | server-side checks only |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Admin API (sync, import, webhooks); the secret also verifies webhooks |
| `DEPLOY_HOOK_URL` | the webhook function: triggers a Pages rebuild |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_PAGES_PROJECT` | optional: lets the webhook skip redundant builds |

## Deployment (Cloudflare Pages)

The project builds from `main`. Settings (Pages → Settings → Builds):

| Setting | Value |
|---|---|
| Build command | `python3 scripts/sync_shopify.py --if-configured && python3 scripts/build_data.py && python3 scripts/build_config.py` |
| Build output directory | `public` |

Shopify webhooks call `/api/shopify-webhook`, which triggers a rebuild, so
catalogue edits in the Shopify admin go live without a commit. Details:
[docs/shopify-plan.md](docs/shopify-plan.md).

## Contributing

Work on `develop`; `main` is what Cloudflare deploys. Follow
[AI_CODING_RULES.md](AI_CODING_RULES.md), and run `npm run check` before
committing.
