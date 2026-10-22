# SupplyLink UI/UX review

Originally reviewed 22 October 2026. **Revision 2: rechecked against the current working tree on 22 October 2026.** Scope: current frontend source, shared CSS, route structure, and repository desktop/mobile screenshots across HQ, SME, branch, and driver portals, including grouped deliveries, phased fulfilment, stock planning, physical stock movements, and the new takeover report.

## Revision 2 — changes since the first review

The main usability priorities remain mobile order visibility, clear order actions and delivery states, preserved shopping progress, driver navigation, stock terminology, and readable text. None of those original high-priority findings has enough new implementation evidence to close.

The latest planning and reporting work does improve task separation:

- Saving backup settings now switches the drawer to **Refill details**, with **Back to HQ settings** to return. The alert refill action still opens refill details directly, without the settings form.
- Suggestion criteria and supporting history are now available on demand through a help control beside Save settings. Changing target or threshold switches the displayed source to Manual; supported initial suggestions can populate an unset target. This is source-verified behavior, not a completed browser check.
- The duplicate emergency-takeover form and inline takeover history are absent from the current planning drawer. Takeover history now has a dedicated section under Reports with linked wholesale orders, pagination, loading/error/empty states, and expandable audit detail.
- Sales-report totals now use full formatted MMK amounts rather than compact notation. Refresh is an icon button with an accessible label and title. These refinements do not resolve reporting context and filter issues.

New findings **17–19** cover takeover-report scope, suggestion provenance/accessibility, and stale regression coverage. The existing overview health finding remains open: **No low backup alerts** can still coexist with **Needs setup** rows.

| Original finding                 | Current status              | Revision 2 check                                                                                  |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Mobile orders                 | Open                        | 1,050px minimum table width and full references remain                                            |
| 2. Order action summary          | Open                        | Long dialog and generic exception reason remain                                                   |
| 3. Delivery/completion hierarchy | Open                        | Phase status and overall status remain separate; detail pill still uses one green style           |
| 4. Basket recovery               | Open                        | Basket and checkout stage remain component state                                                  |
| 5. Driver navigation             | Open                        | Focused route layout and below-route location recovery remain                                     |
| 6. Stock vocabulary              | Open                        | Available pairs still combines retail and backup availability                                     |
| 7. Typography/contrast           | Open                        | Small labels and the cited breadcrumb color remain                                                |
| 8. Dashboard hierarchy           | Open                        | Network hero and HQ Create account heading action remain                                          |
| 9. Checkout sequence             | Open                        | Nested steps and original button labels remain                                                    |
| 10. Delivery planning navigation | Open                        | Planner remains under Driver                                                                      |
| 11. Planning health              | Open; related flow improved | Settings/refill separation improved, but missing-target counts and health filtering remain absent |
| 12. Movement navigation          | Open                        | Manage Stock Movement / Record labels and incomplete ARIA tab pattern remain                      |
| 13. Technical recovery copy      | Open                        | General error, map-token and explanation-setup wording remain                                     |
| 14. Reporting context            | Partly improved             | Exact totals and accessible refresh added; presets and context gaps remain                        |
| 15. Access/navigation language   | Open                        | Contact HQ remains non-actionable and portal switch appearance remains                            |
| 16. Shared patterns              | Open                        | Shared page metadata and repeated dialog/status patterns remain                                   |

**Verification performed for this revision:** current source/CSS inspection and one existing focused test run: `node node_modules/vitest/vitest.mjs run tests/stock-planning-workspace-ui.test.tsx --maxWorkers=2`. Result: **6 tests, 2 passed, 4 failed**. The passing cases cover existing-refill presentation and branch filtering. The failures include expectations for removed controls, formerly visible recommendation text, and a validation test that directly assigns controlled-input values. They establish a test/implementation mismatch; they do not by themselves prove broken production validation or failed user actions. See finding 19 before using historical green-suite claims as release evidence.

## Assessment and limits

SupplyLink has a coherent visual foundation. Forest green, Manrope, restrained borders, consistent spacing, and actual shoe imagery establish a credible operational product. The largest opportunity is making the correct action easier to find and understand, especially on a phone.

This is a heuristic design review, not a measured usability study. Screenshots are saved repository evidence and include earlier versions. Recommendations below were cross-checked against current components; earlier screenshots are not treated as proof that a subsequently changed screen still behaves identically. The in-app browser timed out when opening the isolated local preview during the first review. No new browser session or dev server was started for revision 2. Live click-through behavior, screen-reader output, current responsive rendering, upload recovery, and actual device GPS remain unverified. Reports, physical stock movements, and the latest planning-drawer changes were assessed from source without matching current screenshots. The focused automated test result above is separate from visual or end-to-end verification.

No implementation changes are proposed as already completed. Priorities indicate likely user impact, not measured conversion loss. High means address in the first improvement pass; medium means follow once essential workflows are clearer.

## What to preserve

- The forest/green palette and recognizable product photography.
- Role-specific navigation and clear HQ-issued access rules.
- Separate payment and fulfilment information: these represent different business facts.
- Explicit receipt and pickup confirmations, retry-aware feedback, and truthful stale-location labels.
- Existing native dialogs, focus outlines, skip link, mobile navigation focus management, reduced-motion support, and selected-size accessibility state.
- The revised stock planning overview/drawer separation, direct settings-to-refill transition, stock movement before/after preview, and privacy-aware descriptions of earlier delivery stops.
- Dedicated takeover reporting with linked orders and expandable audit detail, while keeping stock planning focused on reserves and refills.

## Prioritized findings

### 1. High — Mobile orders hide the information needed to act

**Evidence:** [mobile screenshot](screenshots/sme-orders-mobile.png); `src/components/sme-orders-table.tsx:64`; `src/styles/workflow.css:191`. The current table has a 1,050px minimum width and nowrap cells. Its first column displays the complete order reference, leaving status, value, payment, and dates outside the initial phone viewport. Driver management also retains a 720px table minimum in `src/styles/branches.css:14`.

**Improve:** Render compact order cards on phones: short reference, placed date, prominent status, pair count, total, and one contextual action. Keep full references accessible through copy/details and preserve search against the full reference. Retain a desktop table; optional columns and a sticky identity column can improve medium-width layouts. Apply the same principle to driver and branch stock lists where actions are far to the right.

**Acceptance:** At 360–390px, users can identify status and open the next action without horizontal scrolling. Full reference copying and searching remain available.

### 2. High — Order details need a clear next-action summary

**Evidence:** `src/components/order-workflow.tsx:215`, `:242`, `:313`, and `:851`; [order status](screenshots/sme-order-status.png); [phased order](screenshots/phase-2-shipping-order-remaining.png). Details combine phase progress, all order items, totals, tracking, completion checks, payment evidence, fulfilment controls, and exception forms inside a narrow scrolling dialog. The generic issue/rejection/cancellation reason field can appear even when the SME has no relevant action during preparation.

**Improve:** Start with status, what happens next, who must act, and the available primary action. Use short sections such as Overview, Delivery, Payment, and History. Show issue input after choosing “Report a problem”; distinguish that from cancellation and payment rejection. Use a full-screen detail view on phones and a wider page or drawer for complex HQ work. Keep small confirmations in dialogs.

**Acceptance:** The first viewport answers “What is happening?”, “Who is responsible?”, and “What can I do?” without opening history or reading stock rules. Reuse the existing selected-order URL behavior so refresh and back navigation still work.

### 3. High — Order, delivery, and completion states need clearer hierarchy

**Evidence:** `src/components/phased-fulfilment.tsx`; `src/components/sme-orders-table.tsx:106`; `src/styles/workflow.css:20`. The system has separate payment, order, phase, handover, and receipt states. The detail status pill uses one green treatment regardless of state. A partially fulfilled order can emphasize “Order remaining” while the active phase is Shipping.

**Improve:** Keep the underlying states but translate them into user-facing summaries. For example: “Partially delivered · 40 of 60 pairs received” and “Delivery 2 · 20 pairs on the way.” Show separate checklist items for customer receipt, driver handover, and HQ completion where applicable. Explain the exact outstanding condition rather than relying on “Complete” versus “Done.” Use consistent neutral, active, attention, and finished treatments with text and icons.

**Acceptance:** Users can tell whether goods are still travelling, receipt is required, or an internal confirmation is outstanding. A hold is visually distinct from successful completion.

### 4. High — Preserve shopping work across refresh and navigation

**Evidence:** `src/components/sme-checkout.tsx:71–82`. Basket, checkout step, and shop details are component state; no persistence is present in this component. Once created, an order is saved and can be finished later, which is useful, but the earlier shopping work has no equivalent recovery.

**Improve:** Save the basket by signed-in account and restore it after refresh. Revalidate price, stock, and minimum quantities before proceeding, and explain changes. Offer saved delivery details rather than asking returning shops to re-enter their receiver, phone, and address each time. Choose appropriate storage for contact information; a durable server draft is preferable to indiscriminately caching private details on shared devices.

**Acceptance:** Refreshing before order creation restores selected variants and quantities. Signing out or switching accounts does not expose the previous user's draft.

### 5. High — Driver navigation should lead with the route and recovery action

**Evidence:** [mobile navigation](screenshots/driver-navigation-mobile.png); `src/components/driver-delivery-screen.tsx:23`; `src/components/delivery-tracking.tsx:143`, `:202`, and `:224`. The focused page puts branding, headings, status, estimates, and route controls ahead of the map. “Resume live location” follows the route, legend, and timestamps. Handover is handled back in order details.

**Improve:** Give the driver a concise current-stop identity, large next-direction instruction, visible map, and a reachable action area. When GPS is unavailable, promote its recovery action next to the status. Keep timestamps and accuracy in expandable details. Provide direct access to receiver contact and the relevant handover action when the workflow allows it. Consider a native navigation-app handoff as an optional enhancement.

**Acceptance:** At phone width, the current stop and route are immediately recognizable. A stale estimate remains explicitly labelled; GPS recovery does not require scrolling through the map.

### 6. High — “Available stock” is too easy to confuse with stock available for retail

**Evidence:** `src/components/branch-stock.tsx:53`, `:81`, and `:97`; [branch stock](screenshots/branch-product-stock.png); `src/components/branch-backup-setup.tsx`. “Available pairs” includes backup reserves, while “Retail available” excludes them. Other screens use “Protected,” “Wholesale backup,” “Backup available,” and “Allocated.”

**Improve:** Establish one vocabulary: On hand, Available for retail, Reserved for wholesale backup, and Committed to deliveries. If a combined unallocated total is retained, label its scope explicitly and give retail availability stronger emphasis in branch selling tasks. Show a small stock breakdown and contextual explanations. Build on the new movement screen's before/after preview for refills, reserve changes, and stock removal.

**Acceptance:** Staff can answer “How many can I sell now?” from the summary without arithmetic. Changes show their effect on the relevant stock pool before submission.

### 7. High — Small typography and at least one low-contrast text color weaken readability

**Evidence:** `src/styles/workspace.css` uses many 10–12px labels; `src/styles/accessibility.css:158–161` reduces some mobile stat text to 10px. The desktop `.context-role` color `#818b7f` on the white topbar calculates to approximately **3.54:1**. This is a source-based color calculation, not a complete rendered accessibility audit. The main muted token `#6b756d` on white calculates to approximately 4.78:1, so the problem is not every muted label.

**Improve:** Use roughly 14–16px for operational reading text and 12–13px for secondary information; these are product design targets, not WCAG font-size requirements. Darken weak secondary colors. Target 44px primary touch controls on mobile and check icon/text controls individually rather than assuming every current control is inaccessible.

**Acceptance:** Normal text meets [WCAG's 4.5:1 contrast requirement](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html). Check touch targets against [WCAG 2.2 minimum size/spacing rules](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum); the minimum is 24×24 CSS pixels with exceptions, while 44px is the recommended product target for these field workflows.

### 8. Medium — The dashboard still spends too much space on repeated brand messaging

**Evidence:** `src/components/workspace.tsx:1056`, `:1207`, and `:852`; [HQ overview](screenshots/hq-hold-priority.png). The newer hold panel correctly appears first, but the large network hero still pushes operational lists downward. “Create account” remains the HQ overview's primary heading action.

**Improve:** Lead with a compact prioritized queue: delivery holds, payment reviews, orders ready to dispatch, and branch refills. Give each item age, owner, and a direct action. Reduce the hero to a compact welcome/network summary and choose a heading action relevant to outstanding work. Drivers should land on their next job; branches on sale/receipt tasks; SMEs on active orders and restocking.

**Acceptance:** The first laptop viewport shows actionable work. Existing hold prioritization is preserved and extended.

### 9. Medium — Checkout labels obscure the actual sequence

**Evidence:** `src/components/sme-checkout.tsx:355`, `:396`, `:444`, and `:643`; [payment on mobile](screenshots/sme-payment-destinations-mobile.png). The outer three-step progress includes an “Order” step containing three additional stages. “Confirm cart & order” precedes shop details and review; “Submit order” actually uploads evidence for an already saved order.

**Improve:** Use one clear sequence, such as Items → Delivery details → Review → Payment proof. Rename actions to what they do: “Continue to delivery details,” “Save order & continue to payment,” and “Submit payment proof.” On phones, show the amount due near the payment action, let users select a receiving method before expanding full account details, and preview the selected receipt with replace/remove controls. Keep the saved-order and pending-verification explanation.

**Acceptance:** Users understand when the order is saved and when payment proof is submitted. Important amounts and the action remain easy to find on a long mobile form.

### 10. Medium — Dispatch planning is hidden under a driver-directory label

**Evidence:** `src/components/workspace.tsx:94`; `src/components/delivery-group-planner.tsx`; [group planner](screenshots/grouped-delivery-hq-planner.png). The page called “Driver” contains grouped delivery planning followed by driver administration. Current source already handles a missing dispatch pin with a location picker; the older screenshot's missing-pin message is not treated as an unresolved bug.

**Improve:** Separate “Deliveries” and “Drivers,” or provide clearly named tabs within a “Delivery operations” section. Use a planner sequence: choose eligible orders, review stops, assign a driver, review readiness. Add a route preview and consolidated stop/order/pair counts. After assignment, surface which orders still need preparation or dispatch with direct links. Preserve the accurate “distance-based suggestion” wording.

**Acceptance:** An operator looking for route planning can find it without interpreting “Driver” as the dispatch workspace. Assignment success explains the next required step.

### 11. Medium — Planning health must distinguish missing setup from healthy stock

**Status:** Open. The newer settings/refill transition is a useful adjacent improvement, but does not change this finding.

**Evidence:** `src/components/stock-planning.tsx:76`, `:159`, and `:249`; [earlier planning overview](screenshots/stock-planning-overview-revised.png). Current source still derives the banner solely from low rows while target-less rows display “Needs setup.” A “No low backup alerts” banner can therefore coexist with several “Needs setup” rows. The banner is literally accurate, but can suggest that all branches are adequately protected. The saved screenshot illustrates that combination; it does not document the latest drawer.

**Improve:** Show separate counts for Low stock, Missing targets, and Open refills. Add filters and sort actionable rows first. Make “No alerts among configured targets; 4 variants need setup” explicit. Keep manual controls and the existing advanced monthly planning separation. Present recommendation evidence and rationale in business terms; avoid requiring users to understand model identifiers or cache versions.

**Acceptance:** Unconfigured reserves are never mistaken for reviewed healthy reserves. The overview identifies the next planning task.

### 12. Medium — Stock movement labels and tab behavior need refinement

**Evidence:** `src/components/branch-stock-movements.tsx:167`, `:184`, `:302`, and `:358`. The page, section, and first tab repeat “Manage Stock Movement”; “Record” names the history tab, while the active form records a new movement. The tab controls declare ARIA tab roles without corresponding keyboard handling or a complete tab/panel relationship in this component.

**Improve:** Name the page “Stock movements” and the views “Record movement” and “Movement history.” Preserve the current balance preview and make the affected pool explicit. Implement the full keyboard tab pattern and associated panels, or use ordinary buttons with correct state semantics. Review how unknown movement kinds are described; do not expose raw internal event names as customer-facing labels.

**Acceptance:** Users can distinguish entering a movement from viewing history. Keyboard users can operate the view switch consistently.

### 13. Medium — Generic technical errors leave ordinary users without a useful recovery path

**Evidence:** `src/app/error.tsx:10`; `src/components/location-map.tsx:133`; `src/components/stock-planning-versions.tsx:519`. User-facing errors mention Supabase migrations, Mapbox tokens, and a server-only Groq API key. The general error page also promises existing records were unchanged, which may be too broad after a save succeeded but refresh failed.

**Improve:** Lead with the affected task and a usable recovery: “We couldn't load your workspace. Retry, or contact HQ.” Put diagnostics behind an error code or admin detail view. Distinguish failed loading from uncertain save outcomes. Existing action-level retry messages already handle some uncertainty well; extend that approach. Provide an address/manual fallback when maps cannot initialize, where business rules permit it.

**Acceptance:** A shop owner or driver can understand the next step without technical knowledge. A generic failure does not assert a save outcome the UI cannot know.

### 14. Medium — Reporting needs faster filtering and clearer context

**Status:** Partly improved. Full formatted MMK totals and a labelled refresh icon are now implemented. Common-period presets, a clear active-range summary, and footer scope remain outstanding.

**Evidence:** `src/components/workspace.tsx:2014`, `:2054`, `:2077`, and `:2173`. Current reporting offers from/to dates, channel selection, three exact formatted totals, channel comparison bars, source records, cutoff information, export, and a separate takeover-history section. The matching sales-record/export basis is a good foundation. The takeover section uses a different query and scope; see finding 17 before assuming it shares the sales filters or export.

**Improve:** Add Today, This month, Last month, and Custom presets. Show the active date range next to totals. Add branch comparison/filtering if HQ needs it, and a time-series view only when it answers an operational question. When channel-filtered, avoid visually suggesting that excluded-channel zero means no business activity. Make the footer clear about a page subtotal versus the entire filtered total.

**Acceptance:** A user can generate the common monthly view quickly and explain what the totals include. Visible totals and exports retain their existing reconciliation rules.

### 15. Medium — Access recovery and navigation labels need more direct language

**Evidence:** `src/components/auth-form.tsx:146`; `src/app/login/page.tsx`; `src/components/workspace.tsx:812`; `src/lib/portals.ts`. The login says “Contact headquarters” without an actionable contact. The workspace switch looks like a dropdown but navigates to the portal picker. “SME,” “Driver,” “Stock Planning,” and “Stock Movement” mix audience language and capitalization.

**Improve:** Add a configured “Contact HQ” phone/help action and clear reset-request instructions consistent with the actual account process. Consider “Shop portal” with SME as secondary wording. Rename the portal link to “Switch portal” or make the interaction match the dropdown appearance. Standardize pluralization and sentence case. Consider Myanmar-language support after validating language needs with real shop owners and drivers; the current UI is English.

**Acceptance:** Users can recover from forgotten credentials and understand the destination of navigation controls. Translation is based on user need rather than an assumed requirement.

### 16. Medium — Shared interaction patterns need a small reusable design system

**Evidence:** Repeated dialog implementations in `workspace.tsx`, `sme-orders-table.tsx`, and `stock-planning.tsx`; global styling spread across `globals.css`, `workspace.css`, `accessibility.css`, and feature files; one shared metadata title in `src/app/layout.tsx:12`.

**Improve:** Standardize Button, StatusBadge, FormField/error, Dialog/Drawer, DataTable/mobile list, EmptyState, and ActionSummary components. Define typography, spacing, semantic status, and interaction tokens. Add unique page titles for navigation and assistive technology. Link error messages to fields and move focus to relevant errors where appropriate. Do not replace existing native dialog/focus behavior with a visually polished but less usable custom modal.

**Acceptance:** The same state and action look and behave consistently across roles. Reusable components reduce the cost of fixing mobile layouts and accessibility problems across the application.

### 17. Medium — Takeover history appears filtered even though it has an independent scope

**Status:** New in revision 2; source-verified.

**Evidence:** `src/components/takeover-report.tsx:9`, `:38`, `:68`, `:94`, and `:118`; `src/components/workspace.tsx:2173`. The new section sits below sales records on Reports, but its request includes only `view=takeovers` and page. Its component receives no sales date range, channel, or cutoff. The top-level refresh and export handlers also do not include takeover history. The section says “across wholesale orders” but does not explicitly identify its independent time/filter scope. Each status receives the same neutral treatment, and audit actions are rendered directly from event action strings.

**Improve:** Decide whether this is an all-time operational report or part of the selected reporting period. If independent, label it **All-time takeover history · sales filters do not apply**, provide its own refresh/filter controls, and state what the top export contains. If integrated, pass the relevant period and cutoff explicitly and reconcile the export. Translate internal statuses/actions into readable labels. Provide a compact mobile summary with branch, short order reference, date, quantity, and status before expanded details.

**Acceptance:** Changing the sales period never creates a misleading impression that takeover history changed with it. Users can refresh the history intentionally and identify which records an export includes. Important takeover information is accessible at 360–390px without relying on the far-right columns of the eight-column table.

### 18. Medium — Suggested targets need visible provenance and a predictable help interaction

**Status:** New in revision 2; behavior requires browser/keyboard verification.

**Evidence:** `src/components/stock-planning.tsx:480`, `:510`, `:594`, and `:604`; `src/styles/stock-planning.css:205`. An eligible recommendation can populate an unset target, while editing target or threshold changes its source to Manual. Evidence and calculation criteria are hidden behind a question-mark control. The content itself accurately describes a recorded-history estimate rather than a trained forecast, but the default source label is “AI-assisted.” The help uses `role="dialog"` within a native modal; it has toggle/close controls and a local Escape handler, but no explicit focus transfer/return in the help interaction.

**Improve:** Put **Suggested from recorded demand** and a short evidence summary beside a suggested value, and keep **Manual override** clear after edits. Preserve a visible explicit Save action; changing a field should not silently approve a recommendation. Use a disclosure for inline help or implement a consistent nonmodal popover pattern with focus handling. Verify that Escape closes help first without unexpectedly dismissing the parent drawer, and that reopening help returns to a useful reading position. Retain the honest calculation explanation.

**Acceptance:** Users understand whether a number is saved, suggested, or manually overridden before pressing Save. Keyboard and assistive-technology users can open, read, close, and return from criteria help predictably. Source inspection does not count as a completed accessibility check.

### 19. High verification priority — Planning regression checks no longer establish the current flow

**Status:** New in revision 2; reproduced in the focused test run. This is a verification finding, separate from the design priorities.

**Evidence:** `tests/stock-planning-workspace-ui.test.tsx` currently reports **4 failures and 2 passes**. The linked-order test looks for **Manage original wholesale order** in the planning drawer although linked takeover history now lives in Reports. Other tests expect immediately visible insufficient-history text and an **Apply recommended target** flow that the current settings UI no longer renders. The manual validation case directly changes DOM values on controlled inputs and then fails to find the expected alert; its test interaction needs review before concluding that user-driven validation is broken. Several assertions stop their tests early, so later focus/escape assertions in the same tests are not verified by this run.

**Improve:** Update existing tests around the intended current interactions: source labelling, suggested initial target, manual edits, threshold validation through real change events, save-to-refill navigation, return-to-settings navigation, criteria help, and linked orders from TakeoverReport. Add focused coverage for independent report filters/refresh and empty/error/pagination behavior where it is missing. Reconcile planning documentation that still describes inline takeover history or explicit recommendation-application controls. Do not change product behavior solely to satisfy obsolete assertions.

**Acceptance:** Relevant tests pass for the intended current flow, including validation, escape/focus behavior, and the moved linked-order action. Any release claim names the newly run checks; historical documentation of a green suite is not presented as current evidence. No tests or application code were changed during this audit update.

## Suggested delivery order

| Pass                | Work                                                                                                                | Outcome                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1                   | Mobile order cards and short references; order action summary; state labels; stock vocabulary; contrast corrections | Essential status and actions become understandable at a glance |
| 2                   | Persisted basket; clearer checkout/payment proof; focused driver layout and GPS recovery; technical error copy      | Common tasks become easier to complete and recover             |
| 3                   | Task-first dashboards; delivery/driver separation; planning setup counts; movement tabs; reporting presets          | Navigation and repeated operational work become faster         |
| Alongside each pass | Extract only the shared components needed for that pass; test keyboard and responsive behavior                      | Improvements remain consistent without a speculative rewrite   |

Before accepting the latest planning/reporting flow, reconcile the failing focused tests in finding 19 and verify criteria-help focus behavior and takeover-report scope. These verification tasks accompany the first pass; they do not displace the user-facing priorities or require a broad rewrite.

## Screen coverage

| Area                                                    | Evidence reviewed                                                                               | Main recommendation                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Portal choice, sign-in, password change                 | Source and saved SME sign-in screenshot                                                         | Direct help, clear role labels, field-level recovery                                       |
| Shared shell, overview, navigation, help, notifications | Source and saved HQ/driver overviews                                                            | Task hierarchy, semantic navigation, compact repeated messaging                            |
| SME catalog and cart                                    | Source and desktop/mobile screenshots                                                           | Keep imagery; preserve basket; improve quantity feedback                                   |
| SME checkout and payment                                | Source and saved mobile proof/account screens                                                   | One progress sequence; precise buttons; receipt preview                                    |
| SME order list, detail, and receipt                     | Source and desktop/mobile detail screenshots                                                    | Mobile cards; action summary; distinct completion conditions                               |
| HQ orders and phase/backup workflows                    | Source and saved phase/order screenshots                                                        | Clear owner, active delivery, and remaining quantity                                       |
| Group delivery planning and pickup                      | Source and saved planner/checklist screenshots                                                  | Findable planning workflow, readiness summary, direct next steps                           |
| Driver navigation and tracking                          | Source and saved mobile route screen                                                            | Immediate route context, prominent GPS recovery                                            |
| Branch network, detail, refill, and backup setup        | Source and saved desktop/mobile screens                                                         | Consistent pools and vocabulary, before/after stock effect                                 |
| Branch stock and retail sales                           | Source and saved stock screen                                                                   | Retail availability first; quick sale entry and clear totals                               |
| Physical stock movements                                | Current source and CSS                                                                          | Record/history labels, keyboard view switching, retain balance preview                     |
| Stock planning and monthly versions                     | Current source/CSS, earlier saved overview/drawer, and focused UI test run (2 passed, 4 failed) | Missing setup count, suggestion provenance, help behavior, and current regression coverage |
| Accounts and driver management                          | Source and saved desktop/mobile screens                                                         | Mobile actions, role-specific forms, direct access help                                    |
| Sales reports                                           | Current source, including exact totals and labelled refresh                                     | Presets, period context, comparison only where useful                                      |
| Takeover history                                        | New component source and CSS; no matching current screenshot or dedicated component test found  | Explicit filter/export/refresh scope, readable events, mobile summary                      |
| Settings, error, and not-found states                   | Source and saved payment settings screenshot                                                    | Business-oriented recovery and readable settings layout                                    |

## Validation before accepting a redesign

Use realistic demo states: rejected proof, payment pending, held shipment, partial delivery, no GPS, missing pin, exhausted retail stock, available backup stock, open refill, missing planning targets, an eligible suggested target, a manual override, and multiple pages of takeover history. Check 360px, 390px, tablet, and laptop widths, browser zoom, keyboard use, and actual mobile foreground GPS behavior. Also check settings-save navigation, help Escape/focus behavior, sales-period changes with takeover history visible, and report refresh/export scope.

Test five short tasks with representative users: find and finish an order needing payment proof; understand a partially delivered order; record a retail sale without using backup reserves; accept and collect the correct driver parcels; and identify/refill a low-stock branch. Observe completion, mistakes, hesitation, and support requests before deciding whether more visual redesign is justified.
