import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { supabaseStubs } from "../src/lib/workflow/local";
import {
  locationIsFresh,
  locationUpdateSchema,
  type DeliveryTracking,
} from "../src/lib/tracking";

const db = new PGlite();
const ids = {
  hq: randomUUID(),
  sme: randomUUID(),
  other: randomUUID(),
  driver: randomUUID(),
  outsider: randomUUID(),
  branch: randomUUID(),
};
async function as<T>(
  user: keyof typeof ids,
  sql: string,
  values: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      ids[user],
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, values)).rows;
  });
}
const action = (
  user: keyof typeof ids,
  name: string,
  orderId: string,
  key = randomUUID(),
) =>
  as<{ r: any }>(
    user,
    "select public.workflow_execute($1,jsonb_build_object('orderId',$2::text),$3::uuid) r",
    [name, orderId, key],
  );
const tracking = async (user: keyof typeof ids, orderId: string) =>
  (
    await as<{ r: DeliveryTracking }>(
      user,
      "select public.workflow_tracking($1::uuid) r",
      [orderId],
    )
  )[0].r;
async function delivery(pickup = false) {
  const orderId = randomUUID(),
    attemptId = randomUUID();
  await db.query(
    "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,dispatched_at,latitude,longitude) values($1,$2,$3,'Shop','Delivery pin','Receiver','+959123456789',2,10000,1000,'Shipping',now(),now(),now(),16.85,96.18)",
    [orderId, `TRACK-${orderId}`, ids.sme],
  );
  await db.query(
    "insert into public.delivery_attempts(id,order_id,driver_id,status,dispatched_at) values($1,$2,$3,'dispatched',now())",
    [attemptId, orderId, ids.driver],
  );
  if (pickup) await action("driver", "pickup", orderId);
  return { orderId, attemptId };
}
function point(at = Date.now()) {
  return {
    latitude: 16.84,
    longitude: 96.17,
    accuracy: 12,
    capturedAt: new Date(at).toISOString(),
  };
}
const publish = (
  user: keyof typeof ids,
  orderId: string,
  attemptId: string,
  value: unknown = point(),
  state = "sharing",
) =>
  as(
    user,
    "select public.workflow_tracking_publish($1::uuid,$2::uuid,$3,$4::jsonb)",
    [orderId, attemptId, state, JSON.stringify(value)],
  );
beforeAll(async () => {
  await db.exec(supabaseStubs);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const branchId = randomUUID();
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Tracking branch','')",
    [branchId],
  );
  for (const [user, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,username,name,role,must_change_password,branch_id) values($1,$2,$2,$3,false,$4)",
      [
        id,
        user + ".tracking",
        user === "hq"
          ? "hq"
          : user === "driver" || user === "outsider"
            ? "driver"
            : user === "branch"
              ? "branch"
              : "sme",
        user === "branch" ? branchId : null,
      ],
    );
  }
}, 30000);
afterAll(() => db.close());

it("allows HQ to assign two active orders to the same driver and lists both jobs", async () => {
  const orderIds = [randomUUID(), randomUUID()];
  for (const orderId of orderIds) {
    await db.query(
      "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status,payment_verified_at,reserved_at,latitude,longitude) values($1,$2,$3,'Multi-order shop','Delivery pin','Receiver','+959123456789',2,10000,1000,'Confirmed',now(),now(),16.85,96.18)",
      [orderId, `MULTI-${orderId}`, ids.sme],
    );
    await as(
      "hq",
      "select public.workflow_execute('assign',jsonb_build_object('orderId',$1::text,'driverId',$2::text),$3::uuid)",
      [orderId, ids.driver, randomUUID()],
    );
  }
  const attempts = await db.query<{ order_id: string; driver_id: string }>(
    "select order_id,driver_id from public.delivery_attempts where order_id=any($1::uuid[]) and active",
    [orderIds],
  );
  expect(attempts.rows).toHaveLength(2);
  expect(attempts.rows.every((row) => row.driver_id === ids.driver)).toBe(true);
  const jobs = (
    await as<{ r: { rows: { id: string }[] } }>(
      "driver",
      "select public.workflow_list('orders','{}'::jsonb) r",
    )
  )[0].r.rows;
  expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining(orderIds));
});

it("requires assigned-driver pickup after dispatch and records a retry only once", async () => {
  const { orderId, attemptId } = await delivery();
  await expect(action("hq", "pickup", orderId)).rejects.toThrow(
    "assigned driver",
  );
  await expect(action("outsider", "pickup", orderId)).rejects.toThrow(
    "assigned driver",
  );
  await expect(action("driver", "handover", orderId)).rejects.toThrow(
    "Confirm pickup",
  );
  await expect(publish("driver", orderId, attemptId)).rejects.toThrow(
    "unavailable",
  );
  const key = randomUUID();
  await action("driver", "pickup", orderId, key);
  const first = await tracking("sme", orderId);
  expect(first.pickedUpAt).toBeTruthy();
  expect(first.canPublish).toBe(true);
  await action("driver", "pickup", orderId, key);
  await action("driver", "pickup", orderId);
  expect((await tracking("hq", orderId)).pickedUpAt).toBe(first.pickedUpAt);
  expect(
    (
      await db.query(
        "select * from public.order_events where order_id=$1 and action='pickup'",
        [orderId],
      )
    ).rows,
  ).toHaveLength(1);
  const rows = await as<{ r: any }>(
    "driver",
    "select public.workflow_list('orders',jsonb_build_object('orderId',$1::text)) r",
    [orderId],
  );
  expect(rows[0].r.rows[0].workflow.pickedUpAt).toBe(first.pickedUpAt);
});

it("restricts fixes and the live table to HQ, the owning SME and assigned driver", async () => {
  const { orderId, attemptId } = await delivery(true);
  await publish("driver", orderId, attemptId);
  for (const user of ["hq", "sme", "driver"] as const) {
    expect((await tracking(user, orderId)).point?.accuracy).toBe(12);
    expect(
      await as(
        user,
        "select * from public.delivery_tracking where order_id=$1",
        [orderId],
      ),
    ).toHaveLength(1);
  }
  for (const user of ["other", "outsider", "branch"] as const) {
    await expect(tracking(user, orderId)).rejects.toThrow("unavailable");
    expect(
      await as(
        user,
        "select * from public.delivery_tracking where order_id=$1",
        [orderId],
      ),
    ).toHaveLength(0);
    await expect(publish(user, orderId, attemptId)).rejects.toThrow();
  }
  await expect(
    as(
      "driver",
      "update public.delivery_tracking set latitude=0 where attempt_id=$1",
      [attemptId],
    ),
  ).rejects.toThrow("permission denied");
  await expect(
    as("driver", "select * from public.driver_locations"),
  ).rejects.toThrow("permission denied");
});

it("rejects invalid, stale, future and out-of-order fixes without overwriting the latest point", async () => {
  const { orderId, attemptId } = await delivery(true);
  const first = point(Date.now() - 1000);
  await publish("driver", orderId, attemptId, first);
  for (const invalid of [
    { ...point(), latitude: 91 },
    { ...point(), accuracy: -1 },
    point(Date.now() - 61_000),
    point(Date.now() + 60_000),
    first,
  ]) {
    await expect(
      publish("driver", orderId, attemptId, invalid),
    ).rejects.toThrow();
  }
  await publish("driver", orderId, attemptId, { ...point(), latitude: 17 });
  expect((await tracking("hq", orderId)).point?.latitude).toBe(first.latitude);
  await publish("driver", orderId, attemptId, null, "paused");
  expect((await tracking("hq", orderId)).state).toBe("paused");
  await publish("driver", orderId, attemptId, { ...point(), latitude: 17 });
  expect((await tracking("hq", orderId)).point?.latitude).toBe(17);
});

it("pauses on hold, resumes only with a valid assignment and erases the fix after handover", async () => {
  const { orderId, attemptId } = await delivery(true);
  await publish("driver", orderId, attemptId);
  await db.query(
    "update public.orders set status='On hold',has_open_issue=true where id=$1",
    [orderId],
  );
  const held = await tracking("sme", orderId);
  expect(held.state).toBe("paused");
  expect(held.canPublish).toBe(false);
  expect(held.point).not.toBeNull();
  await expect(publish("driver", orderId, attemptId)).rejects.toThrow(
    "unavailable",
  );
  await db.query(
    "update public.orders set status='Shipping',has_open_issue=false where id=$1",
    [orderId],
  );
  await publish("driver", orderId, attemptId, point(Date.now() + 1000));
  await action("driver", "handover", orderId);
  const ended = await tracking("sme", orderId);
  expect(ended.state).toBe("stopped");
  expect(ended.point).toBeNull();
  expect(ended.canPublish).toBe(false);
  await expect(publish("driver", orderId, attemptId)).rejects.toThrow(
    "unavailable",
  );
});

it("revokes the previous attempt immediately on replacement and suspending the driver stops publishing", async () => {
  const { orderId, attemptId } = await delivery(true);
  await publish("driver", orderId, attemptId);
  await db.query(
    "update public.delivery_attempts set active=false,status='replaced' where id=$1",
    [attemptId],
  );
  expect(
    (
      await as<any>(
        "hq",
        "select * from public.delivery_tracking where attempt_id=$1",
        [attemptId],
      )
    )[0].latitude,
  ).toBeNull();
  await expect(publish("driver", orderId, attemptId)).rejects.toThrow(
    "unavailable",
  );
  const replacement = randomUUID();
  await db.query(
    "insert into public.delivery_attempts(id,order_id,driver_id,status,dispatched_at) values($1,$2,$3,'dispatched',now())",
    [replacement, orderId, ids.outsider],
  );
  await expect(tracking("driver", orderId)).rejects.toThrow("unavailable");
  expect((await tracking("sme", orderId)).attemptId).toBe(replacement);
  const next = await delivery(true);
  await publish("driver", next.orderId, next.attemptId);
  await db.query("update public.profiles set status='suspended' where id=$1", [
    ids.driver,
  ]);
  expect((await tracking("hq", next.orderId)).point).toBeNull();
  await expect(publish("driver", next.orderId, next.attemptId)).rejects.toThrow(
    "active",
  );
  await db.query("update public.profiles set status='active' where id=$1", [
    ids.driver,
  ]);
});

it("marks an old fix stale based on capture time and rejects incomplete client payloads", () => {
  const now = Date.now();
  const data = {
    canPublish: true,
    state: "sharing",
    point: point(now - 5000),
  } as DeliveryTracking;
  expect(locationIsFresh(data, now)).toBe(true);
  expect(locationIsFresh(data, now + 60_000)).toBe(false);
  expect(locationIsFresh({ ...data, state: "paused" }, now)).toBe(false);
  expect(
    locationUpdateSchema.safeParse({
      attemptId: randomUUID(),
      state: "sharing",
    }).success,
  ).toBe(false);
  expect(
    locationUpdateSchema.safeParse({ attemptId: randomUUID(), state: "paused" })
      .success,
  ).toBe(true);
});
