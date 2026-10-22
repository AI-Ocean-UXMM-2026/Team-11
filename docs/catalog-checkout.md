# SME catalog and checkout

SMEs browse separate white and black STT sneaker cards, select an EU size and add pairs to a cart. Each size/color combination remains a separate SKU. The bottom **View cart** button includes the selected pair count and subtotal. Cart rows show a product photograph, model, color, size, unit price, quantity and line total, with edit and remove controls.

The flow is **Select items → View cart → Order**. Ordering contains **Shop information → Review order → Upload transaction evidence → Done**. Shop information includes delivery shop name, receiver, normalized international phone, address, optional map pin and delivery notes. The shop name is saved in the order's delivery notes; the ordering account's identity remains the HQ-issued SME account.

The final review shows the complete cart, shop details, shipping and full quoted total. Confirming it creates a saved quote through the existing authenticated workflow action. This retains the retry key on interrupted requests. Evidence is then uploaded through the existing private proof endpoint, with image validation, a transfer reference and the transferred amount. The completion page says **Awaiting verification**. Payment approval, stock reservation and delivery completion still require their existing separate checks.

Client cart checks enforce whole quantities in SKU minimum multiples and available stock. PostgreSQL independently rechecks price, stock, minimums, account ownership and the quoted total. Prices in the saved order are used during evidence submission, even if the catalog changes afterward.

The requested [Shop product-to-cart reference](https://mobbin.com/flows/e51baba3-2746-4652-9f5e-4d9bdd26977a) informed the image/variant/add-to-cart interaction. SupplyLink retains its existing Manrope typography, forest green actions and white canvas. Images are generated demo product photographs, not verified photographs of the real STT product. The built-in image-generation tool produced `public/products/stt-white.png` and `public/products/stt-black.png`; Next Image serves optimized sizes. Prompt set: a white STT low-top sneaker on a neutral studio backdrop, followed by a matching matte-black colorway preserving the angle, silhouette, lighting and off-white sole.

## HQ overview

A dedicated hold panel appears above the overview hero. It shows the full held-order count, available hold reasons and buttons to open each order. **Review held orders** selects the On hold filter in the recent-orders table. The existing action list and fulfilment controls remain available.

## Run the local demonstration

Run `npm run demo` from the project root. It builds into `.next-demo` and serves on `http://127.0.0.1:3100`. It explicitly enables demo mode, uses `.data/catalog-demo` for its database/evidence, and leaves `.env.local` and port 3000 alone. Set `SUPPLYLINK_DEMO_PORT` to choose another preview port.

Sample credentials, accepted only in explicit demo mode:

| Portal        | Account ID      |
| ------------- | --------------- |
| SME           | `myathida`      |
| HQ            | `hq.admin`      |
| Driver        | `zawmin`        |
| Hlaing branch | `branch.hlaing` |

Demo password: `SttDemo-2026!`.

A fresh local database receives six stocked variants, three branches with pins, ten wholesale orders including two holds and two pending payment reviews, three retail sales, and reserved/shipping/received stock transfers. Two wholesale orders have completed the actual demo workflow, creating sales once. Proof files clearly say **SAMPLE — NO MONEY TRANSFERRED**. No live GPS fixes are invented. The checkout evidence step provides a demo-only sample receipt download.

Seeding runs once on a newly initialized local database, after sample profiles exist. Existing local histories and hosted Supabase records are preserved. The hosted application uses the same new checkout interface with its actual catalog and records; these changes add no database migration.

## Verification

Targeted tests cover variant/quantity validation, photo cart review, removal, normalized shop contact details, retry-key reuse after interruption, evidence-gated completion and once-only demo seeding. Use `npm test -- --maxWorkers=1`; avoid running PGlite tests at the same time as a production build on this machine.

Verification on 21 October 2026: 101 tests and TypeScript passed; the separate demo production build passed. A browser walkthrough added both colors, edited cart quantity, reviewed a 275,000 MMK quote with normalized shop phone, uploaded the labelled sample receipt and reached Awaiting verification. Catalog, cart and shop information had no horizontal document overflow at 375×812; main add/cart controls measured at least 44px tall. HQ showed both holds above the hero, and its hold filter returned those two records. The HTTP smoke check also passed quote/proof/reservation, dispatch replay, pickup, synthetic GPS/SSE, handover, receipt, completion and one sale, with proof/monetary access restrictions intact.

Screenshots: [desktop cart](screenshots/sme-cart.png), [mobile cart](screenshots/sme-cart-mobile.png), [submitted order](screenshots/sme-checkout-submitted.png), [HQ holds](screenshots/hq-hold-priority.png). These contain only local demo records. Hosted Supabase was not changed for this catalog update.

## Compact desktop layout

Catalog cards use smaller photos and put size, quantity and Add to cart in one
row on desktop. Short laptop viewports reduce vertical spacing further. Browser
verification at 1366×768 and 1280×640 showed both product cards, their stock and
feedback text, and the View cart action without overlap. Mobile remains stacked
with 44px or larger primary controls and no horizontal overflow at 375×812.
Evidence: `screenshots/sme-catalog-compact-desktop.png`.

## Receiving accounts at checkout

The evidence step shows **Where to transfer** directly below the saved order
reference. Each receiving account displays its payment method (such as KPay or
WavePay), holder name, account number/phone and Copy number action, alongside
the frozen full quote total and payment notes. Paid order details label the amount
as Order total instead of asking for another transfer.

HQ configures up to five receiving accounts in **Settings → Delivery & payment
setup** using explicit method, holder and number fields. Additional instructions
are optional. A notes-only settings save is rejected. Numbers are stored as text
so leading zeros and formatting survive. Actual receiving details must be entered
by HQ; account/contact phone numbers are never inferred as payment destinations.

The existing checked configuration operation stores a versioned payment setup in
the existing instructions column, within its 2,000-character limit. No database
migration or live receiving-account change is required for this UI update. New
orders snapshot these receiving details through the existing quote transaction.
When HQ changes its accounts, orders that already saved structured accounts keep
their originals. A legacy order with no saved account entries can use the current
HQ accounts, with a visible note that the accounts were added after the order was
saved. Its quoted prices and shipping remain unchanged. If no accounts exist,
the screen explicitly asks the SME to contact HQ before paying.

The same receiving-account display is available when resuming an order from
My orders. Receiving-account instructions are shown only to the ordering SME;
HQ retains payment evidence and verification controls without the transfer panel.
Existing monetary/privacy restrictions continue to hide payment
details from branch staff and drivers. Fresh demo data uses clearly non-payment
identifiers `DEMO-KPAY-001` and `DEMO-WAVE-002`; no real wallet numbers are seeded.

Verification: 137 tests across 30 files passed, including settings validation,
leading-zero preservation, immutable saved destinations, legacy fallback,
account display/copy behavior and the checkout evidence step. TypeScript passed.
The production demo build passed. Browser verification confirmed HQ account
settings persist into a new SME quote and Copy number reports Copied. At 375×812,
both recipient cards and receipt fields stay within the form, with 44px copy
buttons. Evidence: `screenshots/sme-payment-destinations.png` and
`screenshots/sme-payment-destinations-mobile.png`.
