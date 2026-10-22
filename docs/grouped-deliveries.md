# Grouped deliveries and customer privacy

HQ can use **Plan grouped deliveries** on Wholesale orders to select
two to eight ready, pinned orders from the same fulfilment location, choose a
driver, review the sequence and assign the group atomically. Branch staff have
the same planner on their own orders. Each parcel retains its separate payment,
stock allocation, dispatch, physical pickup, handover and customer receipt.

## Driver acceptance and parcel pickup

The driver dashboard and My deliveries show **Group pickup**. An uncollected
grouped order's popup uses the same controls instead of the single-parcel button.

1. **Accept delivery group** records acceptance on the server. It does not
   request GPS permission, mark a parcel collected, or share location.
2. After HQ/branch dispatch, the driver checks only physically collected parcels.
   Undispatched, removed and held parcels cannot be checked. Nothing is preselected.
3. **Confirm pickup & start route** confirms all checked parcels in one transaction
   and starts one foreground GPS publisher. A failed parcel validation rolls back
   the entire batch. Unchecked parcels keep awaiting pickup and receive no GPS.
4. The driver can return to collect remaining parcels later. Live navigation for
   a collected order includes only collected stops, preserving the assigned sequence.
5. Handover remains per stop. Tracking ends for that customer and continues through
   remaining collected deliveries. Customer receipt remains separate; HQ completion
   is no longer required. Phased orders become Done after all phase handovers and
   receipts; see [phased fulfilment](phased-fulfilment.md).

Acceptance survives reload. GPS consent remains memory-only; after reload use the
existing Resume location sharing control in delivery view. GPS denial still allows
manual handover. Already-collected legacy groups derive their acceptance timestamp
from their earliest recorded pickup so existing trips continue without interruption.

`GET /api/driver/delivery-groups` returns only the signed-in driver's active groups.
`POST` accepts `{runId, action: "accept" | "pickup", orderIds, key}`. Acceptance uses
an empty `orderIds`; pickup requires one to eight distinct checked order IDs.
The database checks actor, group membership, current assignment and dispatch state.
Retries reuse the same key, with a canonical parcel set fingerprint; accepting
never calls the tracking publisher. Customer and HQ access is denied. Existing
private group tables retain RLS and no direct client grants.

Migration: `20261022121728_group_acceptance_pickup.sql`, after grouped delivery routes.

Acceptance/pickup verification: all 271 tests across 53 files, TypeScript and the
production build passed. The isolated preview verified browser acceptance with
no pickup/GPS, a single checked parcel, exclusion of the unchecked parcel from GPS
and navigation, later pickup with matching retry replay, synthetic GPS fan-out,
and per-stop handover with continued publishing. No real phone GPS was used.
Screenshots: `screenshots/group-pickup-before-acceptance.png` and
`screenshots/group-pickup-checklist.png`.

Hosted rollout of this additional migration was approved explicitly and applied
on 22 October 2026. Its migration record matches the local version. The five
orders, six profiles and one delivery group were retained; before/after digests
for orders, attempts and tracking matched. The collected group's acceptance
matches its earliest pickup. Authenticated driver reads succeed, customer read
and mutation attempts are denied, anonymous execution and direct group-table
reads remain denied. Both existing group stops were already handed over, so the
driver currently has no active group to collect. Verification did not accept or
pick up live parcels. Local demo migrations include this update automatically.

**Suggest nearest stops** uses straight-line geographic distance, starting from
the branch pin when available. Without a saved dispatch pin, staff choose a
starting point on the planner's map. This temporary point is used only to order
the stops; it does not update the saved dispatch location or tracking route.
The button reports whether it changed the sequence or it was already in nearest-stop
order, and identifies the first drop-off. This is a transparent heuristic, not an AI model, traffic estimate
or guaranteed optimum. Staff can move stops up or down before assignment. Road
geometry and driving estimates then come from Mapbox through all authorized
remaining waypoints in that sequence. No customer addresses are sent to an LLM.

## Views

| Viewer                      | Visible route and stops                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HQ and assigned driver      | All remaining stops, numbered in assignment order. HQ also receives their order references and business names. The focused driver map keeps parcel/order content in its existing popup. |
| Customer at stop 1          | Driver GPS and the route ending at their own destination. No later stop is returned.                                                                                                    |
| Customer at stop 2 or later | Driver GPS, anonymous earlier stop markers and the road route ending at their own destination. No later stop is returned.                                                               |
| Unrelated account           | Existing order ownership checks deny tracking and routing.                                                                                                                              |

An earlier customer marker contains only its sequence number, coordinates and
an `own: false` flag. Its order ID, business/shop name, contact, address text,
contents, payment data, delivery status and attempt ID are not returned to
another customer. This deliberately shares the earlier stop's geographic pin,
as requested; it is not an approximate location. The private run tables have
RLS enabled and no client grants. The checked tracking RPC constructs the
projection before the server requests directions or looks in its route cache.
Cache keys include the allowed waypoint sequence, so a customer cannot receive
a longer HQ route from a cached response.

## GPS and lifecycle

One browser GPS publisher fans a fix out transactionally to the group's eligible
picked-up deliveries. Unpicked parcels never gain a GPS fix through grouping.
Pausing sharing pauses eligible members together. A held delivery is excluded
from publishing until resolved. Handover, replacement and cancellation stop that
order's tracking and remove it from remaining route projections. A handed-over
customer no longer receives group stops or the driver's location. The publisher
can continue through another already-picked-up group member without needing
another browser GPS permission prompt. GPS never confirms delivery or receipt.

Realtime events on each order's existing RLS-protected tracking row refresh its
projection. Sibling rows are also invalidated after an attempt transition. The
single-process local demo broadcasts only change notifications, with each read
still checked. No workspace polling timer was introduced.

Assignment retries use an actor-scoped key and exact ordered payload fingerprint.
Orders and the selected driver are locked while validating and assigning; a
failure rolls the entire group back. A driver with other active jobs cannot be
given a new group until those jobs are resolved or reassigned. Existing ordinary
single-order assignment still permits several jobs for one driver. Group GPS
and order workflow transitions use the same driver advisory lock to avoid
cross-stop lock inversions.

## Rollout and limits

Apply `20261022110558_grouped_delivery_routes.sql` after the earlier migrations
when setting up another environment. The local demo includes it automatically.
No new public tables or publication changes are required; existing
`delivery_tracking` Realtime publication and policies still apply. After explicit
user approval on 22 October 2026, this migration was applied to the connected
Supply Link project. Its hosted migration version matches the local filename.
The earlier local-only verification below predates this hosted rollout.

The ready-order picker is bounded to the oldest 100 candidates and reports this
limit. Groups have at most eight stops. Editing/reoptimizing a dispatched group's
sequence, adding stops mid-trip, vehicle capacity, time windows, stop service
times, traffic-aware optimization, background GPS and voice navigation remain
future work. Browser reload still requires explicit GPS resume. Real-phone GPS
and hosted Realtime need their existing HTTPS walkthrough.

## Verification

254 tests were verified across the full suite and targeted reruns. The full run
initially hit three five-second fixture-construction timeouts in the existing
migration recovery suite. Moving database construction to `beforeEach` kept the
normal assertion timeout, and all four recovery tests then passed. The six group
database tests cover assignment/retry atomicity, branch scope, private grants and
RLS, customer prefix redaction, GPS fan-out, handover cleanup and publisher
continuation. Route endpoint tests also check that the full HQ cache cannot be
reused for a shorter customer route. TypeScript and the final production build
passed, along with targeted formatting and diff checks.

An isolated production demo on port 3102 checked the complete flow: HQ browser
selection and assignment, separate pickup confirmations, one synthetic GPS fix,
HQ/driver/customer route requests, unrelated customer denial and actual Mapbox
road geometry. HQ and the driver received a 128-coordinate two-stop route; the
first customer received a 59-coordinate route ending at their own stop, and the
second received the two-stop route with the first pin anonymous. Browser checks
confirmed numbered markers, hidden other-shop details, and no horizontal overflow
at 375×812. After first-stop handover, the open second-customer screen removed
the first marker without reloading and recalculated its route. The finished
customer no longer received GPS or run data. GPS was synthetic, not real-phone
location, and hosted Supabase was unchanged.

Hosted rollout verification subsequently confirmed that HQ can query the planner
(two drivers, zero ready orders), customer accounts cannot query planning, and
anonymous REST callers are denied with `42501` rather than the missing-function
`PGRST202` error. The three existing orders and five profiles were retained; no
real delivery groups or assignments were created during verification. The current
orders were one Shipping and two Done, which explains the empty ready-order list.
Two regression tests cover a clear setup-pending message if another environment
is missing either planner RPC; raw schema-cache text is no longer shown for that
case.

Evidence: `screenshots/grouped-delivery-hq-planner.png`,
`screenshots/grouped-customer-first-stop.png`,
`screenshots/grouped-customer-second-stop.png` and
`screenshots/grouped-customer-second-stop-mobile.png`.
