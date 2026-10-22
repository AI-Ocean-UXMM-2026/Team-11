# Three months of planning history

The owner requested synthetic history in the live Supply Link database, with
provenance stored only in the database. This migration adds monthly emergency
wholesale aggregates for each currently active branch and active STT SKU. It
does not add sample labels, branch names, or badges to the UI.

The history supports Stock Planning recommendations and the monthly versions
editor. It does not create operational orders, sales, delivery handoffs, stock
transfers, stock observations, or inventory movements. Existing physical stock,
retail stock, configured targets, creation dates, and reliable observation dates
are preserved. The quantities are synthetic examples, not a trained forecast or
actual historical business performance.

## Apply to hosted Supabase

**The migration has been tested locally, but has not been applied to live
Supabase.** Inspection on 22 October 2026 found the hosted database still at
`20261021140016`, without the Stock Planning schema. Apply these existing
migrations in order before the history migration:

1. `20261022042436_stock_planning.sql`
2. `20261022064710_branch_refill_requests.sql`
3. `20261022071904_branch_stock_pools.sql`
4. `20261022084937_stock_planning_workspace.sql`
5. `20261022090646_stock_planning_function_validation.sql`
6. `20261022104651_stock_planning_three_month_history.sql`

Files are in `supabase/migrations/`. Run through the normal migration deployment
workflow or, when applying SQL manually, run them in this order as the database
owner in the Supply Link SQL editor. No database reset is required. The history
migration fails with a prerequisite message if the planning schema is absent.

The window is the **three complete Asia/Yangon calendar months before first
execution**. Running in October 2026 generates July, August, and September 2026,
with an exclusive end of 1 October. Each branch/SKU gets two synthetic takeover
orders and one refill receipt per month, yielding six orders and three receipts.
Monthly quantities vary reproducibly; refill lead times range from two to four
days. These meet the existing three-month / five-order / one-receipt evidence
gate without lowering it. Actual takeover demand and valid refill receipts are
included alongside these aggregates, with receipt-weighted lead times.

The current hosted branch/SKU count is one branch and six variants, so applying
now would create 18 monthly evidence rows. The SQL selects active records at
execution, so the count can change before deployment. Branches created later
receive no implicit coverage. Rerunning the file is idempotent for existing
pairs and uses the frozen original window, including when run in a later month.
It does not continually invent fresh history. Evidence ages out of the
three-month recommendation window naturally.

The private tables have RLS enabled and no anonymous/authenticated grants. Only
database administrators and the server service role can manage the samples.
Existing checked HQ planning RPCs expose the aggregate results. No client can
read or edit raw provenance, enable a batch, or call the private recommendation
function directly.

## Verify after deployment

Run these read-only checks as the database owner:

```sql
select * from supplylink_private.planning_history_sample_runs;

select branch_id, product_id, count(*) as complete_months,
       sum(takeover_orders) as takeover_orders,
       sum(refill_receipts) as refill_receipts
from supplylink_private.planning_history_samples
group by branch_id, product_id;

select b.name, p.pack,
       supplylink_private.backup_recommendation(b.id, p.id) as recommendation
from public.branches b cross join public.products p
where b.active and p.active and p.brand = 'STT';
```

Refresh Stock Planning to see the recommendation. A previously saved plan is a
snapshot; generate a new draft to use the new inputs. Targets and refills still
require HQ action. Groq explanations separately require a valid server-only
`GROQ_API_KEY` and connectivity to Groq. This migration cannot fix the previously
observed PC-to-Supabase HTTPS connection failure.

## Disable the synthetic evidence

Run as the database owner when actual history is sufficient or testing ends:

```sql
update supplylink_private.planning_history_sample_runs
set enabled = false
where batch_key = 'three_month_backup_history_v1';
```

New calculations immediately return to genuine evidence and its observation
gate. Existing saved drafts, approved targets and explanations retain their
original snapshot; review or regenerate them explicitly. The evidence remains
available for audit in the private tables. The database audit action
`planning.synthetic_history_seeded` records provenance, dates and inserted row
count without adding anything to operational sales or delivery history.
