import { demoPaymentInstructions } from "../payment-instructions";
import type { Transaction } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Called only by the local adapter, after demo profiles exist. Populate a fresh
// demo once; never overwrite a user's existing demo history or hosted records.
export async function seedDemoShowcase(tx: Transaction, root: string) {
  const marker = "demo_showcase_checkout_v1";
  if (
    (
      await tx.query("select 1 from public.workflow_migrations where name=$1", [
        marker,
      ])
    ).rows.length
  )
    return;
  const existing = await tx.query("select 1 from public.orders limit 1");
  if (existing.rows.length) {
    await tx.query("insert into public.workflow_migrations values($1)", [
      marker,
    ]);
    return;
  }
  const profiles = (
    await tx.query<{ id: string; username: string }>(
      "select id,username from public.profiles",
    )
  ).rows;
  const id = (username: string) => {
    const user = profiles.find((p) => p.username === username);
    if (!user) throw new Error("Demo showcase requires its sample accounts.");
    return user.id;
  };
  async function run(
    username: string,
    action: string,
    payload: Record<string, unknown>,
  ) {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id(username),
    ]);
    return (
      await tx.query<{
        result: {
          orderId: string;
          intentId: string;
          path: string;
          transferId: string;
        };
      }>("select public.workflow_execute($1,$2::jsonb,$3::uuid) result", [
        action,
        JSON.stringify(payload),
        randomUUID(),
      ])
    ).rows[0].result;
  }
  const products = (
    await tx.query<{ id: string; wholesale_price: number }>(
      "select id,wholesale_price from public.products where brand='STT' and active order by color,size",
    )
  ).rows;
  await tx.exec(
    "update public.inventory set on_hand=240 where branch_id is null",
  );
  await tx.exec(
    "update public.branches set latitude=case name when 'Hlaing branch' then 16.85 when 'Kamayut branch' then 16.827 else 16.807 end,longitude=96.133",
  );
  const branch = (
    await tx.query<{ id: string }>(
      "select id from public.branches where name='Hlaing branch' and active",
    )
  ).rows[0].id;
  await run("hq.admin", "driver_affiliation", {
    driverId: id("aungthu"),
    branchId: branch,
    reason: "Demo: Hlaing branch delivery driver.",
  });
  await run("hq.admin", "configure", {
    shipping: 5000,
    instructions: demoPaymentInstructions,
  });
  const { default: sharp } = await import("sharp");
  const receipt = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#f0f5ee"/><text x="40" y="80" font-family="sans-serif" font-size="29" fill="#17493d">SupplyLink demonstration receipt</text><text x="40" y="145" font-family="sans-serif" font-size="22">SAMPLE — NO MONEY TRANSFERRED</text><text x="40" y="205" font-family="sans-serif" font-size="18">For testing evidence upload and HQ review only.</text><text x="40" y="290" font-family="sans-serif" font-size="16">Reference: DEMO-CHECKOUT</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  const sampleFolder = path.join(root, "samples");
  await mkdir(sampleFolder, { recursive: true });
  await writeFile(path.join(sampleFolder, "demo-receipt.png"), receipt);
  const stages = [
    "Draft",
    "Awaiting verification",
    "Awaiting verification",
    "Confirmed",
    "Preparing",
    "Shipping",
    "Delivery hold",
    "Branch handoff",
    "Done",
    "Done",
  ];
  for (const [i, stage] of stages.entries()) {
    const buyer = i % 3 === 0 ? "shwepyi" : "myathida";
    const p = products[i % products.length],
      quantity = i % 2 ? 4 : 2;
    const amount = Number(p.wholesale_price) * quantity + 5000;
    const created = await run(buyer, "create", {
      items: [{ productId: p.id, quantity }],
      receiver: "Demo shop receiver",
      phone: "+959123456789",
      address: `${30 + i} Demo Market Street, Hlaing, Yangon`,
      pin: { latitude: 16.84 + i / 1000, longitude: 96.15 },
      notes: "Demonstration order. No real payment or delivery.",
      area: "Yangon",
      expectedTotal: amount,
    });
    const orderId = created.orderId;
    await tx.query(
      "update public.orders set created_at=now()-($2::integer * interval '2 hours') where id=$1",
      [orderId, i + 1],
    );
    if (stage === "Draft") continue;
    const intent = await run(buyer, "proof_intent", {
      orderId,
      digest: createHash("sha256").update(receipt).digest("hex"),
    });
    const folder = path.join(root, "payment-evidence", orderId);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${intent.intentId}.png`), receipt);
    await tx.query(
      "insert into storage.objects(bucket_id,name) values('payment-evidence',$1)",
      [intent.path],
    );
    await run(buyer, "submit_evidence", {
      orderId,
      intentId: intent.intentId,
      amount,
      reference: `DEMO-RECEIPT-${i + 1}`,
    });
    if (stage === "Awaiting verification") continue;
    const evidence = (
      await tx.query<{ id: string }>(
        "select id from public.payment_evidence where order_id=$1 order by version desc limit 1",
        [orderId],
      )
    ).rows[0];
    await run("hq.admin", "review_payment", {
      orderId,
      evidenceId: evidence.id,
      decision: "approve",
      verifiedAmount: amount,
      bankChecked: true,
    });
    if (stage === "Confirmed") continue;
    await run("hq.admin", "assign", { orderId, driverId: id("zawmin") });
    await run("hq.admin", "prepare", { orderId });
    if (stage === "Preparing") continue;
    if (stage === "Branch handoff") {
      await run("hq.admin", "hold", {
        orderId,
        reason:
          "Demo: HQ route capacity reached. Hlaing branch can fulfil this delivery.",
      });
      await run("hq.admin", "route_branch", {
        orderId,
        branchId: branch,
        reason: "Demo: request local branch fulfilment before dispatch.",
      });
      continue;
    }
    await run("hq.admin", "dispatch", { orderId });
    await run("zawmin", "pickup", { orderId });
    if (stage === "Shipping") continue;
    if (stage === "Delivery hold") {
      await run("zawmin", "hold", {
        orderId,
        reason:
          "Demo: shop closed on arrival. Contact receiver to arrange a new delivery time.",
      });
      continue;
    }
    await run("zawmin", "handover", { orderId });
    await run(buyer, "receive", { orderId, fullReceipt: true });
    await run("hq.admin", "complete", { orderId });
  }
  for (const p of products.slice(0, 3))
    await run("branch.hlaing", "retail", {
      items: [{ productId: p.id, quantity: 2, price: 55000 }],
    });
  for (const [i, p] of products.slice(0, 3).entries()) {
    const transfer = await run("hq.admin", "transfer_create", {
      sourceBranchId: "",
      destinationBranchId: branch,
      productId: p.id,
      quantity: 12,
      reason: "Demo: branch restock for the next trading day.",
    });
    if (i > 0)
      await run("hq.admin", "transfer_dispatch", {
        transferId: transfer.transferId,
        confirmed: true,
      });
    if (i > 1)
      await run("branch.hlaing", "transfer_receive", {
        transferId: transfer.transferId,
        confirmed: true,
      });
  }
  await tx.query("insert into public.workflow_migrations values($1)", [marker]);
}
