# Stock Planning

HQ opens **Stock Planning** at `/stock-planning`. The overview keeps the existing application navigation and shows product/SKU and branch filters, a compact HQ alert list, and retail reference, backup availability, target, plan source, status and **Manage** columns. A branch link only filters the overview. A backup plan is mounted as a modal side drawer only after **Manage** (or an alert's refill action) is clicked. Escape closes it and focus returns to the invoking control. On small screens the drawer fills the viewport and the table scrolls within its own region.

## Manual settings and stock pools

The alert's **Create refill** / **Review open refill** flow opens a dedicated backup-refill drawer without the HQ settings form. **Manage** keeps target, threshold and stock-unit editing available in the backup-plan drawer.

HQ can save a target, an alert threshold and a stock-unit label for each branch/SKU immediately. No history or month-end approval is required. Quantities must be whole nonnegative counts up to 1,000,000; the threshold cannot exceed the target. A unit is a 1–24 character alphabetic label: one inventory count equals one unit, and changing the label does not convert quantities. A reason is required for audit. The active source is **Manual** or **AI-assisted**.

Saving these drawer settings never moves physical inventory, releases backup into retail, or takes retail stock into backup. Dedicated backup availability is the unallocated protected reserve. A takeover reservation moves units from that reserve into the existing committed-backup ledger; physical stock leaves at dispatch. Retail availability remains `on hand − all allocations − protected backup`. Retail sales cannot consume protected or committed backup. Existing explicit HQ stock movement workflows remain available separately.

## Recommendations and minimum evidence

The supporting period is the last three complete **Asia/Yangon** calendar months. A branch/SKU recommendation requires all of:

- Three complete months of reliable observation, after branch/product creation and initial stock observation.
- At least five distinct accepted emergency wholesale orders in that period.
- At least one completed, explicitly backup-labelled refill with valid dispatch/receipt times in the same period.

Without this evidence, the drawer shows exactly **“Insufficient history — continue with the HQ manual plan.”** No suggested quantity or confidence is fabricated. Retail demand never substitutes for emergency history.

The estimate is:

`suggested target = ceil(monthly emergency mean + monthly population standard deviation + (emergency units / 90) × average backup refill lead days)`

The three monthly buckets include zero-demand months. Frequency, total units, variation, lead time, completed receipts and the supporting dates are shown as evidence. Each original order is attributed once to its latest accepted branch; cancelled orders and unaccepted requests do not drive this estimate. This conservative attribution can omit prior replacement attempts. Unknown lost demand, returns, seasonal changes, historical stockouts and unrecorded events remain limitations. This is a statistical planning estimate, not a trained forecast or confidence score.

HQ must enter a reason and explicitly **Apply recommended target**. The server recalculates eligibility and the quantity before saving and rejects changed/unsupported suggestions. The alert threshold must still fit the new target. Application changes settings only; it never transfers or deducts stock. Numeric estimates are computed by the database; Groq explains saved facts.

## Alerts and refill calculation

When available backup reaches or falls below its explicitly configured alert threshold, a durable HQ alert opens. One active backup alert per branch/SKU is enforced by a unique index. The same alert updates as balances change and resolves once availability rises above the threshold. Existing on-hand alerts remain separate. Older targets without an explicit alert setting retain their previous notification boundary until HQ saves the new settings.

The overview alert includes branch, SKU, available quantity, threshold, target, unit and a **Create refill** or **Review open refill** action. The existing HQ notification data also includes target and unit. The drawer shows recent backup transfers and explains:

`proposed refill = max(0, target − (physical backup − takeover reservations) − confirmed incoming backup)`

For example, 80 target with 16 available and no incoming needs 64 additional units. Allocated backup is already excluded from availability, so it is never subtracted twice. Only dispatched backup transfers with a confirmed, non-overdue arrival date offset the proposal. Retail transfers and reserved-but-undispatched transfers do not qualify. Open reserved or in-transit backup transfers block a duplicate planning refill, even with a different retry key. Creation locks the branch and recomputes the quantity on the server.

**Create refill** uses the existing HQ stock-transfer workflow and reserves HQ stock. HQ explicitly confirms actual dispatch; the destination still has no new available stock. Only the branch's existing physical-receipt confirmation increases on-hand and dedicated backup availability. The drawer can confirm arrival dates; overdue dates need reconfirming. Planning never automatically dispatches or receives stock.

## Emergency takeover and audit history

Arrange branch fulfilment through **Wholesale orders → open an order → Order management**.
The duplicate **Emergency fulfillment / Record takeover** form has been removed
from Stock Planning. Use the order's phased fulfilment controls to select a branch
and quantities; [phased fulfilment](phased-fulfilment.md) describes partial
branch deliveries and later delivery of outstanding pairs. Stock Planning retains
backup settings, refills and takeover audit history.

History links the original order and records branch, SKU quantity/unit snapshots, reason, original consignment resolution, deadline, requesting user/time, response/cancellation reason and order events. Fulfillment time comes from the recipient's existing confirmed receipt; unconfirmed deliveries are not marked fulfilled. Legacy missing deadlines are labelled **Not recorded**. The drawer shows recent requests/transfers; complete records remain in the existing database audit tables.

Pending requests can be cancelled with a reason inside the drawer. **Manage original wholesale order** opens the existing order modal within the same Stock Planning tab for accepted-order cancellation, holds and reconciliation. A cancellation before dispatch restores committed backup once; a cancellation after dispatch does not manufacture a stock return. Idempotency keys, order/inventory locks and existing stage guards prevent duplicate reservations, deductions and fulfillment.

## Advanced monthly versions

Monthly versioned plans and saved Groq explanations remain inside an optional advanced section of the drawer. Recommendations obey the same three-month/five-order/one-refill evidence gate; HQ can add an explicit safety buffer. Manual overrides remain possible with reasons. Saved versions are immutable and approval still rechecks stock and inputs under locks. Approved explicit retail movements remain separate from the drawer's settings-only action. Monthly drafts never move stock by themselves.

## Groq explanations

Set these server-only values in `.env.local` or the deployment environment:

```dotenv
GROQ_API_KEY=your-groq-key
GROQ_MODEL=openai/gpt-oss-20b
```

Groq is the only explanation provider. Requests go directly to `https://api.groq.com/openai/v1/chat/completions`. The default model is `openai/gpt-oss-20b`; `openai/gpt-oss-120b` is also supported. These models support strict JSON schema output. The request uses low reasoning effort and a 1,600-token completion cap. The server validates summary/cautions and rejects malformed output before storage. No tools or model substitution are enabled.

Use a Groq **Free Plan** organization to stay within its free allowance. Groq account limits and billing apply. Check the account's Limits and billing settings for its actual tier. No subscription or billing setting is changed by this integration.

Hosted explanation persistence also uses the existing server-only `SUPABASE_SERVICE_ROLE_KEY`. Keys never enter browser bundles or database plan snapshots. No new npm dependency is required.

On generation, the service requests one explanation per branch-plan version. Reopening a plan reuses its stored explanation. HQ can explicitly regenerate, with a one-minute cooldown and a database-wide ceiling of 50 generation attempts per UTC day. In-flight claims are serialized; an interrupted generation can be retried after the cooldown. Groq quotas may also include unrelated requests on the same organization.

A saved failed explanation can return HTTP 200 from `/api/stock-planning`: this acknowledges saving the plan's explanation status, not a successful model response. Check `result.explanation.status` (`ready` or `failed`). The page explicitly marks failures as **Explanation unavailable** and offers **Retry explanation** after the one-minute cooldown. Groq rate limits, rejected keys, account credit limits and access denials have distinct safe messages. Raw upstream errors never enter saved explanations. Provider failures, timeouts and malformed output preserve calculation, review and approval.

The model receives only aggregated SKU labels (`SKU-1`, etc.), quantities, buffer, thresholds, observation coverage, stockout days and refill lead-time statistics. Labels follow saved table order. It receives no business/branch/customer identifiers, addresses, contact details, free-text reasons, payment evidence, sales values or GPS. Aggregates pass directly to Groq, whose data policies apply. The model returns validated summary/cautions only; it cannot call tools or change numerical rows or inventory. Provider, model identity and generation time are stored alongside new explanations. Only the trusted server can store an explanation as model-generated.

If the key is absent, the page explicitly shows **AI setup needed**. Manual planning remains usable.

## Deployment and verification

The local demo prepares historical planning fixtures on the first Stock Planning request. Every active branch/SKU receives six completed emergency orders and three received backup refills across the previous three complete Yangon months. Its dated observation and creation timeline is extended for that local dataset, with original dates retained in an internal `local.planning_history` audit entry. Current inventory balances, manual targets, thresholds and existing order records are preserved. Stable IDs and a period/catalog marker prevent duplicates on repeat visits. This seed runs only through the local PGlite adapter; hosted Supabase requests never run it. It needs no additional SQL migration and adds no fixture labels to the interface.

Apply the existing planning/stock-pool migrations, followed by `20261022084937_stock_planning_workspace.sql` and `20261022090646_stock_planning_function_validation.sql`, then reload the PostgREST schema cache. The workspace migrations add per-SKU settings, private RLS-protected takeover metadata, HQ-only RPC actions and validated routine updates. It does not rewrite existing orders, sale events or inventory balances. It starts honest observation coverage at installation time.

The local PGlite demo applies the new migration automatically, including when an existing local database survives hot reload. Use an isolated demo directory for synthetic walkthroughs; never backdate live observation coverage to unlock a recommendation. Hosted rollout requires the migration and configured keys. It is separate from local/mocked verification.

On October 22, 2026, a Groq strict-schema request succeeded in about 1.5 seconds. A request through the local app generated and persisted a `ready` explanation for an existing branch plan using `openai/gpt-oss-20b`. Cache replay returned the same saved generation timestamp, and the browser displayed the saved summary, cautions and model. The hosted migration has not been applied.

Run `npm test -- --maxWorkers=2`, `npm run typecheck` and `npm run build`. Database tests cover carryover, incoming deductions, manual targets, protected stock, approval replay, stale inputs, cross-role denial, three-month coverage, unique-order attribution and explanation claims. API/provider tests cover origin/input checks, Groq configuration, aggregate-only payloads and invalid/unavailable model responses. Local database tests use PGlite with Auth schema stubs; Supabase advisors additionally require a running local Supabase stack or the deployed project.

Official references: [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b).

The revised workspace was verified with database tests for manual settings without history, inclusive threshold alert deduplication/recovery, backend recommendation eligibility, exact refill calculations, receipt-only availability, backup-only reservation/dispatch, cancellation restoration and already-dispatched HQ consignment reconciliation. UI checks cover Manage-only mounting, Escape/focus restoration, filters, manual validation and explicit recommendation application. The full regression suite passed (234 tests), followed by the added dispatched-consignment and linked-original-order tests. TypeScript checks and the optimized production build also passed. Desktop and 375px mobile layouts were inspected. The official local Supabase security advisor could not connect because the Docker Supabase database on port 54322 was not running; PGlite database checks passed. Hosted migrations have not been applied.
