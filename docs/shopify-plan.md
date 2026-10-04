# Plan: Shopify backend, end to end

Status: **parked** (drafted 2026-10-04; not started). Pick up from "Decisions needed" at the end.

## The approach

Keep the custom front end (radar, catalogue, product page) and use **Shopify for everything commerce**: products, prices, stock, cart, checkout, payments, orders, tax, shipping and customer emails. This is a "headless" setup. Pages keep loading the same kind of fast `data/*.json` files, but those files are generated from Shopify instead of `data/products.json`. Anything that changes minute to minute (stock, price) and the bag itself talk to Shopify live. Checkout is Shopify's hosted checkout, which handles payment security and compliance.

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
| 6 | Git repository | **The project is not under version control yet.** Needed before connecting real infrastructure; restores proper rollback |
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

| Today (`data/products.json`) | In Shopify |
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

### Phase 1: Catalogue model and one-time import
Metafield definitions, 4 collections, size option. `tools/shopify_import.py` reads `data/products.json` and creates the 34 products (variants, prices, compare-at, metafields, media with alt, collection order). Re-runnable (updates, no duplicates). Stand-in demo media skipped or flagged.
*Done when* the dev store matches today's catalogue and a check script confirms every field round-trips.

### Phase 2: Shopify as the data source
`tools/sync_shopify.py` pages through products and collections and writes the same `data/*.json` the pages already use. `build_data.py` checks run on the synced data, so a bad edit fails the build instead of breaking the site. A server function receives Shopify webhooks (product/collection/inventory), verifies the HMAC signature and triggers a debounced rebuild. Images come from Shopify's CDN with on-the-fly resizing, so `build_images.py` is no longer needed for Shopify images.
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
| `shared.js` | `bag` becomes a thin layer over the Shopify cart; `shopifyFetch()` helper with the public token; links by handle |
| `product.js` | Live price/stock, sold-out sizes, add-to-bag by variant id, media from Shopify |
| `build_data.py` | Accepts synced Shopify data; keeps all checks |
| New | `tools/shopify_import.py`, `tools/sync_shopify.py`, `functions/shopify-webhook`, `.env.example`, `config.js` |
| Unchanged | Radar, rails, catalogue views and Field, stress mode, light/dark, garment transition |

## Decisions needed

1. Existing Shopify store (which plan), or start with a Partner development store? (Recommended: dev store.)
2. Hosting: Vercel, Netlify or Cloudflare.
3. Payment gateway for India, and whether to sell internationally.
4. Colour: separate products or a colour option?
5. Customer accounts at launch, or guest checkout only?
6. Keep the illustrated tee as item 01 once real photos exist?

First concrete step once the dev store exists and its keys are in `.env`: Phase 0 and Phase 1, importing the current 34 pieces.
