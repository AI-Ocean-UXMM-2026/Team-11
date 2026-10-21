// Synthetic, local-demo-only integration check. Leaves labelled example records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.SUPPLYLINK_DEMO_URL??"http://127.0.0.1:3000";
assert.ok(new URL(base).hostname==='127.0.0.1'&&new URL(base).protocol==='http:','Use the local demo only.');
const branchMode=process.env.SUPPLYLINK_BRANCH_SMOKE==='true';
const cookies = {};
async function login(role, username, cookieKey=role) {
  const response = await fetch(`${base}/api/auth/${role}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username, password: "SttDemo-2026!" }),
  });
  assert.equal(response.status, 200, `Sign in ${role}`);
  cookies[cookieKey] = response.headers.get("set-cookie").split(";")[0];
}
async function request(role, url, options = {}) {
  const response = await fetch(base + url, {
    ...options,
    headers: { Cookie: cookies[role], Origin: base, ...options.headers },
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.ok(!result.error, result.error);
  return result;
}
async function act(role, action, payload, key = randomUUID()) {
  return request(role, "/api/workflow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload, key }),
  });
}
await login("sme", "myathida");
await login("hq", "hq.admin");
await login("driver", "zawmin");
await login("branch", "branch.hlaing");
const initial = await request("hq", "/api/workflow");
assert.equal(
  initial.demo,
  true,
  "Only run this check against explicit local demo mode.",
);
const product = initial.data.products.find(
  (p) => p.color === "White" && p.size === "38",
);
const driver = initial.data.accounts.find((a) => a.username === "zawmin");
const targetBranch=initial.data.branches.find(b=>b.name==='Hlaing branch');
const branchDriver=initial.data.accounts.find(a=>a.username==='aungthu');
if(branchMode){
  await act('hq','driver_affiliation',{driverId:branchDriver.id,branchId:targetBranch.id,reason:'Demo branch verification'});
  await login('driver','aungthu','branchdriver');
  const transfer=await act('hq','transfer_create',{productId:product.id,quantity:2,sourceBranchId:'',destinationBranchId:targetBranch.id,reason:'Demo branch refill'});
  await act('hq','transfer_dispatch',{transferId:transfer.result.transferId,confirmed:true});
  await act('branch','transfer_receive',{transferId:transfer.result.transferId,confirmed:true});
}
const created = await act("sme", "create", {
  items: [{ productId: product.id, quantity: 2 }],
  receiver: "Demo QA Receiver",
  phone: "09000000000",
  address: "Demo QA, Hlaing, Yangon",
  area: "Yangon",
  expectedTotal: product.price * 2 + initial.data.settings.shipping,
});
const orderId = created.result.orderId;
const order = created.data.orders.find((o) => o.id === orderId);
const image = await sharp({
  create: { width: 480, height: 180, channels: 3, background: "#f2f7f1" },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="480" height="180"><text x="24" y="60" font-size="24">DEMO QA PAYMENT PROOF</text><text x="24" y="105" font-size="16">Synthetic image. No money was transferred.</text></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const form = new FormData();
form.set("file", new Blob([image], { type: "image/png" }), "demo-proof.png");
form.set("operationKey", randomUUID());
form.set("amount", String(order.merchandise + order.shipping));
form.set("reference", `DEMO-QA-${Date.now()}`);
const uploaded = await request("sme", `/api/orders/${orderId}/evidence`, {
  method: "POST",
  body: form,
});
const evidence = uploaded.data.orders.find((o) => o.id === orderId).workflow
  .evidence[0];
const privateResponse = await fetch(
  `${base}/api/orders/${orderId}/evidence/${evidence.id}`,
  { headers: { Cookie: cookies.hq } },
);
assert.equal(privateResponse.status, 200);
assert.equal(privateResponse.headers.get("content-type"), "image/png");
const anon = await fetch(
  `${base}/api/orders/${orderId}/evidence/${evidence.id}`,
);
assert.equal(anon.status, 401);
const driverProof = await fetch(
  `${base}/api/orders/${orderId}/evidence/${evidence.id}`,
  { headers: { Cookie: cookies.driver } },
);
assert.equal(driverProof.status, 403);
await act("hq", "review_payment", {
  orderId,
  evidenceId: evidence.id,
  decision: "approve",
  verifiedAmount: order.merchandise + order.shipping,
  bankChecked: true,
});
await act("hq", "assign", { orderId, driverId: driver.id });
await act("hq", "prepare", { orderId });
const dispatchKey = randomUUID();
await act("hq", "dispatch", { orderId }, dispatchKey);
await act("hq", "dispatch", { orderId }, dispatchKey);
const jobs = await request("driver", "/api/workflow");
const job = jobs.data.orders.find((o) => o.id === orderId);
assert.ok(job);
assert.equal(job.merchandise, 0);
assert.equal(job.workflow.evidence.length, 0);
if(branchMode){
  await act('hq','hold',{orderId,reason:'Demo HQ vehicle problem'});
  const routed=await act('hq','route_branch',{orderId,branchId:targetBranch.id,reason:'Demo backup after original goods returned',originalResolution:'returned_to_hq',consignmentResolved:true,receivedBack:true});
  const handoff=routed.data.orders.find(o=>o.id===orderId).workflow.handoffs[0];
  if(process.env.SUPPLYLINK_BRANCH_PAUSE==='true'){console.log(`READY ${order.reference}: awaiting Hlaing branch acceptance. Refill and original-consignment resolution verified.`);process.exit(0);}
  await act('branch','handoff_accept',{orderId,handoffId:handoff.id});
  await act('branch','assign',{orderId,driverId:branchDriver.id});
  await act('branch','prepare',{orderId});await act('branch','dispatch',{orderId});
  await act('branchdriver','handover',{orderId});
}else await act("driver", "handover", { orderId });
await act("sme", "receive", { orderId, fullReceipt: true });
const before = await request("hq", "/api/workflow");
assert.ok(!before.data.salesEvents.some((e) => e.orderId === orderId));
const final = await act("hq", "complete", { orderId });
assert.equal(final.data.orders.find((o) => o.id === orderId).status, "Done");
assert.equal(
  final.data.salesEvents.filter((e) => e.orderId === orderId).length,
  1,
);
console.log(
  `PASS ${order.reference}: quote → private proof → verify/reserve → assign → dispatch (retry safe) → handover → SME receipt → HQ completion → one sale`,
);
console.log(
  "PASS anonymous and driver proof access denied; driver monetary data withheld"+(branchMode?"; branch refill, backup and affiliated driver verified":""),
);
