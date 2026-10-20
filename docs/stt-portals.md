# STT supplier and portal endpoints

The supplier now carries **one example product: the STT Everyday sneaker**. White and black,
EU sizes 38, 39 and 40, are six stock variants of that same model. Counts and prices use pairs.
STT and the shoe illustration are example product content, not an official brand integration.

## Sign-in pages and workspaces

| Role   | Sign-in page    | Workspace                                                                |
| ------ | --------------- | ------------------------------------------------------------------------ |
| SME    | `/sme/login`    | `/sme`, `/sme/catalog`, `/sme/orders`, `/sme/locations`, `/sme/settings` |
| Driver | `/driver/login` | `/driver`, `/driver/deliveries`, `/driver/settings`                      |
| HQ     | `/hq/login`     | `/`, `/accounts`, `/inventory`, `/orders`, `/reports`                    |
| Branch | `/branch/login` | `/`, `/sales`, `/inventory`, `/reports`                                  |

`/login` is the portal chooser. Only HQ can create SME and Driver accounts. There is no public
signup page or endpoint. Roles come from authenticated profiles, never from a login payload.
Direct access to the wrong portal redirects to the authenticated user's own workspace.

## Login API

`POST /api/auth/sme/login`, `POST /api/auth/driver/login`, `POST /api/auth/hq/login`
and `POST /api/auth/branch/login` accept JSON:

```json
{ "username": "hq-issued-account-id", "password": "hq-issued-password" }
```

Success returns HTTP 200 with `{ "redirectTo": "/sme" }` (or the appropriate portal).
First-login accounts receive `/change-password?portal=sme` or the corresponding role.
Cookies are HTTP-only; responses have `Cache-Control: no-store`. Error responses contain an
`error` string: 400 invalid input/JSON, 401 invalid credentials, 403 wrong role/inactive live
account or foreign request origin, 413 oversized payload, 415 wrong content type, 429 demo
rate limit, 503 unavailable configuration/service. Supabase also applies its configured Auth limits.

The pages consume these same endpoints. HQ provisioning and password changes use authenticated
Next.js Server Actions, not public signup APIs. Supabase sessions and Postgres RLS govern live mode.

## Try the HQ credential handoff locally

With demo mode enabled, use the public example password **`SttDemo-2026!`**:

| Portal | Example account ID |
| ------ | ------------------ |
| HQ     | `hq.admin`         |
| SME    | `myathida`         |
| Driver | `zawmin`           |
| Branch | `branch.hlaing`    |

1. Sign into `/hq/login`, then open **SMEs & drivers → Create account**.
2. Enter the role, account ID, contact/location and a temporary password of at least 12 characters.
3. Hand the displayed portal URL, account ID and temporary password to that intended user.
   The handoff is shown once; readable passwords are not saved in the account directory or session storage.
4. Sign into `/sme/login` or `/driver/login` using those credentials.
5. Change the temporary password before entering the workspace. The role cannot be changed at login.

The demo adapter keeps salted password hashes and opaque sessions **in server memory**. It is
only a local demonstration adapter and resets when the server restarts. Supabase remains the
live database and authentication provider. HQ's anonymous demo overview is read-only for account
provisioning: actual credential creation requires an HQ demo login. Existing sample users are
pre-activated for easy preview; newly provisioned users must change their password.

## Existing Supabase projects

Apply `supabase/migrations/202610200002_stt_catalog.sql` after migration 001. It adds brand,
size and color, installs the six STT variants and deactivates the original grocery sample SKUs.
Historical rows and order references are preserved. New projects apply both migrations before
the optional branch seed. The authenticated catalog policy restricts SMEs and branch staff to
active STT rows; the application also filters its catalog by brand.

Configure real Supabase credentials using `docs/supabase-setup.md`. Demo users are never created
in your hosted database. Live credentials are issued through Supabase Auth Admin by authorised HQ.

Driver assignment/GPS, payment evidence and operational mutations remain the baseline's next
implementation slices. This change adds portal authentication and the footwear catalog, not those flows.
