# Live road routing

The assigned driver can open **Open delivery view** from an order to use
`/driver/deliveries/[orderId]`. Its larger map includes the blue driver pin, green
destination, road route, remaining distance, estimated drive time and next road
direction. Recenter on me follows fresh shared GPS; panning stops follow mode.
Show full route restores an overview. Built-in zoom/fullscreen controls remain.
The driver order popup has no embedded Delivery location section. Its parcel,
receiver and handover information stays in the popup; none is rendered on the
navigation page. **Back to order** returns to the originating Overview or My
deliveries page and automatically opens that same order. Return selections are
UUID-validated and loaded through the authorized workspace query, including
orders beyond the first list page. Closing the restored popup removes the return
selection from the URL. Navigation does not stop active GPS sharing.
HQ and the ordering SME see road routing in their order details. Branch staff
and unrelated accounts cannot read it.
For multi-stop assignment and customer-specific anonymous route prefixes, see
[grouped deliveries](grouped-deliveries.md).

## Origins and lifecycle

Before pickup, the preview uses the saved dispatch pin and order destination.
If a source pin is missing, the screen explains this instead of inventing one.
After pickup, routing starts from the latest shared GPS fix, never the account's
saved address. Stale GPS/disconnected subscriptions label estimates as last known
and hide live arrival/follow controls. Holds retain the last route; handover,
cancellation and attempt replacement end live routing for that attempt.

Arrival never confirms handover, receipt, completion or a sale. Existing manual
workflow actions remain authoritative and available even if routing fails.

## Directions and estimates

Mapbox Directions `mapbox/driving`, `geometries=geojson`, `overview=full`,
`steps=true` supplies road geometry and maneuvers. Travel times use ordinary
driving estimates, **not live traffic**. Remaining time is proportional to road
progress and does not predict stops or local access restrictions. Validate the
routes on Yangon roads for the actual delivery vehicle. This phase does not
include motorcycle-specific routing, voice guidance, offline maps or background
GPS.

Directions uses the existing `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` as a fallback. If
its URL restrictions refuse Directions, configure an appropriate server-only
`MAPBOX_DIRECTIONS_TOKEN` locally/in the deployment environment. Tokens are never
returned by the endpoint or its errors. No service-role key is used. Mapbox
receives the authorized origin and destination to calculate the road route.

## Access and request control

`GET /api/orders/[id]/route` authenticates the active account and calls the existing
checked `workflow_tracking` RPC **before every cache lookup**. That RPC enforces
HQ/owning SME/assigned driver access and account/assignment changes. Clients
cannot supply arbitrary coordinates. Responses use `Cache-Control: private,
no-store`; route data is not persisted in browser storage or a public cache.
The focused page uses the existing checked workspace order selection, so it is
not limited to orders in the first page of a list. No migration is needed.

A bounded process-local cache (100 entries, five-minute expiry checked on reads)
shares provider results for each order/attempt/mode/destination. Concurrent calls
share one provider request; provider failures back off for 30 seconds. A
multi-instance deployment should use a shared cache/rate limiter for a fleet-wide
request budget.

GPS events trigger rerouting when a fresh accurate fix is more than
`max(80m, 2 × accuracy)` off-route, or after three minutes when the driver has
moved at least 200m from the calculation origin. Both client and server enforce a
30-second cooldown. Fixes with accuracy worse than 100m do not trigger automatic
rerouting. Focus/reconnect refreshes remain; there is no new workspace polling
timer or Directions request for each GPS update.

## Verification

Tests cover road progress at bends, origins, stale/stopped states, cooldown and
accuracy, authorization before cached reads, concurrent calls, provider errors,
line layers, and follow/overview controls. Real-phone foreground GPS still needs
an HTTPS road walkthrough; switching apps or locking the phone can interrupt it.

Local verification: all 166 tests in 35 files passed, TypeScript and the production
demo build passed. `npm run smoke:routing` checked a real Mapbox response (157
road coordinates, 9 directions), synthetic GPS publishing, HQ/SME/driver access,
branch/unrelated SME/unsigned denials and focused-page role protection. No hosted
data was changed. Browser checks verified live progress without a reload,
follow/overview controls and mobile layout with 44px controls and no horizontal
overflow at 375×812. Both pins remain inside the map and clear of its controls.
Evidence: `screenshots/live-routing-desktop.png` and
`screenshots/live-routing-mobile.png`. Actual phone GPS was not collected.

Navigation-only follow-up: 20 targeted tests across four files, TypeScript and
the production demo build passed. Desktop checks verified that Open delivery
view contains only navigation information, and Back to order restores the same
popup from both Overview and My deliveries. Closing that popup clears the order
selection from the URL. The same return flow passed at 375×812 with no
horizontal overflow. Real Mapbox tiles and a road route rendered; the saved demo
GPS was correctly labelled as last known rather than live. Evidence:
`screenshots/driver-navigation-only.png`,
`screenshots/driver-navigation-mobile.png` and
`screenshots/driver-order-popup-return.png`.

References: [Directions API](https://docs.mapbox.com/api/navigation/directions/),
[GeoJSON road lines](https://docs.mapbox.com/mapbox-gl-js/example/geojson-line/),
[pickup and GPS](driver-tracking.md).
