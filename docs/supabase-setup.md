# Connect Supabase

Phase 2 adds the saved ordering and delivery workflow. Local orders and stock use a private PGlite database in `.data/`; demo accounts and sessions remain in server memory. See [the workflow guide](order-workflow.md). A hosted Supabase project is not configured yet.

## 1. Environment

Copy `.env.example` to `.env.local`. Use your own Supabase project's URL and publishable key:

```
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY
```

The service role key is server-only and used for authorised HQ account provisioning and validated private proof uploads.
Do not commit `.env.local`. In production, no missing configuration silently enables demo mode.
To host an intentional demo, explicitly set `NEXT_PUBLIC_DEMO_MODE=true`.

## 2. Database

Apply `supabase/migrations/202610200001_baseline.sql` followed by `202610200002_stt_catalog.sql` then `202610210003_order_workflow.sql` and `202610210004_order_history.sql` in a fresh Supabase SQL editor,
or apply it with your usual Supabase CLI migration workflow. Optional `supabase/seed.sql`
adds sample branches, not user accounts. Branch stock starts empty on hosted Supabase; HQ must enter actual counts. Configure shipping and receiving-account instructions in HQ Settings before creating orders. Disable **Allow new users to sign up**
in Supabase Authentication settings. All SME and Driver provisioning must go through HQ.

Tables have RLS enabled and authenticated users have SELECT grants only. Policy helpers read
the server-managed profile and reject suspended or first-login accounts from operational data.
No user can write their own role or remove the first-login restriction. Password changes clear
that restriction only via an Auth password-hash-change trigger. The payment bucket is private.
Do not add blanket insert/update policies as a shortcut to implement workflow actions.

## 3. Bootstrap headquarters

Create the first Auth user using the Supabase dashboard with a secure temporary password.
Use the synthetic email `your.username@login.supplylink.invalid` (not a deliverable email).
Then insert its profile, replacing the UUID and account ID below:

```sql
insert into public.profiles(id, username, name, role, must_change_password)
values ('AUTH_USER_UUID', 'your.username', 'Your name', 'hq', true);
```

Restart the app. Sign in using `your.username` and that temporary password, then complete the
first-login password change. For production, rebuild after changing public environment values.
From **SMEs & drivers**, HQ can provision real SME/Driver accounts.
SMEs use `/sme/login`; Drivers use `/driver/login`; HQ uses `/hq/login`. Their matching login
API endpoints verify the profile role and account status before accepting the session.
SMEs and Drivers never select a role on sign-in. For the baseline, create branch staff using
the same trusted admin bootstrap path with role `branch` and an existing `branch_id`, then use `/branch/login`.

Supabase Auth must enforce rate limits. Contact HQ for resets; there is no public signup or
email-reset flow because these account IDs do not use deliverable email addresses.

## Implemented connection

- Supabase SSR cookie sessions with proxy refresh and verified user lookup.
- Server-checked active profile/role, first-login guard and portal navigation.
- RLS-scoped reads of orders, branches, products and HQ account directory.
- HQ-only account creation via Auth Admin API, profile insert and audit event.
- Secure first-login password change and sign-out.

## Phase 2 operations

The `workflow_execute` RPC validates ownership, role, first-login state and status, and performs stock/payment/delivery transitions in a transaction. `workflow_snapshot` returns scoped portal data. Private proof images pass server byte validation before the server-only storage upload. Authenticated users have no direct Storage write policies. Driver DTOs exclude payment evidence and monetary values. See [workflow and API](order-workflow.md).

## Remaining implementation slices

1. Hosted Supabase smoke test with real Auth/Storage; schema/RPC/RLS and storage advisor review.
2. Returns/reversals, physical return acceptance, refund accounting, and paginated history/reporting.
3. Opt-in foreground GPS publishing, freshness/retention controls and branch replacement transactions.
4. HQ reset/suspension, session revocation and account creation reconciliation.

No real payment, refund or location collection is performed by the app. Do not use local demo credentials for hosted operations.

Official integration references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Next.js App Router](https://nextjs.org/docs/app/getting-started/installation).
