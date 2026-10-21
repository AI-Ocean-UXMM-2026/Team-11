# Driver pickup and foreground delivery tracking

HQ or the fulfilling branch still assigns, prepares and dispatches a delivery.
The assigned driver then confirms physical collection using **Confirm pickup &
start delivery**. Pickup is a separate, recorded delivery event. Location sharing
begins in that browser after pickup succeeds and the driver grants GPS permission.
GPS permission failure does not roll back pickup or block manual handover.

Keep Supply Link open on an HTTPS page (localhost is allowed during development).
The driver can close the order dialog or navigate within the driver portal while
sharing. The portal displays a persistent location-sharing notice with pause and
resume controls. Hiding the page pauses the GPS watch; returning resumes it if
the delivery is still eligible. Reloading the browser requires **Resume live
location** because consent is kept in memory rather than browser storage.

## Location lifecycle and access

`watchPosition` provides actual GPS fixes. Client and database guards limit
accepted location updates to one every 10 seconds while sharing. A fresh fix can
be sent immediately after resuming. Old, duplicate, out-of-order, invalid, or
more than five seconds future-dated fixes cannot overwrite the latest position.
Each update verifies the active driver, current attempt, pickup, dispatch and
order state in the database. Coordinate bounds, accuracy and capture time are
validated on both sides of the API.

Only HQ, the ordering SME and the assigned driver can read the location. Branch
staff and other drivers/SMEs have no location access. RLS also protects direct
reads and Supabase Realtime events. There are no client table-write grants.
Only the latest fix per attempt is stored in `delivery_tracking`; the baseline
raw-location-history table is unused and its client reads are revoked.

Holds pause publishing and retain a clearly labelled last-known point. Handover,
cancellation, replacement and driver suspension stop publishing and clear the
coordinates. Replacement creates a separate attempt and requires its driver's
own pickup confirmation. Server checks remain authoritative even if a client
misses an event or keeps an old page open.

The map shows the destination, driver position and dispatch source when its pin
is available, plus accuracy and capture time in Yangon time. HQ has no configured
dispatch pin yet, so its source is shown by name. A fix becomes stale after 60
seconds; a disconnected live subscription also prevents a “live” label. There
are no inferred routes, arrival-based status changes or precise ETA estimates.
Driver handover, SME receipt and HQ completion retain their separate meanings.

## Transport and rollout

Apply `supabase/migrations/20261021104603_driver_pickup_tracking.sql` after all
earlier migrations before using this app version against hosted Supabase. It
adds pickup metadata, lifecycle triggers, protected RPCs and the RLS-protected
`delivery_tracking` table. It adds that table to `supabase_realtime` when the
publication exists. Confirm the publication includes the table and Realtime is
enabled for the hosted project. The local demo applies the migration on its next
request, including when its database survived a hot reload.

Hosted maps subscribe to Postgres Changes, then invalidate a dedicated TanStack
Query tracking snapshot. GPS events do not refetch all workspace pages; delivery
state/pickup changes refresh the open order. Ordinary workspace queries retain
their focus/reconnect behavior with no polling timer. A local clock only updates
the freshness label. The single-process demo uses an authenticated SSE connection
with change notifications and periodic connection reauthorization; it does not
need hosted Supabase. It is not a multi-instance production transport.

Map tiles require the public Mapbox token described in [maps](maps.md). GPS
publishing is independent of the map token, so missing tiles do not erase pickup
or prevent manual delivery updates. Hosted Realtime, real-device GPS and Mapbox
tiles require an HTTPS, separate-device walkthrough after rollout.

## Verification

Database tests cover pickup authorization and replay, full order completion,
branch replacement, RLS, direct-write denial, timestamps, throttling, holds,
handover, replacement and suspension. Browser simulations cover explicit pickup,
navigation, visibility, permission denial, throttling and watch cleanup. These
tests use synthetic positions and mock browser GPS; they do not collect anyone's
real location or prove phone/background reliability.
