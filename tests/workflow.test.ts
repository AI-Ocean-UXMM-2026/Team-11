import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { WorkspaceData } from "../src/lib/domain";
const db = new PGlite();
const users = {
  hq: randomUUID(),
  sme: randomUUID(),
  other: randomUUID(),
  driver: randomUUID(),
  outsider: randomUUID(),
  branch: randomUUID(),
};
let product: string, branch: string, order: string, evidence: string;
async function rpc(
  role: keyof typeof users,
  action: string,
  payload: Record<string, unknown>,
  key = randomUUID(),
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[role],
    ]);
    await tx.exec("set local role authenticated");
    return (
      await tx.query<{ r: Record<string, any> }>(
        "select public.workflow_execute($1,$2::jsonb,$3::uuid) r",
        [action, JSON.stringify(payload), key],
      )
    ).rows[0].r;
  });
}
async function snapshot(role: keyof typeof users) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users[role],
    ]);
    await tx.exec("set local role authenticated");
    return (
      await tx.query<{ r: WorkspaceData }>(
        "select public.workflow_snapshot() r",
      )
    ).rows[0].r;
  });
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of [
    "202610200001_baseline.sql",
    "202610200002_stt_catalog.sql",
    "202610210003_order_workflow.sql",
    "202610210004_order_history.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  branch = (
    await db.query<{ id: string }>("select id from public.branches limit 1")
  ).rows[0].id;
  product = (
    await db.query<{ id: string }>(
      "select id from public.products where brand='STT' limit 1",
    )
  ).rows[0].id;
  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,must_change_password,branch_id) values($1,$2,$2,$3,false,$4)",
      [
        id,
        `${name}.user`,
        name === "hq"
          ? "hq"
          : name === "driver" || name === "outsider"
            ? "driver"
            : name === "branch"
              ? "branch"
              : "sme",
        name === "branch" ? branch : null,
      ],
    );
  }
}, 30000);
afterAll(() => db.close());
const quote = () => ({
  items: [{ productId: product, quantity: 2 }],
  receiver: "Receiver",
  phone: "09123456789",
  address: "Hlaing, Yangon",
  area: "Yangon",
  expectedTotal: 95000,
});
it("requires configured quotes; ignores supplied prices and enforces minimums", async () => {
  await expect(rpc("sme", "create", quote())).rejects.toThrow("configure");
  await expect(
    rpc("sme", "configure", {
      shipping: 5000,
      instructions: "Receiving account",
    }),
  ).rejects.toThrow("Only HQ");
  await rpc("hq", "configure", {
    shipping: 5000,
    instructions: "Check receiving account",
  });
  await expect(
    rpc("sme", "create", { ...quote(), expectedTotal: 1 }),
  ).rejects.toThrow("quote changed");
  await expect(
    rpc("sme", "create", {
      ...quote(),
      items: [{ productId: product, quantity: 1 }],
    }),
  ).rejects.toThrow("minimum");
  const key = randomUUID();
  const result = await rpc("sme", "create", quote(), key);
  order = result.orderId;
  expect((await rpc("sme", "create", quote(), key)).orderId).toBe(order);
  await expect(
    rpc("sme", "create", { ...quote(), receiver: "Someone else" }, key),
  ).rejects.toThrow("retry key");
  expect((await snapshot("other")).orders).toHaveLength(0);
  await expect(
    rpc("outsider", "hold", { orderId: order, reason: "Unassigned" }),
  ).rejects.toThrow();
});
it("keeps proof private and requires actual full payment before allocating", async () => {
  await expect(
    rpc("other", "proof_intent", { orderId: order, digest: "a".repeat(64) }),
  ).rejects.toThrow("not available");
  const intent = await rpc("sme", "proof_intent", {
    orderId: order,
    digest: "a".repeat(64),
  });
  await db.query(
    "insert into storage.objects(bucket_id,name) values('payment-evidence',$1)",
    [intent.path],
  );
  await expect(
    rpc("sme", "submit_evidence", {
      orderId: order,
      intentId: intent.intentId,
      amount: 90000,
      reference: "TX-123",
    }),
  ).rejects.toThrow("full quoted");
  await rpc("sme", "submit_evidence", {
    orderId: order,
    intentId: intent.intentId,
    amount: 95000,
    reference: "TX-123",
  });
  evidence = (await snapshot("hq")).orders[0].workflow!.evidence[0].id;
  await expect(
    rpc("hq", "review_payment", {
      orderId: order,
      evidenceId: evidence,
      decision: "approve",
      verifiedAmount: 95000,
      bankChecked: false,
    }),
  ).rejects.toThrow("receiving account");
  await expect(
    rpc("hq", "review_payment", {
      orderId: order,
      evidenceId: evidence,
      decision: "approve",
      verifiedAmount: 90000,
      bankChecked: true,
    }),
  ).rejects.toThrow("full order total");
  await rpc("hq", "review_payment", {
    orderId: order,
    evidenceId: evidence,
    decision: "approve",
    verifiedAmount: 95000,
    bankChecked: true,
  });
  expect((await snapshot("sme")).orders[0].status).toBe("Confirmed");
  expect(
    (
      await db.query<{ allocated: number }>(
        "select allocated from public.inventory where product_id=$1 and branch_id is null",
        [product],
      )
    ).rows[0].allocated,
  ).toBe(2);
});
it("dispatches once, scopes driver jobs, and records a sale only after both confirmations", async () => {
  await expect(rpc("hq", "dispatch", { orderId: order })).rejects.toThrow(
    "Prepare",
  );
  await rpc("hq", "assign", { orderId: order, driverId: users.driver });
  await rpc("hq", "prepare", { orderId: order });
  const key = randomUUID();
  await rpc("hq", "dispatch", { orderId: order }, key);
  await rpc("hq", "dispatch", { orderId: order }, key);
  expect((await snapshot("outsider")).orders).toHaveLength(0);
  const driverOrder = (await snapshot("driver")).orders[0];
  expect(driverOrder.merchandise).toBe(0);
  expect(driverOrder.workflow!.evidence).toHaveLength(0);
  await expect(
    rpc("driver", "proof_read", { orderId: order, evidenceId: evidence }),
  ).rejects.toThrow("private");
  await expect(rpc("hq", "complete", { orderId: order })).rejects.toThrow(
    "handover",
  );
  await rpc("driver", "handover", { orderId: order });
  await rpc("sme", "hold", { orderId: order, reason: "Missing pair check" });
  await expect(rpc("hq", "complete", { orderId: order })).rejects.toThrow();
  await rpc("hq", "resolve", {
    orderId: order,
    reason: "All pairs counted together",
  });
  await rpc("hq", "complete", { orderId: order });
  expect((await snapshot("hq")).salesEvents).toHaveLength(0);
  const receiptKey = randomUUID();
  await rpc(
    "sme",
    "receive",
    { orderId: order, fullReceipt: true },
    receiptKey,
  );
  await rpc(
    "sme",
    "receive",
    { orderId: order, fullReceipt: true },
    receiptKey,
  );
  const result = await snapshot("hq");
  expect(result.orders[0].status).toBe("Done");
  expect(result.orders[0].workflow!.driverName).toBe("driver.user");
  expect((await snapshot("driver")).orders).toHaveLength(0);
  expect(result.salesEvents).toHaveLength(1);
  expect(result.salesEvents![0].amount).toBe(90000);
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from public.inventory_movements where order_id=$1 and kind='dispatch'",
        [order],
      )
    ).rows[0].count,
  ).toBe(1);
});
it("posts retail once without consuming protected or allocated pairs", async () => {
  await rpc("hq", "stock", {
    productId: product,
    branchId: branch,
    onHand: 8,
    reason: "Opening retail count",
  });
  await db.query(
    "update public.inventory set protected_reserve=4 where branch_id=$1 and product_id=$2",
    [branch, product],
  );
  await expect(
    rpc("branch", "retail", {
      items: [{ productId: product, quantity: 5, price: 60000 }],
    }),
  ).rejects.toThrow("available stock");
  const payload = {
    items: [{ productId: product, quantity: 2, price: 60000 }],
  };
  const key = randomUUID();
  await rpc("branch", "retail", payload, key);
  await rpc("branch", "retail", payload, key);
  expect((await snapshot("branch")).salesEvents![0].amount).toBe(120000);
  expect((await snapshot("hq")).salesEvents).toHaveLength(2);
});

it("rejects stale evidence and preserves quote prices after catalog changes", async () => {
  const id = (await rpc("sme", "create", quote())).orderId;
  await rpc("hq", "price", {
    productId: product,
    price: 47000,
    reason: "New supplier price",
  });
  expect(
    (await snapshot("sme")).orders.find((o) => o.id === id)!.merchandise,
  ).toBe(90000);
  await rpc("hq", "price", {
    productId: product,
    price: 45000,
    reason: "Restore test price",
  });
  async function proof() {
    const p = await rpc("sme", "proof_intent", {
      orderId: id,
      digest: "b".repeat(64),
    });
    await db.query(
      "insert into storage.objects(bucket_id,name) values('payment-evidence',$1)",
      [p.path],
    );
    await rpc("sme", "submit_evidence", {
      orderId: id,
      intentId: p.intentId,
      amount: 95000,
      reference: "CORRECT-001",
    });
    return (await snapshot("hq")).orders.find((o) => o.id === id)!.workflow!
      .evidence[0].id;
  }
  const first = await proof();
  await rpc("hq", "review_payment", {
    orderId: id,
    evidenceId: first,
    decision: "reject",
    reason: "Image does not show the reference",
  });
  const second = await proof();
  await expect(
    rpc("hq", "review_payment", {
      orderId: id,
      evidenceId: first,
      decision: "approve",
      verifiedAmount: 95000,
      bankChecked: true,
    }),
  ).rejects.toThrow("latest pending");
  await rpc("hq", "review_payment", {
    orderId: id,
    evidenceId: second,
    decision: "approve",
    verifiedAmount: 95000,
    bankChecked: true,
  });
  await rpc("hq", "cancel", {
    orderId: id,
    reason: "Customer requested refund",
  });
  expect(
    (await snapshot("sme")).orders.find((o) => o.id === id)!.workflow!
      .refundRequired,
  ).toBe(true);
});

it("allocates competing paid orders atomically and releases reservations on cancellation", async () => {
  await rpc("hq", "stock", {
    productId: product,
    onHand: 4,
    reason: "Four pairs available for reservation test",
  });
  const ids = [
    (await rpc("sme", "create", quote())).orderId,
    (await rpc("other", "create", quote())).orderId,
  ];
  for (const [index, id] of ids.entries()) {
    const role = index === 0 ? "sme" : "other";
    const p = await rpc(role, "proof_intent", {
      orderId: id,
      digest: "c".repeat(64),
    });
    await db.query(
      "insert into storage.objects(bucket_id,name) values('payment-evidence',$1)",
      [p.path],
    );
    await rpc(role, "submit_evidence", {
      orderId: id,
      intentId: p.intentId,
      amount: 95000,
      reference: `COMPETE-${index}`,
    });
    const e = (await snapshot("hq")).orders.find((o) => o.id === id)!.workflow!
      .evidence[0].id;
    if (index === 1)
      await rpc("hq", "stock", {
        productId: product,
        onHand: 2,
        reason: "Actual available count reduced",
      });
    await rpc("hq", "review_payment", {
      orderId: id,
      evidenceId: e,
      decision: "approve",
      verifiedAmount: 95000,
      bankChecked: true,
    });
  }
  const state = await snapshot("hq");
  expect(state.orders.find((o) => o.id === ids[0])!.status).toBe("Confirmed");
  expect(state.orders.find((o) => o.id === ids[1])!.status).toBe(
    "Awaiting verification",
  );
  expect(
    state.orders.find((o) => o.id === ids[1])!.workflow!.paymentVerified,
  ).toBe(true);
  await rpc("hq", "cancel", {
    orderId: ids[0],
    reason: "Release for the other customer",
  });
  await rpc("hq", "confirm", { orderId: ids[1] });
  expect(
    (await snapshot("hq")).orders.find((o) => o.id === ids[1])!.status,
  ).toBe("Confirmed");
  await rpc("hq", "prepare", { orderId: ids[1] });
  await expect(
    rpc("outsider", "hold", {
      orderId: ids[1],
      reason: "Unauthorized driver hold",
    }),
  ).rejects.toThrow("not available");
});
