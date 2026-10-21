# Paginated workspace history

Orders and deliveries, branch retail sales, stock transfers, and report detail rows
load 25 records at a time. Each history has Previous/Next controls and a choice of
25, 50, or 100 rows. Search and order status filters run in PostgreSQL and reset
the order page. Changing report dates or channel resets the report page.

Dashboard counts and sales totals use the whole authorised dataset. They are not
calculated from the current page. The old 10,000-order workspace restriction is
removed. Catalog, locations, and account/driver choices remain reference data;
they are not part of these history pages.

## Fetching and cache

TanStack Query v5 manages the client fetching lifecycle through the authenticated
`GET /api/workflow?query=...` route. Query keys include the viewer ID, role, demo
mode, page, filters, report cutoff, and any open order. The server-rendered first
page seeds the initial query. Previous rows stay visible while the next page is
loading. Superseded reads consume TanStack Query's AbortSignal.

Queries are fresh for 10 seconds. There is no polling timer. Stale queries refresh
on returning to the app or reconnecting. Background reads keep the current rows
and do not disable pagination controls; changing pages shows the pending state. Workflow mutations cancel older
reads, accept the returned snapshot, and invalidate other cached pages. The
workspace owns its QueryClient, clears it on sign-out, and never persists private
records to browser storage. Access-denied responses return the user to sign-in.

See the official [paginated query guide](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)
and [query cancellation guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).

## Reports and CSV

Report pages retain the server's event cutoff. **Refresh report** starts a new
selection and returns to the first page; changing pages retains the selection.
The screen displays that cutoff in Yangon time.

CSV export reads every matching page on the server in bounded batches. Report
totals cover every matching sales event, using the same date/channel filters,
Yangon date boundaries, and cutoff as the screen. Exports are not limited to the
visible page. Order exports respect the ordering SME or HQ permissions; branch
reports include only that branch's retail events. Drivers cannot export finances.
The browser saves a file only after receiving the complete response. A failed
batch or changed result count fails the export instead of silently truncating it.

## Database rollout

Apply `supabase/migrations/20261021060000_workspace_pagination.sql` followed by
`20261021060001_branch_sales_totals.sql` after the branch operations migration
before deploying this app version against hosted Supabase.
The local demo adapter applies it automatically. Existing business records are
preserved. The no-argument `workflow_snapshot()` remains available and now returns
a bounded first page.

The migration adds `workflow_snapshot(p_query jsonb)` and
`workflow_list(p_kind text, p_query jsonb)`. The list function returns `rows`,
`page`, `pageSize`, and `total`, plus report aggregates and cutoff. The snapshot
accepts `ordersPage`, `retailPage`, `transfersPage`, `reportPage`, `pageSize`,
`search`, `status`, `reportFrom`, `reportTo`, `reportChannel`, `reportCutoff`, and
an optional `orderId` for details outside the current page. Authentication,
completed account setup, role, and ownership are checked inside the database.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` cover the change. Database
tests use an isolated in-memory database with 10,026 orders and multiple pages of
retail sales, transfers, and sales events. They exercise stable ordering for tied
timestamps, empty/last pages, filters, full totals and exports, direct order
details, and cross-role/branch isolation. Query tests exercise cache reuse,
previous-page placeholders, cancellation, and mutation invalidation.

For an isolated local browser walkthrough, set `SUPPLYLINK_DEMO_DATA_DIR` to a
dedicated absolute directory inside `.data/` before starting the demo server.
Leaving it unset uses the existing `.data/` database.
