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

On 21 October 2026, the hosted database was still at the branch-operations migration while the app at commit `de4b3c4` required pagination, account/location pins and driver pickup/tracking. This caused the workspace load error after successful sign-in: `workflow_snapshot(p_query jsonb)` did not exist. The five pending committed migrations were applied in order, and the PostgREST schema cache was reloaded. No sample business records were imported.

All eleven current migrations are applied. Remote migration-history versions match the repository filenames, so a later CLI deployment can recognize them as applied:

| Version          | Migration                                                                    |
| ---------------- | ---------------------------------------------------------------------------- |
| `202610200001`   | Baseline tables, Auth trigger, RLS and private evidence bucket               |
| `202610200002`   | STT-only footwear catalog                                                    |
| `202610210003`   | Transactional ordering, payment, stock, retail and delivery                  |
| `202610210004`   | Completed driver history and branch stock summary                            |
| `20261021045326` | Branch management, stock transfers, driver affiliation and delivery handoffs |
| `20261021060000` | Paginated workspace histories and reporting aggregates                       |
| `20261021060001` | Branch sales totals independent of history pagination                        |
| `20261021083626` | Account/order location pins and UUID order references                        |
| `20261021092923` | Branch location pins and updated workspace snapshot                          |
| `20261021104603` | Driver pickup confirmation and protected foreground tracking                 |
| `20261021140016` | HQ-only paginated transfer history for branch detail pages                   |

The branch UI was initially available before its hosted migration, causing branch creation to reach the previous order handler and report **Order not found**. Applying the fifth migration resolved that mismatch. [Branch verification](../tests/hosted-branches.sql) confirms authenticated HQ creation, retry safety, six empty stock rows, branch isolation and physical refill receipt. All test fixtures are rolled back.

## Verification

- Auth Admin and publishable-key access verified without printing keys.
- All 21 application tables have RLS enabled. Anonymous workflow and order access is denied; reservation/completion helpers and the private core workflow cannot be executed directly by authenticated clients.
- A real private Storage upload/download succeeded, anonymous upload/download was denied, and the disposable probe was removed.
- [Hosted workflow check](../tests/hosted-workflow.sql) passed after all ten migrations for paginated HQ loading, quote idempotency, SME isolation, private payment metadata, payment/stock reservation, assigned driver privacy, dispatch and pickup replay, synthetic GPS publishing, tracking RLS and location cleanup, handover, two-party completion and one sales event. Every fixture and temporary stock/configuration change was rolled back; existing business records were preserved.
- The actual active `hq.admin` profile, with its password-change requirement already completed, loads the paginated snapshot successfully without bypassing that guard. The six STT variants are present.
- `delivery_tracking` is included in the hosted `supabase_realtime` publication. This confirms database publication setup; a live hosted subscription and real-phone GPS over HTTPS still need a separate walkthrough. SQL verification uses synthetic coordinates only.
- Initial HQ sign-in is checked through the app's cookie login endpoint. Direct workspace access redirects to password change; operational API access is forbidden before setup. The test does not change the owner's password.
- The commit's local verification reported 96 tests, TypeScript and the production build passing. This rollout changed no application source or migration contents; its verification was performed against hosted Supabase.

`npm run check:supabase` checks Auth/Storage with a disposable probe. `node scripts/check-hq-login.mjs` is only for checking the initial temporary login before the owner changes it. `npm run smoke:workflow` remains **local-demo-only** and refuses hosted mode.

## Advisor review

No security ERROR findings were returned after rollout. Eight [authenticated SECURITY DEFINER warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) cover the intended role/branch helpers and public workflow/list/snapshot/tracking RPCs. These check identity, account status, role, ownership and applicable order state with a fixed empty search path. Private operational helpers remain revoked from clients; the private tracking permission helper is granted only for its RLS predicate.

Eight [RLS-without-policy INFO notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional for internal tables with no direct authenticated grants. Access goes through the checked workflow RPCs. Do not add permissive policies to silence these notices.

The latest review also reports [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Enable it in Supabase Auth password settings if supported by the project's plan; the connector cannot change this setting.

Performance review reported [21 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and 12 [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). These are recorded for query-driven optimization as real data grows. The existing primary keys and operational order/branch/time indexes remain in place.

## Branch detail rollout

On 21 October 2026 the additive branch-history migration was applied for the
new HQ `/branches/<branchId>` page. Its hosted migration version matches the local
file. HQ readback returned the existing branch history inside a rolled-back
transaction. The migration adds checked read-only functions; existing business
records were not changed. The security advisor reported the same findings as
before the migration. UI refill verification ran only in the separate local demo.
