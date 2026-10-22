import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import type { DeliveryTracking } from "../src/lib/tracking";

const db = new PGlite();
const hq = randomUUID(),
  smes = [randomUUID(), randomUUID(), randomUUID()];
let product: string;
async function user(id: string, role: string, branchId: string | null = null) {
  await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query(
    "insert into public.profiles(id,username,name,role,must_change_password,branch_id) values($1,$2,$2,$3,false,$4)",
    [id, id, role, branchId],
  );
}
async function as<T = any>(id: string, sql: string, values: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, values)).rows;
  });
}
async function action(actor: string, name: string, orderId: string) {
  return as(
    actor,
    "select public.workflow_execute($1,jsonb_build_object('orderId',$2::text),$3::uuid)",
    [name, orderId, randomUUID()],
  );
}
async function group(
  driver: string,
  orders: string[],
  key = randomUUID(),
  actor = hq,
) {
  return (
    await as<{ r: { runId: string } }>(
      actor,
      "select public.delivery_group_assign($1::uuid[],$2::uuid,$3::uuid) r",
      [orders, driver, key],
    )
  )[0].r;
}
async function tracking(actor: string, order: string) {
  return (
    await as<{ r: DeliveryTracking }>(
      actor,
      "select public.workflow_tracking($1::uuid) r",
      [order],
    )
  )[0].r;
}
async function fixture(count = 2) {
  const driver = randomUUID();
  await user(driver, "driver");
  const orders: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    orders.push(id);
    await db.query(
      "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,latitude,longitude) values($1,$2,$3,$4,$5,'Private receiver','+959123456789',2,90000,5000,'Confirmed',now(),now(),$6,$7)",
      [
        id,
        `SECRET-ORDER-${i}-${id}`,
        smes[i],
        `PRIVATE-SHOP-${i}`,
        `PRIVATE-ADDRESS-${i}`,
        16.83 + i * 0.01,
        96.14 + i * 0.01,
      ],
    );
    await db.query(
      "insert into public.order_lines(order_id,product_id,product_name,pack_snapshot,quantity,unit_price) select $1,id,name,pack,2,45000 from public.products where id=$2",
      [id, product],
    );
    await db.query(
      "update public.inventory set allocated=allocated+2 where product_id=$1 and branch_id is null",
      [product],
    );
  }
  return { driver, orders };
}
async function dispatchAndPickup(
  driver: string,
  orders: string[],
  pickup = orders.length,
) {
  const run = (
    await db.query<{ id: string }>(
      "select s.run_id id from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id where a.order_id=$1 and a.active",
      [orders[0]],
    )
  ).rows[0];
  if (run) await groupAction(driver, run.id, "accept");
  for (let i = 0; i < orders.length; i++) {
    await action(hq, "prepare", orders[i]);
    await action(hq, "dispatch", orders[i]);
    if (i < pickup) await action(driver, "pickup", orders[i]);
  }
}
async function groupAction(
  driver: string,
  run: string,
  action = "accept",
  orders: string[] = [],
  key = randomUUID(),
) {
  return (
    await as<{ r: any }>(
      driver,
      "select public.driver_delivery_group_action($1::uuid,$2,$3::uuid[],$4::uuid) r",
      [run, action, orders, key],
    )
  )[0].r;
}
async function publish(driver: string, order: string, state = "sharing") {
  const t = await tracking(driver, order);
  await as(
    driver,
    "select public.workflow_tracking_publish($1::uuid,$2::uuid,$3,$4::jsonb)",
    [
      order,
      t.attemptId,
      state,
      JSON.stringify({
        latitude: 16.82,
        longitude: 96.13,
        accuracy: 10,
        capturedAt: new Date().toISOString(),
      }),
    ],
  );
}
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  product = (
    await db.query<{ id: string }>("select id from public.products limit 1")
  ).rows[0].id;
  await db.query(
    "update public.inventory set on_hand=10000 where branch_id is null",
  );
  await user(hq, "hq");
  for (const sme of smes) await user(sme, "sme");
}, 30000);
afterAll(() => db.close());

it("keeps group membership and helper functions inaccessible to clients", async () => {
  const tables = await db.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where oid in ('supplylink_private.delivery_runs'::regclass,'supplylink_private.delivery_run_stops'::regclass)",
  );
  expect(tables.rows).toHaveLength(2);
  expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
  const functions = await db.query<{ anon: boolean; client: boolean }>(
    "select has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') client from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('delivery_dispatch_candidates','delivery_group_assign','workflow_tracking','workflow_tracking_publish')) or (n.nspname='supplylink_private' and p.proname in ('workflow_tracking_before_groups','workflow_tracking_publish_before_groups','workflow_execute_before_groups','notify_delivery_run'))",
  );
  expect(functions.rows).toHaveLength(8);
  expect(functions.rows.every((row) => !row.anon)).toBe(true);
  const helpers = await db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='supplylink_private' and p.proname in ('workflow_tracking_before_groups','workflow_tracking_publish_before_groups','workflow_execute_before_groups','notify_delivery_run')",
  );
  expect(helpers.rows.every((row) => !row.allowed)).toBe(true);
});

it("atomically assigns ordered stops and replays only matching retries", async () => {
  const { driver, orders } = await fixture();
  const key = randomUUID();
  const first = await group(driver, orders, key);
  expect(await group(driver, orders, key)).toEqual(first);
  await expect(group(driver, [...orders].reverse(), key)).rejects.toThrow(
    "retry key",
  );
  const rows = await db.query<{ order_id: string; driver_id: string }>(
    "select s.position,a.order_id,a.driver_id from supplylink_private.delivery_run_stops s join public.delivery_attempts a on a.id=s.attempt_id where s.run_id=$1 order by s.position",
    [first.runId],
  );
  expect(rows.rows.map((row) => row.order_id)).toEqual(orders);
  expect(rows.rows.every((row) => row.driver_id === driver)).toBe(true);
  await expect(group(driver, orders)).rejects.toThrow("already grouped");
});

it("projects only the customer prefix, with anonymous earlier pins and no later stops", async () => {
  const { driver, orders } = await fixture(3);
  await group(driver, orders);
  const first = await tracking(smes[0], orders[0]),
    second = await tracking(smes[1], orders[1]);
  expect(first.run?.stops).toHaveLength(1);
  expect(second.run?.stops).toHaveLength(2);
  expect(second.run?.stops[0]).toEqual({
    position: 1,
    own: false,
    pin: { latitude: 16.83, longitude: 96.14 },
  });
  for (const result of [first, second]) {
    expect(result.run).not.toHaveProperty("publisher");
    expect(JSON.stringify(result.run)).not.toContain("PRIVATE");
    expect(JSON.stringify(result.run)).not.toContain("SECRET-ORDER");
    expect(JSON.stringify(result.run)).not.toContain(orders[2]);
  }
  expect(JSON.stringify(second)).not.toContain(orders[0]);
  const full = await tracking(hq, orders[0]);
  expect(full.run?.stops).toHaveLength(3);
  expect(full.run?.stops[1].business).toBe("PRIVATE-SHOP-1");
  expect((await tracking(driver, orders[1])).run?.stops).toHaveLength(3);
  await expect(tracking(smes[1], orders[0])).rejects.toThrow("unavailable");
  await expect(
    as(smes[1], "select * from supplylink_private.delivery_run_stops"),
  ).rejects.toThrow();
  await expect(
    as(smes[1], "select public.delivery_dispatch_candidates()"),
  ).rejects.toThrow("Only HQ");
});

it("fans one GPS fix out only to picked-up stops and removes completed predecessors", async () => {
  const { driver, orders } = await fixture(3);
  await group(driver, orders);
  await dispatchAndPickup(driver, orders, 2);
  await publish(driver, orders[0]);
  expect((await tracking(smes[0], orders[0])).state).toBe("sharing");
  const firstPoint = (await tracking(smes[0], orders[0])).point!;
  expect((await tracking(smes[1], orders[1])).point).toMatchObject({
    latitude: firstPoint.latitude,
    longitude: firstPoint.longitude,
    accuracy: firstPoint.accuracy,
    capturedAt: firstPoint.capturedAt,
  });
  expect((await tracking(smes[2], orders[2])).point).toBeNull();
  await action(driver, "handover", orders[0]);
  expect((await tracking(smes[0], orders[0])).run).toBeUndefined();
  expect((await tracking(smes[0], orders[0])).point).toBeNull();
  const next = await tracking(smes[1], orders[1]);
  expect(next.run?.stops).toHaveLength(1);
  expect(next.run?.stops[0].own).toBe(true);
  expect((await tracking(driver, orders[0])).run?.publisher?.orderId).toBe(
    orders[1],
  );
  await expect(publish(driver, orders[0])).rejects.toThrow("unavailable");
  await publish(driver, orders[1], "paused");
  expect((await tracking(smes[1], orders[1])).state).toBe("paused");
  expect((await tracking(smes[0], orders[0])).state).toBe("stopped");
});

it("requires group acceptance, persists it without GPS, and replays matching retries", async () => {
  const { driver, orders } = await fixture();
  const { runId } = await group(driver, orders);
  await action(hq, "prepare", orders[0]);
  await action(hq, "dispatch", orders[0]);
  await expect(action(driver, "pickup", orders[0])).rejects.toThrow(
    "Accept this delivery group",
  );
  await expect(
    groupAction(driver, runId, "pickup", [orders[0]]),
  ).rejects.toThrow("Accept this delivery group");
  const key = randomUUID();
  const result = await groupAction(driver, runId, "accept", [], key);
  expect(await groupAction(driver, runId, "accept", [], key)).toEqual(result);
  const groups = (
    await as<{ r: any[] }>(driver, "select public.driver_delivery_groups() r")
  )[0].r;
  expect(groups.find((g) => g.id === runId).acceptedAt).toBeTruthy();
  expect((await tracking(driver, orders[0])).pickedUpAt).toBeNull();
  expect((await tracking(smes[0], orders[0])).point).toBeNull();
  expect(
    (
      await db.query(
        "select * from public.audit_events where subject_id=$1 and action='delivery.group_accept'",
        [runId],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    groupAction(driver, runId, "pickup", [orders[0]], key),
  ).rejects.toThrow("retry key");
});

it("atomically collects a checked subset, excludes unchecked GPS and navigation, and later adds the rest", async () => {
  const { driver, orders } = await fixture(3);
  const { runId } = await group(driver, orders);
  await groupAction(driver, runId);
  for (const order of orders) {
    await action(hq, "prepare", order);
    await action(hq, "dispatch", order);
  }
  const key = randomUUID();
  const result = await groupAction(
    driver,
    runId,
    "pickup",
    [orders[0], orders[2]],
    key,
  );
  expect(result.publisher.orderId).toBe(orders[0]);
  expect(
    await groupAction(driver, runId, "pickup", [orders[2], orders[0]], key),
  ).toEqual(result);
  await publish(driver, orders[0]);
  expect((await tracking(smes[1], orders[1])).point).toBeNull();
  expect((await tracking(smes[1], orders[1])).pickedUpAt).toBeNull();
  expect(
    (await tracking(driver, orders[0])).run?.stops.map((s) => s.orderId),
  ).toEqual([orders[0], orders[2]]);
  expect(
    (await tracking(smes[2], orders[2])).run?.stops.map((s) => s.position),
  ).toEqual([1, 3]);
  await groupAction(driver, runId, "pickup", [orders[1]]);
  await publish(driver, orders[0]);
  expect((await tracking(smes[1], orders[1])).point).toBeTruthy();
  expect((await tracking(driver, orders[0])).run?.stops).toHaveLength(3);
});

it("rolls back all pickups if any selected parcel is not dispatched or is on hold", async () => {
  const { driver, orders } = await fixture();
  const { runId } = await group(driver, orders);
  await groupAction(driver, runId);
  await action(hq, "prepare", orders[0]);
  await action(hq, "dispatch", orders[0]);
  await expect(groupAction(driver, runId, "pickup", orders)).rejects.toThrow(
    "after dispatch",
  );
  expect((await tracking(driver, orders[0])).pickedUpAt).toBeNull();
  await action(hq, "prepare", orders[1]);
  await action(hq, "dispatch", orders[1]);
  await as(
    hq,
    "select public.workflow_execute('hold',jsonb_build_object('orderId',$1::text,'reason','Test hold'),$2::uuid)",
    [orders[1], randomUUID()],
  );
  await expect(groupAction(driver, runId, "pickup", orders)).rejects.toThrow(
    "after dispatch",
  );
  expect((await tracking(driver, orders[0])).pickedUpAt).toBeNull();
});

it("denies other drivers, customers and HQ, and rejects foreign or duplicate parcels", async () => {
  const { driver, orders } = await fixture();
  const { runId } = await group(driver, orders);
  const other = await fixture();
  for (const actor of [other.driver, smes[0], hq]) {
    await expect(groupAction(actor, runId)).rejects.toThrow();
  }
  await expect(
    as(smes[0], "select public.driver_delivery_groups()"),
  ).rejects.toThrow("Only drivers");
  expect(
    (
      await as<{ r: any[] }>(
        other.driver,
        "select public.driver_delivery_groups() r",
      )
    )[0].r,
  ).toEqual([]);
  await groupAction(driver, runId);
  await expect(
    groupAction(driver, runId, "pickup", [orders[0], orders[0]]),
  ).rejects.toThrow("Check the parcels");
  await expect(
    groupAction(driver, runId, "pickup", [other.orders[0]]),
  ).rejects.toThrow("no longer assigned");
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','public.driver_delivery_group_action(uuid,text,uuid[],uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});

it("rejects duplicates, mismatched locations, other active jobs and unauthorized assignment", async () => {
  const { driver, orders } = await fixture();
  await expect(group(driver, [orders[0], orders[0]])).rejects.toThrow(
    "distinct",
  );
  await expect(group(driver, orders, randomUUID(), smes[0])).rejects.toThrow(
    "Only HQ",
  );
  const b = (
    await db.query<{ id: string }>("select id from public.branches limit 1")
  ).rows[0].id;
  await db.query("update public.orders set source_branch_id=$1 where id=$2", [
    b,
    orders[1],
  ]);
  await expect(group(driver, orders)).rejects.toThrow("same fulfilment");
  expect(
    (
      await db.query(
        "select * from public.delivery_attempts where order_id=any($1::uuid[])",
        [orders],
      )
    ).rows,
  ).toHaveLength(0);
  await db.query("update public.orders set source_branch_id=null where id=$1", [
    orders[1],
  ]);
  const other = await fixture();
  await as(
    hq,
    "select public.workflow_execute('assign',jsonb_build_object('orderId',$1::text,'driverId',$2::text),$3::uuid)",
    [other.orders[0], driver, randomUUID()],
  );
  await expect(group(driver, orders)).rejects.toThrow(
    "other active deliveries",
  );
});

it("lets branch staff group only their own orders with their own driver", async () => {
  const { driver, orders } = await fixture();
  const branch = (
    await db.query<{ id: string }>("select id from public.branches limit 1")
  ).rows[0].id;
  const staff = randomUUID();
  await user(staff, "branch", branch);
  await db.query(
    "update public.orders set source_branch_id=$1 where id=any($2::uuid[])",
    [branch, orders],
  );
  await db.query("update public.profiles set branch_id=$1 where id=$2", [
    branch,
    driver,
  ]);
  const candidates = (
    await as<{ r: { orders: { id: string }[] } }>(
      staff,
      "select public.delivery_dispatch_candidates() r",
    )
  )[0].r;
  expect(candidates.orders.map((order) => order.id)).toEqual(
    expect.arrayContaining(orders),
  );
  await group(driver, orders, randomUUID(), staff);
  const unrelated = await fixture();
  await expect(
    group(unrelated.driver, unrelated.orders, randomUUID(), staff),
  ).rejects.toThrow("fulfilment location");
});
