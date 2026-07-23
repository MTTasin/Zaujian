# Zaujain Nikah Point — Full E-commerce + UI Remake — Design Spec

**Date:** 2026-07-14
**Status:** Approved (design decisions delegated to and locked by implementer)
**Approach:** C — Design-system-first, phased, reuse existing backend logic.

---

## 1. Goal

Turn the current customization-centric site into a **complete, professional e-commerce
website** whose UI reads unmistakably as a real, premium store — with the existing
customization/configurator flow preserved as a small, signature, unique section inside it.

Two parallel workstreams:
1. **Total UI remake** — new premium-editorial design system, every page rebuilt on it.
2. **Feature completion** — search, filters, sort, category tree, collections, reviews,
   optional accounts, wishlist, coupons, stock — a full shop.

## 2. Non-negotiable constraints (inherited from CLAUDE.md, still hold)

- **Money = `DecimalField`, never float.** Snapshot prices into cart/order at add-time.
- **No job queue / no background workers.** Fraud check, DeepSeek, Steadfast all run
  synchronously with per-call timeouts + safe fallbacks. Real-time = polling, not websockets.
- **cPanel + Passenger**, SQLite dev / Postgres prod via `DATABASE_URL`. `next/image`
  `unoptimized: true`; upload pre-sized images; lazy-load; compress.
- **Storefront Bengali only**, image-first, huge tap targets, mobile-first, 2G-friendly.
  **Admin English/technical.**
- Anonymous identity = `X-Cart-Token` header (localStorage), not cookies.
- Live price always visible while configuring.

## 3. Audience posture

**Simple by default, full power tucked away.** Clean, low-text, image-first default surface
usable by low-literacy village users on 2G. Advanced controls (filters, sort, account,
reviews) present but progressively disclosed (drawers, tucked menus) so they never overwhelm.
Accounts **optional**; guest checkout is the default path (phone + BD address, as today).

---

## 4. Backend — data model changes

Single Django app `app`. Additive migrations; backfill existing data. All money `Decimal`.

### 4.1 Product (extend)
Add fields:
- `description` (TextField, Bengali), `short_description` (Char).
- `compare_at_price` (Decimal, nullable) — strike-through original for discounts.
- `stock` (PositiveInteger), `low_stock_threshold` (PositiveInteger, default e.g. 3),
  `track_stock` (Bool, default True).
- `is_featured` (Bool), `sold_count` / `popularity` (PositiveInteger, for sort-by-popular).
- `tags` (simple M2M `Tag` or comma char) — optional filter facet.
- Cached aggregates: `rating_avg` (Decimal), `rating_count` (Integer) — recomputed on
  review approve/delete.

### 4.2 ProductImage (new)
General product photo gallery for listing/detail — **distinct** from customization overlays
(`ColorOption`/`ToppingDesign`/`StaticDesign`, which stay for the configurator).
- `product` FK, `image`, `alt` (blank), `order`, `is_primary`.
- `simple` and `gallery` products display these as the normal shop gallery.

### 4.3 Category (new) — replaces free-text `Product.category`
- `name` (Bengali), `slug`, `parent` (self-FK, nullable → tree), `image`/`icon`,
  `order`, `active`.
- Migration: create Category rows from distinct existing `Product.category` strings,
  repoint products to FK `category`. Keep old char field one release as `category_legacy`
  for safety, then drop.

### 4.4 Collection (new) — curated merchandising lists
- `name`, `slug`, `description`, `image`, `featured` (show on home), `order`, `active`.
- M2M to `Product` and/or `PrebuiltCombo`. Examples: "কম্বো", "৫০০৳ এর নিচে", "নতুন".

### 4.5 Customer (new) — optional accounts
- Identity = **phone** (unique). Fields: `phone`, `name`, `email`, password (Django hasher).
- Auth: **token-based**, reusing the existing admin token pattern (token in localStorage,
  sent as a header) — consistent with the anonymous `X-Cart-Token` model and cPanel-friendly.
  Login = phone + password. (OTP out of scope for v1; can add later.)
- **Guest checkout unchanged.** On login/registration, link existing Orders matching the
  phone to the account and merge the anonymous `X-Cart-Token` cart into the account.
- `Address` (new, optional) — saved addresses per customer (division/district/thana/street),
  reusing `bdLocations` cascade.
- Order gets nullable `customer` FK (guest orders leave it null; phone still the anchor).

### 4.6 Wishlist (new)
- Belongs to `Customer` OR anonymous `session_key` (same dual pattern as CartItem).
- On login, merge anonymous wishlist into account.
- Rows: `(owner, product)`.

### 4.7 Review (new)
- `product` FK, `customer` FK (nullable) / `order` FK (for verified purchase), `rating` 1–5,
  `title` (blank), `body`, `verified_purchase` (Bool), `approved` (Bool, moderation),
  `created_at`. Optional `ReviewImage` (image, order).
- Only `approved` reviews shown publicly. On approve/delete → recompute Product `rating_avg`
  / `rating_count`.
- Write-review entry point = order history (a delivered order), or open on product page for
  logged-in customers.

### 4.8 Coupon (new)
- `code` (unique, upper), `kind` (`percent`|`fixed`), `value` (Decimal), `min_order` (Decimal),
  `starts_at`/`expires_at`, `usage_limit`, `used_count`, `active`.
- Validated + applied at cart; **snapshot** discount into Order.
- Order gains `discount_amount` (Decimal) and `coupon_code` (Char). `total` recomputed:
  `subtotal - discount + delivery`. COD math updated accordingly.

### 4.9 Stock behavior
- If `track_stock` and `stock <= 0` → block add-to-cart, show "স্টক নেই" (out of stock).
- `stock <= low_stock_threshold` → "শেষ হয়ে যাচ্ছে" (low stock) badge.
- Decrement stock on order **confirm** (not on add-to-cart, to avoid phantom holds without a
  job queue to release them). Guard against oversell at confirm time; if insufficient, flag
  order for admin.

### 4.10 API (DRF, extends existing)
- `GET /api/products/` — search (`q`), filter (`category`, `collection`, `price_min/max`,
  `kind`, `in_stock`, `tags`), sort (`price`, `-price`, `newest`, `popular`, `rating`),
  pagination. Server-side, indexed. Return card payload (image, price, compare_at, rating,
  badges).
- `GET /api/products/<slug>/` — detail incl. images, reviews summary, related.
- `GET /api/categories/`, `GET /api/collections/`.
- `GET/POST /api/reviews/` (list per product; create for logged-in verified purchaser).
- `POST /api/coupons/validate/` — returns discount or error.
- `GET/POST/DELETE /api/wishlist/` — dual token/customer identity.
- `POST /api/account/register|login|logout/`, `GET /api/account/orders|addresses/`.
- All new endpoints honor `X-Cart-Token` for anonymous, account token when logged in.

---

## 5. Frontend — design system (premium editorial)

New Tailwind v4 theme + component library. Replace the raw pink→purple identity with a
refined, elevated palette that still nods to it.

### 5.1 Color
- **Plum** (deep primary) — headings, primary text accents.
- **Rose** (brand mid) — CTAs, highlights.
- **Gold** (accent) — premium details, badges, dividers, ratings.
- **Cream** (background), **Charcoal** (text), **Muted** (secondary text), success/warn/error.
- Brand gradient (rose→plum) **demoted to accent only** — hero, primary CTA, key moments —
  not slathered across every surface. Light theme (per CLAUDE.md).

### 5.2 Type
- Bengali storefront: **Noto Serif Bengali** (elegant headings) + **Hind Siliguri**
  (body/UI, high legibility at low literacy). Self-hosted / preloaded, subset, low weight
  count for 2G. Latin fallback for numerals/admin.
- Type scale generous, large touch/read sizes; strong hierarchy.

### 5.3 Spacing / layout
- 4px base scale, generous whitespace (editorial). 12-col responsive grid, mobile-first.
- Min tap target 48px. Sticky mobile bottom action bars (add-to-cart, live price, wizard next).

### 5.4 Component library (shared, in `frontend/src/components/ui`)
Buttons (primary gradient / secondary outline / ghost), ProductCard, CategoryTile,
CollectionCard, PriceTag (with compare-at strike + discount %), RatingStars, Badge
(combo / new / discount / low-stock / out-of-stock), SearchBar, FilterDrawer, SortMenu,
QuantityStepper, WishlistHeart, Breadcrumbs, EmptyState, Toast, Skeleton (lazy image
placeholder), Modal/Drawer, Stepper (customization wizard), StickyActionBar, Pagination.

### 5.5 Performance / low-bandwidth
- `next/image unoptimized` + lazy-load + skeletons. Route-level code splitting. Small JS
  budget. Album links (not 50 inline images). Respect `prefers-reduced-motion`; motion subtle.

---

## 6. Frontend — information architecture & pages

New premium shell: header (logo, search, category menu, cart, wishlist, account),
footer, floating chatbot (hidden on /admin). All re-skinned on the design system.

- **Home `/`** — hero (gradient accent), search, category tiles, featured collections,
  featured combos, best sellers / new arrivals, trust strip (delivery, cash-on-delivery,
  reviews), customization teaser ("নিজে ডিজাইন করুন"), chatbot.
- **Shop `/shop`** — full listing: search + filter drawer + sort + pagination. Product grid
  of ProductCards. Empty/no-result states.
- **Category `/c/[slug]`** — category (+ subcategories) listing, same controls.
- **Collection `/collection/[slug]`** — curated list.
- **Product `/product/[slug]`** — image gallery, title, PriceTag, rating + review summary,
  stock badge, quantity, **Add to cart** and/or **Customize** CTA (for configurable kinds),
  description, reviews section, related products, wishlist heart.
- **Combo `/combo/[slug]`** — re-skinned; buy as-is OR "পরিবর্তন করুন" → wizard preloaded.
- **Customize `/customize` + `/customize/build`** — the **signature section**, re-skinned on
  the new system (live price, per-product wizard, book 2-screen flow). Logic preserved.
- **Cart `/cart`** — line items with readable config, quantity, coupon field, live totals.
- **Checkout `/checkout`** — BD Division→District→Thana cascade, WhatsApp/email, coupon,
  guest **or** login/register inline, "we'll call to confirm" post-order.
- **Account** — `/account` (login/register), `/account/orders` (history + write-review on
  delivered), `/account/addresses`, `/account/wishlist`.
- **Wishlist `/wishlist`** — works for guests (token) too.
- **Track `/track` + `/track/[uid]`**, **Album `/album/[key]`**, **Custom request
  `/custom-request`** — re-skinned, logic preserved.

Admin panel (English) gains managers for the new models — see phasing.

---

## 7. Customization integration (the "unique small part")

The configurator is the differentiator, not the whole store. It lives as:
- A prominent but bounded **home teaser** + a top-nav entry ("কাস্টমাইজ করুন").
- The **Customize hub → build wizard** section, re-skinned premium but functionally intact
  (layered book/box 2-screen cover+inside, gallery pick, dupatta lookup, live price).
- Reachable from configurable product pages via a **Customize** CTA alongside Add-to-cart.
- Combos' "make changes" still opens the wizard preloaded.
All existing pricing (`app/services/pricing.py`), `ConfigurationImage` matching, and combo
preselect logic are reused unchanged.

---

## 8. Phasing / milestones (each shippable + testable)

- **Phase 0 — Foundation.** Design tokens + Tailwind theme + fonts, shared component library,
  new header/footer/shell, chatbot widget re-skin. No feature change yet.
- **Phase 1 — Browse.** Backend: Category, Collection, ProductImage, Product description/
  stock/compare_at, search/filter/sort API. Frontend: Home, Shop listing, Category,
  Collection, Product detail rebuilt on the system.
- **Phase 2 — Buy.** Cart + checkout re-skin; Coupon model + validate/apply; stock enforcement
  (badges, block, decrement on confirm); `discount_amount` in Order + COD math.
- **Phase 3 — Accounts & trust.** Customer + Address + optional login/register; order history;
  wishlist (guest + account merge); Review + moderation + rating aggregation; write-review flow.
- **Phase 4 — Signature + combos.** Customization hub/wizard + combo pages re-skinned and woven
  in as the unique section. Track / album / custom-request re-skins.
- **Phase 5 — Admin + QA.** Admin managers for Categories, Collections, Product images/
  description/stock, Reviews moderation, Coupons. Full mobile/2G QA, Lighthouse, bundle budget,
  regression pass on existing flows (fraud, Steadfast, chatbot).

## 9. Error handling

- Preserve all sync fallbacks: fraud check (per-courier timeout → require advance),
  DeepSeek (streamed, read timeout, fallback reply), Steadfast (fail → don't confirm, show
  error).
- New states: search no-results, out-of-stock / low-stock, invalid/expired coupon, oversell
  at confirm (flag for admin), login failure, review pending moderation.
- Cart/wishlist optimistic UI with server reconcile (dedupe by id, as chat widget already does).

## 10. Testing

- **Backend:** Django tests for pricing unchanged; new tests for coupon math, stock decrement/
  oversell guard, search/filter/sort queries, account+cart/wishlist merge, review aggregation,
  Decimal money invariants, price snapshot immutability.
- **Frontend:** component tests for the UI library; e2e happy paths — browse→product→cart→
  checkout (guest), customize→cart, login→wishlist→review, coupon apply, out-of-stock block.
- **Perf:** Lighthouse mobile + JS bundle budget on 2G profile; verify lazy-load + album links.

## 11. Out of scope (v1)

Online payment gateway (manual bKash/Nagad stays), OTP login, multi-vendor, non-Bengali
storefront i18n, native app, websockets/real-time beyond polling, background workers.

## 12. Success criteria

- A first-time visitor immediately reads the site as a real, premium store.
- Full browse→buy works for a guest with no login, on a low-end Android over 2G.
- Search, filters, sort, categories, collections, reviews, wishlist, coupons, stock all
  function.
- The customization flow is intact, faster-looking, and clearly the signature feature.
- No regression in fraud check, Steadfast booking, chatbot/handoff, pricing, or price
  snapshotting. Money stays Decimal end-to-end.
