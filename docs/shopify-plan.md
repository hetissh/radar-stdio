# Plan: Shopify backend, end to end

Status: **parked** (drafted 2026-10-04; not started). Pick up from "Decisions needed" at the end.

Progress (2026-10-05): prerequisite A6 is done. The project is in git (`github.com/hetissh/radar-stdio`, branches `main` and `develop`) and reorganised so `site/` is the publish root, with build scripts in `tools/`. Decisions 1 and 2 are made: a Partner **development store**, hosted on **Cloudflare Pages**. Phase 0 is in progress (see "Phase 0: setup" below). Store `radar-stdio-dev.myshopify.com` is created, with the Headless channel installed. Both Storefront tokens are verified with `tools/check_shopify.py` (API 2026-10 served, 0 products). The Dev Dashboard app is installed and its Admin token verified. Cloudflare Pages can be connected to `main` (pushed 2026-10-05). **Phase 1 is done.** The store is in INR. `tools/shopify_import.py` imported all 34 pieces and 4 collections in 3 min 15 s, and the read-back check passes ("all fields round-trip"). The Storefront API sees 34 products on the Headless channel, the store holds 34 files (one artwork each, none duplicated), and the sold-out test sizes are in place. Next: Phase 2 (`tools/sync_shopify.py`, Shopify as the data source).

## The approach

Keep the custom front end (radar, catalogue, product page) and use **Shopify for everything commerce**: products, prices, stock, cart, checkout, payments, orders, tax, shipping and customer emails. This is a "headless" setup. Pages keep loading the same kind of fast `site/data/*.json` files, but those files are generated from Shopify instead of `site/data/products.json`. Anything that changes minute to minute (stock, price) and the bag itself talk to Shopify live. Checkout is Shopify's hosted checkout, which handles payment security and compliance.

```
Shopify admin (edit products, prices, stock, media)
   │  webhook: "product changed"
   ▼
Small server function ──► rebuilds data/*.json from Shopify ──► static site (radar, catalogue, product)
                                                                   │  live, from the browser:
                                                                   │  price + stock, cart
                                                                   ▼
                                                     Shopify checkout ──► payment, order, emails
```

Why not Shopify's own front-end framework (Hydrogen)? It would mean rewriting the site in React. The headless route keeps the current design and code.

## Prerequisites

### A. Accounts and access (the owner creates these; credentials are never typed in by Claude)

| # | Item | Notes |
|---|---|---|
| 1 | Shopify Partner account (free) | Lets you create a free development store |
| 2 | Development store | Building and testing, test payments only |
| 3 | Headless sales channel on that store | Gives a *public* Storefront API token (safe in the browser) and a *private* one (server only) |
| 4 | Custom app with Admin API access (dev store) | For the one-time import and webhooks. Never in the browser |
| 5 | Production store and plan | Before launch. Check current plan pricing and that it includes the Headless channel |
| 6 | Git repository | **Done** (2026-10-05): `github.com/hetissh/radar-stdio` |
| 7 | Hosting for the site and one small server function | e.g. Vercel, Netlify or Cloudflare Pages |
| 8 | Domain and DNS access | Shop domain and storefront domain |

Keys go into a local `.env` (never committed) and the host's secret settings.

### B. Business setup (for real payments, not for development)
- Legal entity, address and GSTIN.
- Bank account and KYC for payouts.
- Payment gateway: Shopify Payments has historically not been available in India; Indian stores usually connect Razorpay, PayU or Cashfree through Shopify checkout. Confirm for the store. Development uses Shopify's test ("Bogus") gateway.
- Policies: shipping, returns/refunds, privacy, terms.
- Shipping zones and rates, product weights.

### C. Catalogue decisions (before the import)
- Final names, SKUs, prices (GST-inclusive or not), sale prices, stock per size.
- Sizes XS–XL as real Shopify variants (own stock, can sell out); chest measurements from the real size chart.
- Colour: separate products (as now) or a colour option on one product.
- Real photos and films (Shopify hosts both).
- Whether a product can be in more than one collection (Shopify allows it; store a "primary ring" for the radar).

### D. Technical
- Pin a Storefront API version.
- Python 3 (build scripts, standard library only) and Node 18+ (already installed).
- Customer accounts at launch, or guest checkout only.
- Analytics and cookie consent (India's DPDP Act applies).

## Data mapping

| Today (`site/data/products.json`) | In Shopify |
|---|---|
| Collection, curated order | Collection, manually sorted |
| `name`, `description` | Product title and description |
| `price`, `original` (reduced when original > price) | Variant price and compare-at price |
| Sizes XS–XL | Variants with a "Size" option (own stock, SKU, can sell out) |
| `dark` (chalk / washed black) | Product option or metafield (decision C) |
| `bearing`, primary ring | Metafields `radar.bearing`, `radar.ring` (permanent, as now) |
| Artwork `title`, `discipline`, `category`, `year` | Metafields `radar.*` (or an "Artwork" metaobject if reused) |
| Artwork image on the illustrated tee | Metafield `radar.artwork` (file reference) |
| `media` (photos, videos, alt, order) | Product media (Shopify-hosted, alt text and order kept); label and loop/film mode in a metafield |
| Film captions (`.vtt`) | Verify captions support on Shopify-hosted video early; fallback: `.vtt` in Shopify Files via a metafield |
| `product.html?id=21` | `product.html?handle=numbered-tee`; old `?id=` links redirect |
| Concept bag (localStorage) | Shopify Cart API, ending at real checkout |

## Phases

### Phase 0: Foundations
Git, `.env.example`, a small config module (store domain, API version, public token), host with a build step running the existing scripts, separate dev/prod settings.
*Done when* a push deploys the current site unchanged and keys are set on the host and locally.

#### Phase 0: setup (2026-10-05)

Done in the repo:
- `.gitignore` ignores `.env`, `.env.*` (except `.env.example`), `.dev.vars`, `.wrangler/` and the generated `site/scripts/config.js`.
- `.env.example` lists every key, which ones are secret, and where each comes from.
- `tools/build_config.py` writes `site/scripts/config.js` (`radarConfig.shopify`) from the environment, or from `.env` locally. It writes only the domain, API version and **public** Storefront token, never the private token or client secret. With nothing set it writes `shopify: null` and the site runs on its own data as before. Partial or malformed settings fail the build. No page loads `config.js` yet; the bag starts using it in Phase 3. `load_env()` is shared with the later import and sync scripts.

Cloudflare Pages project (the owner sets this up in the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git):

| Setting | Value |
|---|---|
| Repository | `hetissh/radar-stdio` |
| Production branch | `main` (every other branch, e.g. `develop`, gets a preview URL) |
| Framework preset | None |
| Build command | `python3 tools/build_data.py && python3 tools/build_config.py` |
| Build output directory | `site` |
| Root directory | *(blank: the repo root, so a `functions/` folder there becomes Pages Functions in Phase 2)* |
| Variables | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION`, `SHOPIFY_STOREFRONT_PUBLIC_TOKEN` as plain text; `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` as **Secret**. Set them for Production and Preview. All are optional until Phase 1. |

The build re-runs the data checks (a bad `products.json` fails the deploy) and doesn't touch images: `build_images.py` needs macOS `sips`, so thumbnails stay committed. Stress and perf modes stay off on `*.pages.dev` (not a dev host).

To check after the first deploy:
- **Pretty URLs:** Pages serves `product.html` at `/product` and redirects `.html` links there. Check that `?id=` survives the redirect and the garment morph still runs. If the extra redirect matters, links can drop `.html` on Pages only.
- **404s:** without a `404.html`, Pages treats the site as a single-page app and answers any unknown path with the homepage (200). Add a styled `site/404.html` (Phase 7, SEO).
- **Caching:** Pages revalidates every file by default (ETag), which is safe with the `?v=` versions. Longer cache rules for thumbnails can go in `site/_headers` later.

Phase 0 is done when `main` deploys to `*.pages.dev` unchanged and the store's variables are set there and in `.env`.

Keys from Shopify (the owner creates them; they go straight into `.env` and Cloudflare, never into chat):
1. **Storefront API:** in the dev store admin, install the **Headless** sales channel, create a storefront, and copy its public and private access tokens.
2. **Admin API:** Shopify now creates apps in the **Dev Dashboard**. Legacy custom apps made in the store admin are being retired, so check which your store offers. Create an app, give it the Admin API scopes `write_products`, `write_inventory`, `write_files`, `write_publications` and `read_locations` (Phase 2 adds the webhooks), release a version and install it on the dev store. Copy the **client ID** and **client secret**. Scripts exchange these for a short-lived Admin token (client credentials grant), so no long-lived admin token is stored.
3. `SHOPIFY_API_VERSION`: the newest stable version shown in the app's API version setting.

### Phase 1: Catalogue model and one-time import
Metafield definitions, 4 collections, size option. `tools/shopify_import.py` reads `site/data/products.json` and creates the 34 products (variants, prices, compare-at, metafields, media with alt, collection order). Re-runnable (updates, no duplicates). Stand-in demo media skipped or flagged.
*Done when* the dev store matches today's catalogue and a check script confirms every field round-trips.

#### Phase 1: how the import works (2026-10-05)

`python3 tools/shopify_import.py` (Admin API via `tools/shopify_api.py`):
1. **Definitions:** creates any missing `radar.*` metafield definitions with Storefront read access. Products get `id` (type `id`, unique: the import's match key), `ring`, `bearing`, `artwork_title`, `category`, `discipline`, `year`, `image` (site asset file, so thumbnails keep working until Phase 4), `dark`, `status` and `media` (JSON, the current media list, until Phase 4). Collections get `copy` (the blurb, with real line breaks) and `order`.
2. **Collections:** the 4 collections by handle (= site id), manually sorted, published to the Headless channel.
3. **Products:** one `productSet` per piece, matched on `radar.id`:
   - title, a slug handle (renames keep a redirect), escaped description, vendor RADAR STUDIO, type T-shirt, category tag
   - a Size option with XS–XL variants: price, compare-at only when reduced, SKU `RADAR-<id>-<size>`, stock tracked and no overselling
   - the artwork PNG uploaded once, with alt "Artwork: <title>"
   - published to the Headless channel only
4. **Order:** each collection is reordered to match `position`.
5. **Check:** reads everything back and compares with `products.json` (every field, sizes, SKUs, collection, publishing, artwork, order, currency). `--check` runs only this.

Test stock: 10 per size, set only when a product is created (or with `--reset-stock`), so a re-run never overwrites real stock. Sold out for Phase 3 testing: 06 XS, 13 XL, 21 S, 27 M and L, 32 XL. The store must be in INR (the import refuses otherwise). Stand-in demo media isn't uploaded; it stays in `radar.media`.

Gotcha: `productSet` with a `customId` identifier only recognises that metafield in `metafields` when it is sent **without** `type` ("must contain the customId value" otherwise). The import sends every `radar.*` metafield without a type; the definitions supply it.

### Phase 2: Shopify as the data source
`tools/sync_shopify.py` pages through products and collections and writes the same `site/data/*.json` the pages already use. `tools/build_data.py` checks run on the synced data, so a bad edit fails the build instead of breaking the site. A server function receives Shopify webhooks (product/collection/inventory), verifies the HMAC signature and triggers a debounced rebuild. Images come from Shopify's CDN with on-the-fly resizing, so `tools/build_images.py` is no longer needed for Shopify images.
*Done when* an edit in Shopify appears on the site within minutes, with no manual step.

### Phase 3: Live prices, stock and the real bag
Product page fetches live price, compare-at and per-size stock; sold-out size rings are struck through; "Add to bag" adds the real variant; the snapshot is only a fallback. The bag becomes a Shopify cart (cart id in localStorage, add/change/remove via the Cart API, real line prices, discounts, subtotal; expired carts and stock races handled). "Checkout ↗" goes to Shopify checkout; discount codes via the cart. Shopify's thank-you and order-status pages take over after payment.
*Done when* a test order completes on the test gateway, stock decreases and the confirmation email arrives.

### Phase 4: Media from Shopify
The media strip reads Shopify media (resized images; video formats with poster, alt and order; labels and mode from the metafield). Radar, lens, loops, films and pause behaviour unchanged.
*Done when* the two demo pieces' media are rebuilt from Shopify and pass the same checks.

### Phase 5: Search and filters
Keep the current client-side search and filters over synced data (fast to a few thousand pieces, confirmed by the stress test). Move to the Storefront search API plus Search & Discovery filters when the catalogue outgrows that or typo-tolerant search is wanted.
*Done when* filters match Shopify data and sold-out pieces can be shown or hidden.

### Phase 6: Customer accounts (optional for launch)
Shopify Customer Account API sign-in; Account and Orders in the header; an orders view in the site's style. Otherwise launch with guest checkout.

### Phase 7: Production hardening
- Shopify unreachable: catalogue from the snapshot; add-to-bag explains the problem.
- Security: only the public token in the browser; webhooks signature-checked; no admin key in the repo; rotate keys before launch.
- SEO: product structured data (price, availability, images), titles, descriptions, social previews, sitemap from the sync, canonical links.
- Analytics and consent: cookie notice honouring choices; Shopify headless analytics, optional GA4.
- Performance budgets at today's weights (homepage < ~1 MB, catalogue < ~0.6 MB first load); re-run the 1,000-piece stress test on synced data.
- Monitoring: alerts on sync failures and cart/checkout error spikes.

### Phase 8: Launch
Production store, live payment gateway, GST and shipping, published policies, DNS, real test orders then refunds, go-live checklist, written rollback (git revert and redeploy).
*Done when* a real order is paid, fulfilled and refunded successfully.

## Code changes (preview)

| File | Change |
|---|---|
| `site/scripts/shared.js` | `bag` becomes a thin layer over the Shopify cart; `shopifyFetch()` helper with the public token; links by handle |
| `site/scripts/product.js` | Live price/stock, sold-out sizes, add-to-bag by variant id, media from Shopify |
| `tools/build_data.py` | Accepts synced Shopify data; keeps all checks |
| New | `tools/shopify_import.py`, `tools/sync_shopify.py`, `functions/shopify-webhook`, `.env.example`, `site/scripts/config.js` |
| Unchanged | Radar, rails, catalogue views and Field, stress mode, light/dark, garment transition |

## Decisions needed

1. Existing Shopify store (which plan), or start with a Partner development store? (Recommended: dev store.)
2. Hosting: Vercel, Netlify or Cloudflare.
3. Payment gateway for India, and whether to sell internationally.
4. Colour: separate products or a colour option?
5. Customer accounts at launch, or guest checkout only?
6. Keep the illustrated tee as item 01 once real photos exist?

First concrete step once the dev store exists and its keys are in `.env`: Phase 0 and Phase 1, importing the current 34 pieces.
