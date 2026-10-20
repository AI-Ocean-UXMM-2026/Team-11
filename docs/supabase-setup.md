# Connect Supabase

This is an application baseline, not the completed PRD. Local demo actions are labelled
and stored in browser session storage. They never write real accounts, payments or locations.

## 1. Environment

Copy `.env.example` to `.env.local`. Use your own Supabase project's URL and publishable key:

```
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_KEY
```

The service role key is server-only and used solely by the authorised HQ provisioning action.
Do not commit `.env.local`. In production, no missing configuration silently enables demo mode.
To host an intentional demo, explicitly set `NEXT_PUBLIC_DEMO_MODE=true`.

## 2. Database

Apply `supabase/migrations/202610200001_baseline.sql` followed by `202610200002_stt_catalog.sql` in a fresh Supabase SQL editor,
or apply it with your usual Supabase CLI migration workflow. Optional `supabase/seed.sql`
adds sample branch and catalog rows, not user accounts. Disable **Allow new users to sign up**
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

## Next implementation slices

1. Transactional quote, immutable order lines, full-payment proof byte validation/versioning,
   actual-transfer verification, atomic inventory reservation and retry-safe state changes.
2. Retail line ledger, returns/adjustments, atomic reserve-aware sales, Done events and reports
   by actual event time in Asia/Yangon. The current live report explicitly labels itself as a
   preview: completion timestamps are respected, but the 100-order window and missing retail
   and return integration do not fulfil historical reporting acceptance.
3. Driver delivery DTO with only necessary receiver fields, assignment, opt-in foreground
   location publishing, freshness/retention controls and branch replacement transactions.
4. HQ reset/suspension with session revocation, creation idempotency, cleanup reconciliation,
   account lifecycle audit hardening and end-to-end access tests against a real Supabase instance.

No live driver data is fetched by this baseline. Drivers must never receive whole order rows
because those include payment amounts. Live inventory quantities are catalog snapshots until
updated through the future transactional inventory ledger. The stock screen reads HQ or the
assigned branch inventory under RLS. No payment upload, GPS, financial transfer or fulfilment
action is simulated as a live success. The app is not ready for live trading.

Official integration references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Next.js App Router](https://nextjs.org/docs/app/getting-started/installation).
