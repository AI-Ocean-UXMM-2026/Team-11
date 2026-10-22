# Phased fulfilment and two-party completion

An order keeps its original reference, sizes/colours, quoted prices, full payment
and total. HQ may plan sequential deliveries for a paid, reserved HQ order. A
branch reserves only the selected phase from its wholesale backup pool; retail
stock is separate. Undelivered quantities stay allocated at HQ. There is one open
phase per order, so later deliveries cannot duplicate an in-flight consignment.

For 60 ordered pairs and 40 available at a branch:

1. HQ chooses that branch and 40 pairs. The branch accepts and reserves those 40.
2. Its driver is assigned, the phase is prepared/dispatched, then pickup starts GPS.
3. Driver handover and SME receipt independently confirm phase 1. HQ performs no
   completion confirmation. Either party can confirm first; both are required.
4. The order shows **Order remaining**, **Received: 40 of 60 pairs**, and
   **Remaining: 20 pairs**. HQ plans phase 2 from HQ or another suitable branch.
5. While phase 2 is requested, prepared, dispatched or held, the overall status
   stays **Order remaining**. The phase's delivery status appears separately.
6. After all sizes/colours have both driver handover and SME receipt, the order
   becomes **Done** and posts exactly one wholesale sale for the original total.

The internal order status continues to drive the current delivery and GPS checks.
`orders.remaining_at` persists the overall remaining state. The checked list RPC
projects **Order remaining** consistently and filters it in SQL before pagination.
It does not add that display state to the underlying delivery-status enum.

## Controls and accounting

- HQ uses **Arrange fulfilment in phases** in order details. Quantities default
  to the lesser of the outstanding variant quantity and the selected branch's
  available wholesale backup stock. HQ quantities use the remaining reservation.
- Branch staff accept only their own requested phase. Acceptance rechecks stock
  under inventory locks; competing requests cannot overdraw the pool.
- Staff prepare, assign an affiliated driver and dispatch the current phase.
  Dispatch consumes only its quantities, once, with an immutable phase movement.
- Driver and branch parcel lists show the current phase's quantities. SME/HQ
  retain the full order plus current-phase details and receipt/history progress.
- SME receipt is bound to the exact phase ID, preventing a stale receipt screen
  from confirming a later delivery. Retry keys replay the original outcome.
- Group acceptance/pickup and GPS fan-out work for phased parcels; group cards
  show phase quantities, not full parent-order quantities. Per-stop handover stays
  separate. GPS never records physical receipt or completes an order.
- An undispatched phase can be cancelled with a reason. Branch allocations return
  to its backup pool and HQ's original outstanding allocation is restored. A
  dispatched phase must be handed over/received or resolved as an issue. The
  existing whole-consignment replacement flow cannot replace a partial order.
- Whole-order cancellation after entering phase mode is blocked; delivered pairs
  cannot be silently cancelled. Returns/refunds require a separate reconciliation
  workflow. No refund or new shipping charge is inferred by this feature.
- Planning demand and takeover history use actual phase quantities and source
  branches, avoiding counting all 60 pairs against the branch that supplied 40.

Single-delivery orders also finish automatically after driver handover and SME
receipt, without HQ approval. The old `complete` action is a compatibility no-op;
it cannot complete an order or create a sale. The HQ button and waiting messages
have been removed. Existing HQ completion timestamps remain historical records.

## Migration and access

`20261022133817_phased_fulfilment_two_party_completion.sql` adds private phase and
line ledgers with RLS and no direct client grants, checked workflow actions,
phase projections, planning projections and the two-party completion rule.
Existing orders already carrying both confirmations and no open issue are
finalized once during rollout; unfinished deliveries are not marked received.

Actions use the existing authenticated, same-origin workflow endpoint:
`phase_request` with `orderId`, optional `branchId`, positive per-SKU `lines` and
`reason`; `phase_cancel` with `orderId`, `phaseId` and `reason`. Existing branch
accept/decline and delivery actions act on the current phase. Receipt and driver
handover include its `phaseId`. Actor, source, assignment, quantity, stock and
retry checks run inside database transactions.

Applied to hosted Supply Link on 22 October 2026 after explicit approval. Readback
confirmed the phase ledgers, restricted grants, authenticated list filtering and
SME mutation denial. Existing orders, attempts and inventory digests matched
preflight; eight orders, six profiles and six sales remained. No existing order
qualified for automatic finalization. The migration history record matches the
local filename. The local demo applies it automatically; no environment changes
are required.

Verification: 280 tests in 55 files, typecheck and production build passed. An
isolated production demo exercised 60 pairs as 40 from a branch then 20 from HQ,
including branch acceptance, driver pickup/handover, SME receipt, stable overall
status during phase 2 and exactly one final sale. The SME's final-phase receipt
was also submitted through the browser. GPS publishing on a real phone was not
part of this verification.

Screenshots: [phase 1 remaining](screenshots/phase-1-order-remaining.png),
[phase 2 shipping](screenshots/phase-2-shipping-order-remaining.png) and
[completed order](screenshots/phase-order-done.png).
