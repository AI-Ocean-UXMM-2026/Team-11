# Branch operations

HQ creates each location in **Branches**, then issues a **Branch staff** account for that location in **Accounts & access**. Staff sign in at `/branch/login` using the HQ-issued account ID and temporary password. First sign-in requires a password change. Each branch sees its own stock, retail sales, transfers, affiliated drivers and deliveries; payment evidence and wholesale monetary values are hidden.

Drivers belong to HQ or one open branch. HQ manages affiliation in **Branches**. Resolve a driver's active assignments before moving them. A location can assign only its own active drivers.

## Refill and return stock

New branches start with zero pairs across the six STT variants. HQ reserves a transfer for a chosen variant, quantity and reason. The source location confirms actual dispatch; the destination confirms full physical receipt. Destination stock increases only on receipt. Repeated requests with the same retry key do not add stock twice. HQ can cancel a reserved transfer before dispatch, releasing its allocation. Transfers do not create sales revenue.

For refills the source is HQ and the branch receives. For returns the branch dispatches and HQ receives. Each transfer connects HQ and one branch.

## Hand an order to a branch

HQ requests fulfilment by an open branch for a paid, reserved order. The selected branch accepts only when it can reserve the entire order, or declines with a reason. Acceptance switches fulfilment to that branch. Its staff assign an affiliated driver, prepare and dispatch. Driver handover, SME receipt and HQ completion retain the existing single-sale workflow.

If the original shipment was already dispatched, place the delivery on hold and explicitly reconcile the original consignment as physically returned to HQ or lost before requesting a replacement. Returned goods are restored once; lost goods are not restored. A pending or unresolved replacement blocks normal delivery resumption. Declining or cancelling the request does not silently resume a reconciled shipment.

## Close a location

HQ records a closure reason and confirms closure after stock has returned, deliveries and handoffs are resolved, and transfers are complete or cancelled. Closure preserves history and suspends the location's branch staff and drivers. Reassign drivers before closure if they will continue working elsewhere.

## Verification

`npm test` covers branch credential scope, HQ-only creation, transfer receipt/retry, cross-branch restrictions, original consignment resolution, replacement driver affiliation, single revenue recognition and closure guards. [Hosted branch verification](../tests/hosted-branches.sql) runs against Supabase inside a rolled-back transaction, including real Auth profile IDs without creating permanent users or business records.
