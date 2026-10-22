# Fresh test database

Apply every migration in `supabase/migrations` to a dedicated test Supabase project. The catalog tier migration sets normal longyi to 45,000 MMK and premium longyi to 80,000 MMK. Then run `supabase/test-seed.sql` manually in that test project. It adds four clearly named TEST branches, 300 pieces of each longyi style at HQ, 60 at each test branch, and three months of synthetic Stock Planning history for every test branch and active longyi SKU. The opt-in test seed requires an empty branch list and allows either no profiles or one active HQ profile.

The history is marked synthetic inside the private planning tables. It supports Stock Planning and its AI explanation workflow; it is not real customer activity, sales, or stock movement history.

Create the portal logins after the test seed using a service role key for the new test project:

```powershell
$env:SEED_TEST_ACCOUNTS = "true"
npm run seed:test-accounts
```

The script refuses the configured SupplyLink project. With no existing profile, it creates 19 accounts: one HQ, three SMEs, four branch staff, three HQ-affiliated drivers, and two drivers for each test branch. If one active HQ profile already exists, it reuses that account without changing its password and creates the other 18 accounts. New test accounts use the test-only password `Longyi-Test-2026!`. Portal IDs and password instructions are written to the Git-ignored `.data/test-accounts-<project-ref>.txt` file. Do not use these accounts or this password for production data.

| Portal         | Login IDs                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HQ             | `hq.test` if none exists; otherwise the existing HQ account ID                                                                                                                 |
| SME            | `sme.test01`, `sme.test02`, `sme.test03`                                                                                                                                       |
| Branch         | `branch.test01`, `branch.test02`, `branch.test03`, `branch.test04`                                                                                                             |
| HQ drivers     | `driver.hq01`, `driver.hq02`, `driver.hq03`                                                                                                                                    |
| Branch drivers | `driver.branch01.01`, `driver.branch01.02`, `driver.branch02.01`, `driver.branch02.02`, `driver.branch03.01`, `driver.branch03.02`, `driver.branch04.01`, `driver.branch04.02` |

The SQL test seed creates database rows only. Supabase Auth users are created by the separate script through the server-only Admin API, so do not expect SQL alone to create working passwords. Production deployments should apply normal migrations and use `npm run bootstrap:hq`; never run this test seed or its account script in production.
