# Supply Link hosted database connection

Connected on 21 October 2026. The Next.js app still runs locally at `http://127.0.0.1:3000`; its Database, Auth and payment-evidence Storage now use hosted Supabase.

Project: **Supply Link** (`mtgqcmfnbubhlcxuhtpu`, Mumbai region). `.env.local` has the verified URL, publishable key, server-only key and `NEXT_PUBLIC_DEMO_MODE=false`. Credentials are not included in this document or committed to Git. Existing local demo records remain in `.data/workflow` and were not imported.

## First HQ sign-in

The owner approved creation of their own `hq.admin` account, named **Supply Link Administrator**, with full HQ access. Its temporary password is in the Git-ignored local file `.data/initial-hq-credentials.txt`. Open that file locally, sign in at `/hq/login`, then choose your own password when prompted. Operational access is blocked until this change succeeds. Delete the local credential file after changing the password.

The bootstrap script refuses to rotate or replace an existing HQ account. It is not a password-reset tool. Do not reuse the sample demo password for hosted accounts.

## First HQ account on a new deployment

For a new production Supabase project, apply the regular migrations only. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in a trusted deployment/admin environment, then run `BOOTSTRAP_HQ=true npm run bootstrap:hq` from the project directory. On Windows PowerShell, use `$env:BOOTSTRAP_HQ = "true"` followed by `npm run bootstrap:hq`. The script only proceeds when `profiles` is empty, creates `hq.admin`, requires a password change at first login, and saves the one-time password to `.data/initial-hq-credentials-<project-ref>.txt`. Keep the service key server-side and remove the credential file after recording the password securely.

Do not run `supabase/test-seed.sql` or `npm run seed:test-accounts` in production. They are only for a separate test project.

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

# Grouped delivery rollout — 22 October 2026

The missing `public.delivery_dispatch_candidates()` RPC on the connected Supply
Link project caused the HQ planner's schema-cache error. With explicit user
approval, applied `20261022110558_grouped_delivery_routes.sql` and aligned its
hosted migration record to the local version. Earlier stock-planning objects were
already present despite gaps in their migration history; those migrations were
not replayed.

Verified the planner under the authenticated HQ role (two drivers, no ready
orders), customer planning denial, and anonymous REST denial. REST recognizes the
new function, so this is no longer `PGRST202`. The existing three orders and five
profiles were retained, with no delivery groups created by verification. Current
orders were one Shipping and two Done. HQ can click **Refresh orders** to clear
the old error; new groups require at least two ready Confirmed/Preparing orders.

Security and performance advisors were checked before and after rollout. The two
private membership tables deliberately have no client grants/policies; the
authenticated RPC entrypoints enforce actor/role checks. These correspond to
the [RLS-without-policy informational notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and [authenticated SECURITY DEFINER review notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
Existing [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and [foreign-key index advisories](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
remain outside this rollout.

## Group acceptance and pickup rollout

Applied `20261022121728_group_acceptance_pickup.sql` after explicit approval on
22 October 2026. It was verified locally with
271 passing tests, a production build and the isolated browser/API flow. This adds
saved acceptance, atomic checked-parcel pickup, and routes that exclude uncollected
stops. Existing collected groups derive acceptance from their first pickup time.
Preflight and readback both found five orders, six profiles and one group.
Digests of orders, delivery attempts and tracking matched before and after;
existing acceptance was backfilled from the earliest recorded pickup. Both group
stops were already handed over, so the authenticated driver read correctly
returned no active groups. Customer read and mutation checks returned permission
denial. Anonymous execute grants and direct client group-table reads remain denied.
No real parcel was accepted, collected or handed over by verification.

The tool-generated migration history record was aligned to the local filename
with an exact version/name guard; no other migration records were changed.
Security advisors report two additional authenticated SECURITY DEFINER entrypoints
for the checked driver RPCs. They have empty search paths, active actor/ownership
checks and anonymous execution revoked; review context is linked in the
[function-execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
RLS and foreign-key index notice counts remain unchanged. This rollout does not
change Realtime publications or require an environment-file update.

## Phased fulfilment rollout

Applied `20261022133817_phased_fulfilment_two_party_completion.sql` to Supply Link
on 22 October 2026 after explicit approval. It supports sequential partial
deliveries, persistent **Order remaining** with separate phase status, and final
completion from driver handover plus SME receipt, without HQ confirmation.
See [phased fulfilment](phased-fulfilment.md) for accounting and verification.

Readback found eight orders, six profiles and six sales. Orders (excluding the
new remaining marker), delivery attempts and inventory matched their preflight
digests. No order qualified for automatic finalization. Verification did not
create a live phase or perform any real pickup, receipt or stock movement.
Authenticated HQ filtering and SME scoped reads succeeded; an SME phase-planning
attempt was denied in a rolled-back transaction. Private ledgers have RLS enabled
and no client grants; private helpers and anonymous RPC execution remain denied.
Only this migration's generated history version was aligned to its local filename,
using an exact version/name guard.

Post-rollout advisors retain 11 authenticated SECURITY DEFINER review notices
and the existing leaked-password protection warning. Two private phase ledgers
add intentional [RLS-without-policy informational notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
access is through checked RPCs, with direct client access revoked. The 36 existing
foreign-key index notices are unchanged. Newly unused phase indexes are retained
for phase lookups and foreign keys. No new exposed function permissions or
Realtime publication changes were introduced.
