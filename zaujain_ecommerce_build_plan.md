# Zaujain Nikah Point Ecommerce Configurator Build Plan

## 1. Project Overview

This is a custom ecommerce platform for Zaujain Nikah Point, a Bangladesh based business selling premium customized Nikah Nama products. The core idea is a visual configurator where a customer builds their own combo by choosing colors and designs, similar to a character customization screen in a game. Customers are non technical, so the flow must be simple, visual, mobile first, and entirely in Bengali. The admin panel is in English.

Customers do not have to buy the full combo. Each item, book, box, pen, mirror, dupatta, can be selected individually or together. Pricing updates live as options are chosen.

## 2. Tech Stack

- Frontend, Next.js
- Backend, Django with Django REST Framework
- Database, PostgreSQL
- Media storage, Django local media folder, served directly from the VPS
- Admin panel, Django admin extended with custom views for order verification and fraud check results
- Hosting, shared cPanel hosting, Python app deployed through cPanel's Passenger setup, no Docker available
- Caching and light queuing, Redis available on this hosting, capped at 128 MB, so it should be used only for caching and session data, not for heavy background job queues

## 3. Core Concept, The Layered Configurator

Two products, the book and the box, use a layered image system.

- The customer first picks a base color. Each color has its own full image of the plain item with no design on it.
- The customer then picks a corner design and a center design. These are transparent PNG overlays that sit on top of the base color image, positioned in fixed spots.
- The preview updates live as the customer swaps designs, exactly like trying on outfits in a game.
- The customer can go back and change any earlier choice at any time before adding to cart.
- For the book only, there is an additional step, the inside page design. This is not layered on the cover. It is shown and chosen as its own standalone image gallery.

Pen and mirror are simple products. The customer picks one design from a gallery of finished images. No layering.

Dupatta uses a different logic, described in section 5.

## 4. Data Model Plan

Rough Django model structure to guide Claude Code.

**Product**
- name, slug, category, book, box, pen, mirror, dupatta
- base price
- allows individual purchase, boolean
- active, boolean

**ColorOption**
- product, foreign key
- name, for example maroon, ivory, black
- base image, the plain item in this color
- price modifier
- active

**ToppingDesign**
- product, foreign key
- placement, corner or center
- image, transparent PNG
- position data, x, y, scale, so it lines up correctly over each base image
- price modifier
- active

**InsideDesign**
- book only
- preview image
- price modifier
- active

**StaticDesign**
- used for pen and mirror
- product, foreign key
- image
- price modifier
- active

**DupattaOption**
- lace type, single lace or four lace
- text lines, number
- preview image matching that combination
- price for that exact combination

**CartItem**
- session or user reference
- product
- selected color, selected corner, selected center, selected inside design, or selected static design, or selected dupatta option, whichever apply
- calculated price
- is custom request, boolean

**CustomOrderRequest**
- linked cart item, optional
- description text from customer
- reference images uploaded by customer
- status, pending review, priced, rejected
- admin set final price

**Order**
- customer name, phone, address
- list of cart items
- subtotal
- advance required, boolean
- advance amount
- payment method, manual bKash or manual Nagad
- transaction id submitted by customer
- payment screenshot upload
- payment verified, boolean, set by admin
- fraud check result, stored from Steadfast and Pathao lookup
- order status, pending payment, confirmed, in production, shipped, delivered, cancelled

## 5. Dupatta Flow

Dupatta does not use the layered system. It is a simple two step choice.

- Step one, lace type, single lace or four lace. Show a preview image for each.
- Step two, number of text lines. Show a preview image matching the selected lace type and line count.
- Price is looked up directly from the DupattaOption table based on the exact combination chosen, not calculated from separate modifiers, since your pricing there is not strictly additive.

## 6. Pricing Engine

- Each product starts at a base price.
- Each selected option, color, corner, center, inside design, static design, adds its own price modifier.
- Dupatta price comes directly from the matched DupattaOption row instead of adding modifiers.
- The cart shows a running subtotal per item and a full order total, updating instantly as choices change, no page reload.
- Custom requests are marked with a placeholder price until admin sets a final price.

## 7. Cart and Partial Purchases

- Every product configurator ends with an add to cart action for that single item.
- The customer can keep adding more items or check out with just one.
- Cart page lists each item with its chosen options and price, with an edit link that reopens that item's configurator with previous choices preselected.

## 8. Custom Design Requests

Based on your answer, this is combined. Both paths exist at once.

- Inside the normal configurator, there is an option at the final step, something like "I have my own design in mind". Selecting this creates a CustomOrderRequest linked to that cart item and flags it for manual pricing instead of using the calculated price.
- Separately, there is also a standalone "Request a custom order" page reachable from the main menu, with a text field for description and an upload field for reference images. This does not require going through the configurator at all.
- Both paths land in the same admin queue, pending review, where you set the final price manually. The order only proceeds once you have priced it.

## 9. Payment and Advance Flow

- No payment gateway integration for now. Manual method only.
- At checkout, if an advance is required, the page shows your bKash and Nagad numbers.
- The customer sends the advance manually, then fills a small form with the transaction id and uploads a screenshot as proof.
- Order status becomes pending payment verification.
- You verify manually in the admin panel and mark it confirmed. This also gives you a natural point to message the customer directly if something looks off.

## 10. Courier Fraud Check Integration

- Before the order is finalized, the backend calls the Steadfast Courier and Pathao Courier fraud check APIs using the customer's phone number.
- If the delivery success ratio for that number is good, no advance is required, order goes straight to confirmed once placed.
- If the ratio is bad or the number has a history of high return rate, the order is marked advance required, and the customer sees the manual payment step described above.
- Since this runs on shared cPanel hosting with no Docker and only a small Redis allowance, call the fraud check APIs synchronously at checkout rather than through a heavy background job queue. The call is quick enough that the customer can wait a second or two while it runs.
- Store the raw fraud check response on the Order record so you have a record of why an advance was or was not requested.
- If both APIs fail or the number has no history, default to requiring a small advance, safer default.

## 11. Admin Panel Requirements, English

- Upload and manage color base images, topping PNGs with position data, inside designs, static designs, dupatta option images, all through simple forms, no code needed for new uploads.
- Manage prices for every option and product.
- View and manage the custom order request queue, set final prices.
- View orders with full breakdown of selected options per item, fraud check result, payment status.
- One click to mark a payment verified after checking the uploaded screenshot and transaction id.
- Basic order status pipeline, pending payment, confirmed, in production, shipped, delivered, cancelled.
- Simple dashboard, orders today, orders pending payment verification, orders pending custom pricing.

## 12. Localization

- Entire customer facing site is Bengali only, no language switcher needed.
- Admin panel stays in English.
- Product names, option names, and any customer facing text should follow your established terminology, combo not set, premium pen not feather pen, মিরর not আয়না.

## 13. UX Principles

- Mobile first, most customers will arrive from Facebook or Messenger on a phone.
- Large tappable option cards instead of dropdowns wherever possible.
- Live preview always visible while configuring the book and box, so the customer never loses sight of what they are building.
- Minimal text, rely on images to communicate options since the audience is non technical.
- Clear running price shown at all times during configuration, not just at checkout.

## 14. Build Phases for Claude Code

Suggested order so Claude Code can build this incrementally and testably.

- Phase 1, Django models, admin registration for all models listed above, database migrations.
- Phase 2, Django REST Framework endpoints for products, options, and pricing lookups.
- Phase 3, Next.js storefront shell, product listing, Bengali UI framework, base styling.
- Phase 4, Generic layered configurator component for book and box, color selection, corner and center overlay swapping, live preview canvas.
- Phase 5, Book inside design step, separate gallery selection.
- Phase 6, Pen and mirror simple gallery selection components.
- Phase 7, Dupatta two step selector with matched preview images and direct pricing lookup.
- Phase 8, Cart system, add, edit, remove, running totals, partial combos.
- Phase 9, Custom order request, both the in configurator flag and the standalone request page, admin pricing queue.
- Phase 10, Checkout flow, customer details, Steadfast and Pathao fraud check call, advance requirement logic.
- Phase 11, Manual payment submission, transaction id and screenshot upload, admin verification action.
- Phase 12, Admin dashboard polish, order status pipeline, final Bengali copy pass, mobile QA.

This document is meant to be handed to Claude Code as the working specification. Each phase can be given as its own task so the build stays reviewable and testable at every step.

## 15. Locked Decisions (updated during build)

These override or clarify earlier sections.

### 15.1 Audience reality check
- Primary users are non technical people across Bangladesh, including from remote villages, often on slow 2G or 3G and low end Android phones.
- Every customer facing screen must be image first, Bengali only, with large tap targets, minimal text, and low data usage. Optimize and lazy load images. No feature that assumes fast internet or tech literacy.

### 15.2 Database
- Development uses SQLite. Production uses PostgreSQL.
- Selected at runtime via a `DATABASE_URL` environment variable using `dj-database-url`, so no code change between environments.

### 15.3 Courier fraud check
- Ported from the PHP package in `laravel-fraud-checker/` to a native Python module at `backend/app/services/fraud_check.py`.
- Only Steadfast and Pathao are checked.
  - Steadfast: login page CSRF scrape, form login, GET `/user/frauds/check/{phone}` returns JSON delivery counts, then logout.
  - Pathao: POST `/api/v1/login` for token, POST `/api/v1/user/success` with phone.
- Each returns success, cancel, total, success_ratio. Aggregated with per courier try/except.
- Called synchronously at checkout with a hard timeout of about 3 seconds per courier. If both fail or no history, default to advance required.
- Raw response stored on the Order.
- Credentials (courier merchant login user/password) come from environment variables.

### 15.4 Steadfast consignment submission (order booking)
- Separate from fraud check. Uses Steadfast official API with `Api-Key` and `Secret-Key` headers at `https://portal.packzy.com/api/v1/create_order`.
- Triggered only manually from the Django admin via a "Confirm order" action. Never automatic.
- On confirm, admin enters the advance amount actually received. Then:
  - `cod_amount = subtotal + delivery_charge - advance_received`
  - POST create_order with recipient name, phone, address, cod_amount, invoice (order id), note.
  - Store returned `consignment_id` and `tracking_code` on the Order, set status to confirmed.
  - If the API call fails, the order is NOT confirmed and the admin sees an error.
- API key and secret come from environment variables.

### 15.5 Notifications
- Customer provides an email address at checkout.
- Order confirmation and status change emails sent to the customer via Django SMTP.

### 15.6 Order model additions (beyond section 4)
- `email`
- `delivery_charge`
- `advance_received`
- `cod_amount`
- `steadfast_consignment_id`, `steadfast_tracking_code`, `steadfast_status`, `courier_submitted`

### 15.7 Money
- All prices and money fields use `DecimalField`, never float.

### 15.8 Cart item storage
- Selected options stored as a JSON config plus a price snapshot taken at add-to-cart time, so later admin price edits do not change already placed orders.
