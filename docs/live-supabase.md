# Supply Link hosted database connection

Connected on 21 October 2026. The Next.js app still runs locally at `http://127.0.0.1:3000`; its Database, Auth and payment-evidence Storage now use hosted Supabase.

Project: **Supply Link** (`mtgqcmfnbubhlcxuhtpu`, Mumbai region). `.env.local` has the verified URL, publishable key, server-only key and `NEXT_PUBLIC_DEMO_MODE=false`. Credentials are not included in this document or committed to Git. Existing local demo records remain in `.data/workflow` and were not imported.

## First HQ sign-in

The owner approved creation of their own `hq.admin` account, named **Supply Link Administrator**, with full HQ access. Its temporary password is in the Git-ignored local file `.data/initial-hq-credentials.txt`. Open that file locally, sign in at `/hq/login`, then choose your own password when prompted. Operational access is blocked until this change succeeds. Delete the local credential file after changing the password.

The bootstrap script refuses to rotate or replace an existing HQ account. It is not a password-reset tool. Do not reuse the sample demo password for hosted accounts.

## Finish business configuration

1. In the Supabase dashboard, open **Authentication → Sign In / Providers** and disable **Allow new users to sign up**. This setting was still enabled during verification. The available connector cannot change Auth configuration, and the in-app dashboard browser is not signed in. The application has no public signup UI; an Auth identity without an active HQ-issued profile cannot access operational data.
2. After the first password change, enter the actual receiving-account instructions and Yangon shipping fee in HQ **Settings**. No bank details or shipping fee were invented during setup; these remain unset, and quoting stays blocked until HQ configures them.
3. Review wholesale prices and enter physical STT stock counts in **Shoes & stock**. All hosted opening stock was initialized to zero. The six STT variants and example wholesale prices came from the catalog migration. No sample branches, orders, payments or sales were imported.
4. Create real locations in HQ **Branches**. In **Accounts & access**, issue SME, Driver or Branch staff credentials. Branch staff must be linked to an open location; drivers belong to HQ or one branch. Branch staff sign in at `/branch/login` and change their temporary password before using their portal.

[Open the Supply Link dashboard](https://supabase.com/dashboard/project/mtgqcmfnbubhlcxuhtpu).

## Database deployment

The pagination update adds `20261021060000_workspace_pagination.sql` and `20261021060001_branch_sales_totals.sql`. The account/location update additionally requires `20261021083626_account_locations_order_ids.sql`. Branch map pickers additionally require `20261021092923_branch_location_pins.sql`. Apply all four before running this app version in hosted mode; these hosted deployments have not been verified here. The local demo applies them automatically. See [pagination and rollout](pagination.md).

All five migrations are applied. Remote migration-history versions match the repository filenames, so a later CLI deployment can recognize them as applied:

| Version          | Migration                                                                    |
| ---------------- | ---------------------------------------------------------------------------- |
| `202610200001`   | Baseline tables, Auth trigger, RLS and private evidence bucket               |
| `202610200002`   | STT-only footwear catalog                                                    |
| `202610210003`   | Transactional ordering, payment, stock, retail and delivery                  |
| `202610210004`   | Completed driver history and branch stock summary                            |
| `20261021045326` | Branch management, stock transfers, driver affiliation and delivery handoffs |

The branch UI was initially available before its hosted migration, causing branch creation to reach the previous order handler and report **Order not found**. Applying the fifth migration resolved that mismatch. [Branch verification](../tests/hosted-branches.sql) confirms authenticated HQ creation, retry safety, six empty stock rows, branch isolation and physical refill receipt. All test fixtures are rolled back.

## Verification

- Auth Admin and publishable-key access verified without printing keys.
- All 20 application tables have RLS enabled. Anonymous workflow and order access is denied; reservation/completion helpers and the private core workflow cannot be executed directly by authenticated clients.
- A real private Storage upload/download succeeded, anonymous upload/download was denied, and the disposable probe was removed.
- [Hosted workflow check](../tests/hosted-workflow.sql) passed for quote idempotency, SME isolation, private payment metadata, full payment/stock reservation, assigned driver privacy, dispatch replay, handover, two-party completion and one sales event. All fixtures were rolled back. It left zero orders, sales and payment records.
- Initial HQ sign-in is checked through the app's cookie login endpoint. Direct workspace access redirects to password change; operational API access is forbidden before setup. The test does not change the owner's password.
- 52 automated tests, TypeScript and the production build pass after the branch update. The hosted core ordering regression also passes after the new workflow wrapper is installed.

`npm run check:supabase` checks Auth/Storage with a disposable probe. `node scripts/check-hq-login.mjs` is only for checking the initial temporary login before the owner changes it. `npm run smoke:workflow` remains **local-demo-only** and refuses hosted mode.

## Advisor review

No security ERROR findings were returned. Four [authenticated SECURITY DEFINER warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) are intentional: role/branch helpers return the caller's own active profile context, and the two public workflow RPCs perform explicit identity, status, role, ownership and order-state checks with a fixed empty search path. Internal reservation/completion helpers are revoked from clients.

Eight [RLS-without-policy INFO notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional for internal tables with no direct authenticated grants. Access goes through the checked workflow RPCs. Do not add permissive policies to silence these notices.

The latest review also reports [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Enable it in Supabase Auth password settings if supported by the project's plan; the connector cannot change this setting.

Performance review reported [18 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) in this newly empty workspace. These are recorded for query-driven optimization as real data grows. The existing primary keys and operational order/branch/time indexes remain in place.
