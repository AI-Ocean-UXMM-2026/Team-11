# Branch operations

HQ creates each location in **Branches**, then issues a **Branch staff** account for that location in **Accounts & access**. Staff sign in at `/branch/login` using the HQ-issued account ID and temporary password. First sign-in requires a password change. Each branch sees its own stock, retail sales, transfers, affiliated drivers and deliveries; payment evidence and wholesale monetary values are hidden.

## Manage one branch

HQ selects **Manage branch** on a network card to open `/branches/<branchId>`.
The dedicated page shows that branch’s information and location, stock by SKU,
assigned drivers and **Stock refillment history**. The network no longer opens
branch details inline. The network shows branch cards and creation controls; stock movement history appears on the individual branch page. Back to branches returns to the network.

**Refill stock** opens a dialog with the destination fixed to the selected branch,
a shoe variant, whole-pair quantity and reason. Available source stock is shown.
Submitting reserves a transfer; HQ confirms dispatch in history, then branch staff
confirm physical receipt in their own portal. Stock increases only on receipt.
The same dialog retains a return-to-HQ option. Edit branch, driver affiliation
and guarded closure remain available from the detail page.

The history endpoint `/api/branches/<branchId>/transfers` uses TanStack Query and
server pagination (25/50/100). It includes only that branch’s refills and returns,
with full branch-specific totals and pending counts. New transfers and updates
invalidate the branch history cache. Authentication, completed password setup and
HQ access are checked in the app and the database. The exposed history RPC uses
an invoker wrapper around a checked function in the non-exposed private schema;
anonymous and non-HQ reads are rejected.

Migration `20261021140016_branch_transfer_history.sql` is applied to hosted Supply
Link and is included in the local demo’s automatic migrations. It adds read-only
history functions and changes no existing stock, accounts or transfer records.

Verification: 129 tests across 28 files, TypeScript and the production build passed.
Database coverage includes 32 branch transfers over multiple pages, unrelated
branches, empty/closed branches, invalid pages and direct RPC access denial.
Browser verification followed Manage branch into the separate page, reserved six
pairs in the isolated demo, and confirmed the refreshed history. An HTTP check
then dispatched and received that refill; branch stock rose from 150 to 156 only
on receipt. Guest and branch-user access to the HQ history endpoint was denied.
Mobile 375×812 had no horizontal document overflow; primary branch actions are
44px tall. Hosted HQ history readback passed in a rolled-back transaction, and
the security-advisor result was unchanged by this migration.

Screenshots: [branch page](screenshots/branch-detail-desktop.png),
[refill dialog](screenshots/branch-refill-dialog.png),
[mobile refill](screenshots/branch-refill-mobile.png). All show local demo data.

## Driver affiliation

Drivers belong to HQ or one open branch. HQ manages affiliation in **Branches**. Resolve a driver's active assignments before moving them. A location can assign only its own active drivers.

HQ branch creation and editing use the same map picker as account creation.
Choose the branch location by tapping the map, dragging the pin or using current
location. There are no address or coordinate inputs. PostgreSQL validates and
stores the pin; authorized branch lists open a read-only Mapbox preview. Configure
the public Mapbox token using the [map setup guide](maps.md).
Existing branch addresses remain visible until HQ saves a pin. Branch creation
still starts with zero inventory and requires HQ authorization.

Apply `20261021092923_branch_location_pins.sql` after the account location migration
before using this UI with hosted Supabase. The local demo applies it automatically.

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
