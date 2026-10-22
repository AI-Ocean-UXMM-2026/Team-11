# Account identity and location

HQ issues SME, driver and branch staff credentials through Accounts. New login
IDs are server-generated UUID v4 values. The UUID is also the Supabase Auth user
ID and profile primary key. Existing usernames continue to work. The generated
ID and a server-generated temporary password appear in the one-time handoff; the ID has a copy
button. Account creation still requires an active HQ session and first-login
password changes remain mandatory. Temporary passwords use 18 cryptographically random bytes plus required character classes. They are not accepted from the form or stored in the account profile.

The country selector defaults to Myanmar (+95) and supports all countries in
`libphonenumber-js`. National numbers and full international numbers are
validated and saved in E.164 format. The country selector shows the calling code once; Myanmar entry strips a leading zero, so `09…` becomes `+95 9…`. Selecting a country does not prepend its
code a second time to an already international number.

The creation form omits the generated-ID placeholder. The one-time credentials handoff still shows the actual ID and temporary password.

All portals accept an Account ID or the full name/business name saved by HQ, plus the password. Name matching is exact and case-insensitive within that portal. Duplicate names require the Account ID. IDs take precedence over matching names. Live name resolution runs only on the server using `SUPABASE_SERVICE_ROLE_KEY`; it never exposes a profile-search endpoint or bypasses Supabase password, role or active-status checks. Existing ID sign-in remains available without the provisioning key.

New accounts require a location pin. The account form has no address, latitude,
longitude or password input. Click the Mapbox map, drag the marker, use the
current-location button.
Coordinates are carried internally and validated on the server. The selected pin
is the source of truth; new account address fields stay empty. Existing account
addresses are retained. Account pins are included in the HQ account snapshot.
Location access is requested only after clicking the current-location button.

Delivery quotes can also include a pin. The pin is saved with the quote and is
visible only through the existing order access rules. Authorized delivery staff
can open it in a read-only Mapbox preview. Maps require network access and a
public Mapbox token; see [map setup](maps.md). Coordinate entry is hidden in all
location pickers. Mapbox attribution remains visible. This feature does not implement GPS tracking
or automatic address lookup.

Order primary keys remain UUIDs. New order references are `STT-<full UUID>`;
existing references are preserved. Database primary-key/unique constraints and
the existing operation-key transaction prevent duplicate IDs and duplicate
orders when the same creation request is retried.

Apply `20261021083626_account_locations_order_ids.sql` after the pagination
migrations before using these changes against hosted Supabase. The local demo
applies it automatically.

The local demo retains its account and session maps through Next.js hot reload,
while refreshing the directory methods so removed form fields do not remain
required by an old cached handler.

The desktop account dialog puts the identity/contact fields beside the location
picker. The driver form, including assignment and submit controls, fits at
1280×720; small windows and mobile retain scrolling. The country dropdown is the
only visible dialing-code prefix. Screenshot: `screenshots/account-create-desktop.png`.

Verification for name sign-in: 111 tests across 24 files, TypeScript and the demo
production build passed. Browser sample SME and HQ sign-ins by full name worked;
a read-only hosted SDK lookup verified ID precedence and the HQ exact-name query.
