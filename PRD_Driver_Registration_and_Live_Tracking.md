# Supplier Platform With Driver Registration and Live Tracking

*Detailed Product Requirements Document*

Version 2.2  |  20 October 2026  |  Audience: product, design and engineering

## 1  Product purpose and scope

Connect independent SMEs to one supplier headquarters and its branches. Headquarters primarily handles wholesale. Branches primarily sell retail and hold a protected wholesale reserve for approved delivery exceptions. SMEs order stock, pay the full order total, submit payment evidence and confirm receipt. Both delivery versions must produce equivalent reports for equivalent recorded business events.

This version includes HQ-managed SME and Driver account registration, delivery assignment and foreground live location sharing. HQ creates both account types and provides a login account ID or username and a temporary password. SMEs and Drivers sign in to their assigned portals with these credentials; public self-registration is unavailable.

## 2  Goals and users

| **Role** | **Responsibility** |
| --- | --- |
| SME | Sign in to the SME portal with HQ-issued credentials; maintain permitted business details, browse offers and locations, place orders, submit proof, follow progress, confirm receipt and view history. |
| Branch Staff | Record retail sales, maintain branch stock, generate sales reports and respond to assigned backup fulfilment requests. |
| Headquarters | Register and manage SME and Driver accounts, issue initial credentials, assign roles and driver affiliation, and reset or suspend access; manage catalog, branches, payments, stock, orders and reports. |
| Driver | Sign in to the Driver portal with HQ-issued credentials; view assigned delivery details, share location during an active delivery and report issues or handover. |

Success means an SME can complete a traceable wholesale order, headquarters can identify who must act next, and branch and consolidated reports reconcile with sales and stock records. A branch replacement must not create a second customer order or another wholesale sale.

## 3  Product boundaries

MVP assumptions: one supplier organisation, multiple branches, one stock location per branch, countable products with explicit pack conversions, and one fulfilment source per active delivery attempt. SME accounts are separate from supplier-owned branches. Walk-in retail buyers do not require accounts.

Out of scope: payment gateway, automatic refunds, credit or lending, automatic rerouting, split deliveries, external POS integration and validated AI demand forecasting. Reliable background mobile tracking, route optimisation and precise live ETA are later capabilities.

## 4  SME catalog ordering and full payment

**ACC01  HQ account registration.** Only authorised HQ users create SME and Driver accounts. For an SME, HQ records business name, delivery location and contact number. For a Driver, HQ records name, phone and HQ or branch affiliation. HQ assigns a unique login account ID or username, the correct role, account status and an initial temporary password. Use a separate internal SME identifier; business names need not be unique. Headquarters continues to provision branch accounts.

**Acceptance:** Neither SME nor Driver can create an account through a public registration page or endpoint. Only HQ can provision these roles. An SME can update permitted profile fields after login; existing order address and contact snapshots do not change.

**ACC02  Portal login and credential lifecycle.** HQ gives the account ID or username and temporary password to the intended SME or Driver. The user signs in with those credentials, changes the temporary password on first login, and enters the portal for the server-assigned role. SME and Driver users cannot choose another role during login or change their role themselves. HQ can reset credentials, activate or suspend an account and manage Driver affiliation.

**Acceptance:** A valid HQ-created SME account opens only its SME portal; a valid Driver account opens only its Driver portal. Inactive or suspended accounts are rejected. Password reset and suspension invalidate existing sessions; suspending a Driver stops location publishing without deleting order history. Store password hashes rather than readable passwords; HQ issues a new temporary password for a reset instead of viewing the user's current password. Audit account creation, reset, status and role changes without recording password values.

**CAT01  Catalog and discovery.** Show product name, variant, base unit, pack size, wholesale price, minimum order quantity and availability. Show HQ and branch addresses, contacts and FAQs. Clearly distinguish branch retail prices from HQ wholesale terms.

**Acceptance:** Unavailable items cannot be submitted as available. Identically named products with different sizes or packs remain distinguishable.

**ORD01  Order form and quote.** Capture products, quantities, destination, receiver name and phone, and notes. Validate pack multiples, minimums and destination coverage. Show goods, discounts, shipping and the full order total due before submission. The amount payable is the goods total after discounts plus shipping.

**Acceptance:** If shipping is unknown, obtain a final quote before payment submission. Changed terms require SME review and approval.

**PAY01  Full payment submission.** Display transfer instructions, the full order total due and order reference. SME transfers the entire quoted amount outside the platform and uploads payment evidence. Accept a private JPG or PNG proof image up to a proposed 5 MB, claimed amount, transfer time and reference where available. Save evidence versions.

**Acceptance:** Upload creates Awaiting verification. Validate file content and size on the server; unrelated users cannot access proof images.

**PAY02  Verification.** Headquarters checks the actual receiving account, amount and reference. Approve or reject the reviewed evidence with reviewer, time and reason. Flag repeated transfer references for human review.

**Acceptance:** A replacement screenshot needs a new review. Image appearance alone cannot automatically approve a payment. Approve full payment only when the actual verified amount matches the agreed order total, including shipping. An underpayment or other amount mismatch requires correction and cannot confirm the order or allow preparation or dispatch.

**ORD02  Confirmation.** Confirm only when full payment approval and stock reservation both succeed. Preserve agreed line prices, quantity, shipping, address and full payment total as order snapshots.

**Acceptance:** If stock is insufficient after full payment is verified, show Action required; arrange an SME-approved revision or cancellation and refund handling. Reconcile verified payment against any revised total before confirmation.

Full upfront payment of 100% of the agreed order total is required. Deposits, instalments and a remaining-balance collection step are not part of this flow. Record verified payments and any refunds as separate events. Delivery workflow completion does not create or verify a payment; full payment must already be approved before confirmation.

## 5  Order lifecycle and two party closure

Store payment review, headquarters fulfilment, SME receipt and open issues separately. The interface combines them into a readable timeline. Each change records actor, event time and reason when relevant. Headquarters owns wholesale fulfilment status in both versions.

| **State** | **Entry and permitted action** |
| --- | --- |
| Draft | SME edits the basket. No stock commitment. Submission with evidence enters Awaiting verification. |
| Awaiting verification | HQ checks the full payment and stock. Rejection returns the proof for correction; full payment approval plus reservation allows Confirmed. |
| Confirmed | Full payment is approved and agreed stock is allocated. HQ starts Preparing. A payment reversal or quantity change requires explicit resolution. |
| Preparing | The assigned source prepares the complete order. Record dispatch source and reference before Shipping. |
| Shipping | An active attempt has been dispatched. SME may confirm actual receipt or report an issue. |
| On hold | HQ records a customer-visible reason, prior fulfilment state and next update. Resolving the hold resumes the appropriate state. |
| Complete | HQ declares its fulfilment work complete. Missing SME receipt is displayed as Awaiting SME receipt. |
| Done | Derived when HQ is Complete, SME has confirmed full receipt, and no hold or delivery issue remains open. |
| Cancelled | Record reason, release unshipped allocation and preserve payment/refund follow-up. Do not delete the order. |

**ORD03  Receipt and exceptions.** Only the owning SME can confirm full receipt. If receipt comes before HQ Complete, show Received and awaiting HQ completion. Missing or damaged goods use Report an issue.

**Acceptance:** HQ Complete alone and SME Received alone cannot create Done. A partial delivery cannot be recorded as full receipt.

**ORD04  Revisions and cancellation.** Before confirmation, SME may request cancellation. After confirmation, HQ coordinates it and records the resolution. After dispatch, reconcile the shipment before cancellation or replacement.

**Acceptance:** No silent changes to agreed prices or delivery source. A verified payment is not automatically refunded when the order is cancelled. Record and track the required refund separately.

Done is posted once. Subsequent returns create linked adjustments rather than deleting completion or rewriting past sales. Prevent status jumps that bypass full payment approval, allocation or a required hold resolution. Retry-safe operations must not duplicate reservations, receipts or sale events.

## 6  HQ managed Driver accounts and live delivery tracking

**DRV01  HQ Driver provisioning.** HQ registers the Driver's details, creates the Driver login and temporary password, assigns HQ or branch affiliation and activates the account. The Driver uses the HQ-issued credentials to enter the Driver portal and completes the first-login password change before taking operational actions. There is no Driver self-registration or self-registration approval queue.

**Acceptance:** Only an active HQ-created Driver account can receive assignments and publish location. Inactive or suspended Drivers cannot operate. Driver credentials never grant HQ or branch management access.

**DRV02  Assignment and access.** HQ assigns an active HQ-created Driver account to one delivery attempt. Driver sees only required receiver contact, destination, parcels and instructions. Show Start sharing, Report issue and Handover reported.

**Acceptance:** Driver cannot see payment evidence, edit prices, mark HQ Complete or confirm SME receipt. Handover reporting is a delivery event, not customer confirmation.

**GPS01  Location publishing.** During Shipping, driver opts into location sharing on an HTTPS mobile page. Store attempt, driver, latitude, longitude, accuracy, capture time and receipt time. Target a 10 to 15 second publish or refresh cadence when fresh positions are available.

**Acceptance:** Validate driver assignment, active attempt, coordinate bounds and capture time. Old or out-of-order positions cannot replace the latest valid point.

**GPS02  SME tracking view.** Show dispatch source, destination, active driver point, accuracy indication and last update. After 60 seconds without a fresh capture, show Location temporarily unavailable with the last known point.

**Acceptance:** Do not relabel an old point as current, animate a fabricated route or infer delivery from GPS arrival. No precise ETA is promised.

**GPS03  Pause stop and failure.** Pause sharing on hold; stop after handover, cancellation, reassignment or driver suspension. If permission or internet is unavailable, show the reason to the driver and retain manual status updates.

**Acceptance:** Replaced drivers cannot write to the active attempt. SME sees a clear stale state rather than a false live marker.

The browser demo requires the tracking page in the foreground; locking the phone or switching apps can interrupt updates. Continuous background mobile tracking is a later implementation. Limit raw location access to the owning SME, HQ and the assigned driver during the delivery; raw point retention is a launch decision, proposed at seven days.

Backup uses a new attempt under the same order. HQ resolves the original shipment, obtains branch acceptance and stock allocation, then assigns its driver. Preserve the old attempt and switch the SME map only to the active replacement. Keep operational reports independent of whether GPS updates are available.

## 7  Branch sales inventory and backup controls

**INV01  Inventory ledger.** Maintain on-hand, protected wholesale reserve, active allocations and confirmed incoming transfers by location and SKU. Record opening balance, sale, dispatch, transfer receipt, return and adjustment with actor and reason.

**Acceptance:** Do not add incoming goods to on-hand until physically received. Reject negative quantities and preserve unit or pack conversion.

**BR01  Retail sale entry.** Branch staff selects products, quantities, actual prices and permitted discounts, then confirms a retail sale. Reduce stock and create sale lines atomically. Store a unique operation key.

**Acceptance:** A double tap records one sale. Available retail stock excludes protected reserve and other allocations; quantities above availability are rejected.

**BR02  Voids and returns.** Record a linked reversal or return with reason and original sale reference. Restore inventory only for quantities physically received and accepted back into stock.

**Acceptance:** A refund or reversal does not by itself prove goods were returned. Reversing the same line twice cannot exceed the original sale quantity or amount.

### Controlled branch backup sequence

1. HQ opens a delivery issue, places the order On hold and records the original attempt and fault reason.

2. HQ confirms the original consignment is stopped, returned or otherwise resolved. Do not send a replacement into an unresolved double-delivery situation.

3. HQ selects a branch able to supply the complete basket. Branch staff checks physical stock and accepts; the system reserves stock atomically.

4. Create a replacement attempt under the same order and preserve the agreed wholesale terms. Inform the SME of the source change.

5. Dispatch consumes the branch allocation and stock once. HQ resumes Shipping; normal receipt and completion rules apply.

If no branch can fulfil every line, remain On hold and agree a revision with the SME. Split shipments and automatic branch selection are deferred. HQ may change reserve quantities only through an authorised adjustment with a reason.

### Sales and stock attribution

Branch backup dispatch is a fulfilment stock movement against the original HQ wholesale order, not a new retail sale. Internal HQ-to-branch replenishment is a transfer, not revenue. Dispatched goods are removed from their source once; releasing an unshipped reservation only changes availability, not physical stock.

## 8  Reporting catalog filters and exports

These reporting requirements are mandatory and identical in both delivery versions. Manual status events and sale records provide the necessary inputs; driver registration and GPS are not dependencies for reporting.

| **Report** | **Required content** |
| --- | --- |
| R01 Branch retail sales | Branch, date, sale reference, product, quantity, unit price, discount, reversal and net value. Monthly totals: sales value, units and transaction count. |
| R02 Headquarters summary | Retail totals by branch, wholesale totals by order, product breakdown and combined net merchandise sales. Preserve the retail or wholesale channel and fulfilment source. |
| R03 Wholesale operations | Orders created during the period, their current status at generation, held or cancelled counts, and a separately labelled count of orders reaching Done during the period. |
| R04 Delivery and backup | Dispatched HQ and branch attempts, distinct orders served by backup, hold reasons and durations. Failed or replaced attempts stay in history. GPS data is not required. |
| R05 Payment review | Pending, rejected and approved evidence counts; verified full payment amounts by approval date. Keep this payment summary separate from merchandise sales. |

Filters: today or a selected day, month or year, or a custom date range; headquarters may also select branch, product, sales channel and order status. Branch staff are restricted to their own branch. State when a filter does not apply to a particular report.

Generate an on-screen report and downloadable CSV for the same selection. Export a summary with filters and totals, plus line-level detail as a separate CSV where needed. Use readable column names, consistent decimal precision and a stable date format. PDF export is optional.

Every row links to its sale, order, adjustment or delivery reference. Report data comes from recorded events, not manually typed dashboard totals. Keep the same selection and event cutoff while calculating totals and exports. Empty periods show zero totals with an explicit no-records message.

**REP01  Monthly branch report.** Show selected branch and month, gross sales, discounts, reversals or returns, net sales, units, transaction count and product totals. Allow a drill-down to underlying retail transactions.

**Acceptance:** The sum of visible detail rows reconciles to monthly summary totals for the same event cutoff.

**REP02  Consolidated reporting.** HQ can compare all branches, isolate wholesale, and view fulfilment source without changing the revenue channel. Restrict branch users to their own branch records.

**Acceptance:** One wholesale order fulfilled by a branch is counted once in HQ wholesale sales; branch retail totals are unchanged.

Proposed performance target: reports for 10,000 eligible sale lines render within five seconds at p95 under a defined pilot load. If the dataset exceeds the synchronous export limit, show a clear limit or use an export job; never silently truncate records. Confirm the supported pilot volume before load testing.

## 9  Reporting calculations and reconciliation

| **Rule** | **Definition** |
| --- | --- |
| Retail event date | Use sale confirmation time. Drafts do not count. A void or return is a linked adjustment dated when it is approved or posted. |
| Wholesale event date | Recognise merchandise sales in this operational report when an order first reaches Done. Confirmation, full payment approval and dispatch alone do not count. |
| Gross sales | Sum original sold quantity multiplied by the historical unit price before discounts, for eligible retail and wholesale sale events. |
| Net sales | Gross sales minus discounts minus posted sale reversals or returns. Return value uses the original line price after its allocated discount. |
| Order and attempt counts | Count orders by distinct order ID. Count a dispatch by distinct attempt ID and dispatch time; a failed HQ attempt plus branch replacement is two attempts but one customer order. |
| Units and attribution | Use defined base units and show returns separately. Branch retail is attributed to its branch. Wholesale remains the HQ sales channel even when a branch fulfils it. |
| Dates and snapshots | Use Asia/Yangon by default. Date selections include the whole chosen local dates. Show report generation time, event date basis, currency, channel and filters. |

A return posted in a later month appears as a negative adjustment in that later period; it does not silently rewrite the original month. Net sales may be negative. Show whether transaction count means new sales or adjustments; do not combine the two without labels.

Shipping is reported separately from merchandise sales. Verified full payments do not create additional merchandise sales. Payment and refund summaries must use verified records rather than claimed screenshot amounts. Confirmed orders require full payment; there is no scheduled remaining balance. No tax or commission amount is inferred without an agreed configuration.

### Worked monthly reconciliation example

| **Recorded event** | **Reporting result** |
| --- | --- |
| Retail sale of 10 units at MMK 1,000 | Gross retail sales MMK 10,000. |
| Return of 2 retail units in the same month | Retail adjustment MMK 2,000; net retail sales MMK 8,000. |
| One Done wholesale order of 10 units at MMK 3,000 | Gross wholesale sales MMK 30,000. |
| Return of 1 wholesale unit in the same month | Wholesale adjustment MMK 3,000; net wholesale sales MMK 27,000. |
| Verified full payment MMK 30,000 and an HQ attempt replaced by a branch attempt | Approved payment total MMK 30,000; refunds are reported separately. One customer order, two dispatched attempts and one backup-served order. |
| Combined merchandise sales for this example | MMK 35,000 net. Shipping, if any, remains separate. |

The example assumes no discounts or shipping charges, all listed events fall in the selected month, and the order reached Done in that month. A refund for the returned wholesale unit is recorded separately when verified. Both implementations must reproduce the same result and CSV records from these business events, even when the live version has no location data.

## 10  Data access screens and service requirements

### Core records

User and server-assigned role; unique login ID or username; password hash and first-login password-change flag; account status, HQ creator and credential-reset audit; supplier organisation and branch; SME profile and destination; product and pack conversion; location stock and ledger; retail sale and lines; wholesale order and immutable line snapshots; payment evidence and review; verified payment or refund event; delivery attempt; hold or issue; SME receipt; report selection and generation metadata; FAQ. This version also needs Driver profile, HQ or branch affiliation, assignment and location capture records.

| **Role** | **Access boundary** |
| --- | --- |
| SME | Own profile, orders, proof, timeline and receipt actions. Own active delivery map only. |
| Branch Staff | Own branch stock, retail records and reports; necessary details for accepted backup assignments. No SME payment evidence. |
| HQ | Organisation-wide catalog, stock, orders, payment review, branch reports and fulfilment control; SME and Driver account creation, role assignment, activation, suspension and credential reset. |
| Driver | Own profile and currently assigned jobs; write location only for the authorised active assignment. No payment review, inventory editing or sales reports. |

### Minimum screens

SME: sign-in with HQ-issued credentials, first-login password change, catalog and locations, FAQ, order and full payment form, order history and detail. Branch: dashboard, sale entry, stock, history and monthly report. HQ: SME and Driver account management with creation, temporary credential issuance, status, affiliation and reset actions; order and payment review queue, order detail, branch overview, catalog and FAQ management and report workspace. Driver: sign-in with HQ-issued credentials, first-login password change, assigned jobs and mobile tracking page. SME order detail includes Track delivery. No public SME or Driver sign-up screen is included.

### Quality and recovery requirements

Enforce role and record ownership on the server for every read and write. Encrypt transport, protect uploads and secrets, validate input and keep an audit trail for prices, stock, payment review and statuses. Use unique request keys and transactional updates for sales, reservations, receipts and Done events.

Proposed pilot targets: common actions within two seconds at p95 for 50 concurrent users; responsive screens from 360 px width; daily backups and a tested restore before live use. Keep drafts after failed requests and clearly show retryable errors. Money uses fixed precision in one configured currency, proposed MMK; timestamps are stored consistently and displayed in the business timezone.

Validate real devices and report volumes before claiming these targets are met. Log errors and failed exports without leaking payment screenshots, credentials or unnecessary customer location data.

## 11  Acceptance release priorities and decisions

| **Check** | **Release acceptance** |
| --- | --- |
| A01 HQ accounts and quote | HQ registers an SME and Driver, issues credentials and assigns each role. Both can sign in to only their own portal after changing the temporary password. Public self-registration is rejected; the SME can obtain a reviewable full order total including shipping. |
| A02 Evidence and confirmation | Proof stays pending until HQ verifies the actual transfer covers the agreed full order total. Underpayment cannot confirm an order or allow preparation or dispatch. Rejection and resubmission preserve review history. Full payment approval and confirmation reserve stock once. |
| A03 Two party closure | HQ Complete alone and SME Received alone do not create Done. Both confirmations plus issue resolution create one completion and sale event. |
| A04 Stock and backup | A retail sale or dispatch changes the correct stock once. Branch takeover resolves the old consignment and creates no duplicate order or retail sale. |
| A05 Reporting parity | Both versions reproduce the worked example, month boundaries, later-period returns, empty periods and identical CSV totals without GPS data. |
| A06 Access and retries | Cross-SME, cross-branch and cross-role access is denied. HQ credential reset or suspension invalidates old sessions. Retried sales, approvals, reservations, receipts and completion have one business effect. |
| A07 Driver and GPS | Inactive or suspended Drivers cannot work. Only the active HQ-created assigned Driver publishes to the active attempt. Denied permission, stale data, reassignment and suspension are visible and handled. |

### Build and release priorities

Build HQ-managed SME and Driver account creation, credential issuance, portal sign-in and first-login password change first, followed by the shared order, stock and reporting flow. Add Driver assignment, location publishing and the SME map next. Rehearse credential reset and suspension, HQ dispatch, missing GPS, a hold, branch replacement and two-party completion on separate devices. The full live variant is a three-day stretch for two to three experienced builders; background reliability and full production hardening need additional time.

### Open product decisions

Agree payment instructions and due time, quote validity, shipping charges, cancellation and refund handling, branch reserve policy and who may authorise adjustments. Full upfront payment is required. Confirm whether commissions from both SME and supplier still apply, plus rates and collection responsibility. Automatic commission collection is excluded from the demo.

### Later monthly stock planning

Future AI may recommend per-branch wholesale reserve using retail demand context, backup requests including unfulfilled demand, inventory and delay history. Retail history alone does not establish emergency wholesale demand. Until relevant history is available, use an HQ-approved manual target or clearly labelled baseline estimate. Report generation must work independently of AI.

Before a live pilot, resolve commercial and operational decisions, demonstrate a backup restore and reconcile a controlled order, full payment, receipt, sale and report. Acceptance criteria above are required checks, not claims that an implementation already exists.
