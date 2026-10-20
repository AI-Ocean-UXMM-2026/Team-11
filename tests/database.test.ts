import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const ids = {
  hq: "00000000-0000-4000-8000-000000000001",
  sme: "00000000-0000-4000-8000-000000000002",
  other: "00000000-0000-4000-8000-000000000003",
  branch: "00000000-0000-4000-8000-000000000004",
  driver: "00000000-0000-4000-8000-000000000005",
  suspended: "00000000-0000-4000-8000-000000000006",
  firstLogin: "00000000-0000-4000-8000-000000000007",
};
const branchId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
const productId = "30000000-0000-4000-8000-000000000001";
async function asUser<T>(id: string, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
  try {
    return await action();
  } finally {
    await db.exec("reset role");
  }
}
beforeAll(async () => {
  // Minimal Supabase-owned schemas, isolated in an in-memory Postgres runtime.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to authenticated;
  `);
  await db.exec(
    await readFile("supabase/migrations/202610200001_baseline.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/202610200002_stt_catalog.sql", "utf8"),
  );
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values ($1,'initial-hash')", [id]);
  }
  await db.query(
    "insert into public.branches(id,name,address) values($1,'Scoped branch','Yangon')",
    [branchId],
  );
  for (const [name, id] of Object.entries(ids)) {
    const role =
      name === "hq"
        ? "hq"
        : name === "branch"
          ? "branch"
          : name === "driver"
            ? "driver"
            : "sme";
    await db.query(
      "insert into public.profiles(id,username,name,role,status,must_change_password,branch_id) values ($1,$2,$2,$3,$4,$5,$6)",
      [
        id,
        name.toLowerCase() + ".user",
        role,
        name === "suspended" ? "suspended" : "active",
        name === "firstLogin",
        role === "branch" ? branchId : null,
      ],
    );
  }
  await db.query(
    "insert into public.products(id,sku,name,category,pack,base_units_per_pack,wholesale_price) values($1,'TEST','Historical test item','Legacy','Unit',1,1000)",
    [productId],
  );
  await db.query(
    "insert into public.inventory(branch_id,product_id,on_hand,protected_reserve) values($1,$2,100,20),(null,$2,200,40)",
    [branchId, productId],
  );
  await db.query(
    "insert into public.orders(id,reference,sme_id,business_name,destination,receiver_name,receiver_phone,item_count,merchandise_total,shipping_total,status) values($1,'TEST-001',$2,'Test Mart','Yangon','Receiver','090000000',1,1000,100,'Awaiting verification')",
    [orderId, ids.sme],
  );
  await db.query(
    "insert into public.payment_evidence(order_id,version,storage_path,claimed_amount) values($1,1,'test/private.png',1100)",
    [orderId],
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values('payment-evidence','test/private.png')",
  );
  await db.query(
    "insert into public.delivery_attempts(order_id,driver_id) values($1,$2)",
    [orderId, ids.driver],
  );
}, 30000);
afterAll(async () => {
  await db.close();
});

describe("baseline migration and RLS", () => {
  it("applies migration and seed in Postgres", async () => {
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from public.products",
    );
    expect(result.rows[0].count).toBe(7);
  });
  it("isolates SME orders, proof metadata and stored proof files", async () => {
    await asUser(ids.sme, async () => {
      expect((await db.query("select * from public.orders")).rows).toHaveLength(
        1,
      );
      expect(
        (await db.query("select * from public.payment_evidence")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from storage.objects")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from public.profiles")).rows,
      ).toHaveLength(1);
    });
    await asUser(ids.other, async () => {
      expect((await db.query("select * from public.orders")).rows).toHaveLength(
        0,
      );
      expect(
        (await db.query("select * from public.payment_evidence")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from storage.objects")).rows,
      ).toHaveLength(0);
    });
  });
  it("gives HQ organisation visibility without client write access", async () => {
    await asUser(ids.hq, async () => {
      expect(
        (await db.query("select * from public.profiles")).rows,
      ).toHaveLength(7);
      expect((await db.query("select * from public.orders")).rows).toHaveLength(
        1,
      );
      await expect(
        db.query("update public.profiles set role='hq' where id=$1", [
          ids.other,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("keeps drivers away from orders, prices and proofs", async () => {
    await asUser(ids.driver, async () => {
      expect((await db.query("select * from public.orders")).rows).toHaveLength(
        0,
      );
      expect(
        (await db.query("select * from public.products")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.payment_evidence")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.delivery_attempts")).rows,
      ).toHaveLength(1);
    });
  });
  it("scopes branch inventory and denies proof access", async () => {
    await asUser(ids.branch, async () => {
      const inventory = await db.query<{ branch_id: string }>(
        "select * from public.inventory",
      );
      expect(inventory.rows).toHaveLength(1);
      expect(inventory.rows[0].branch_id).toBe(branchId);
      expect(
        (await db.query("select * from public.branches")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from public.payment_evidence")).rows,
      ).toHaveLength(0);
    });
  });
  it("blocks suspended and first-login users even with an authenticated session", async () => {
    for (const user of [ids.suspended, ids.firstLogin])
      await asUser(user, async () => {
        expect(
          (await db.query("select * from public.products")).rows,
        ).toHaveLength(0);
        await expect(
          db.query(
            "update public.profiles set must_change_password=false where id=$1",
            [user],
          ),
        ).rejects.toThrow(/permission denied/);
      });
  });
  it("clears first-login only after a real Auth password hash change", async () => {
    await db.query(
      "update auth.users set encrypted_password='changed-hash' where id=$1",
      [ids.firstLogin],
    );
    await asUser(ids.firstLogin, async () => {
      expect(
        (await db.query("select * from public.products")).rows.length,
      ).toBeGreaterThan(0);
    });
    const audit = await db.query(
      "select * from public.audit_events where action='account.password_changed'",
    );
    expect(audit.rows).toHaveLength(1);
  });
  it("rejects premature Done and reserves above physical stock", async () => {
    await expect(
      db.query("update public.orders set status='Done' where id=$1", [orderId]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query("update public.inventory set protected_reserve=on_hand+1"),
    ).rejects.toThrow(/check constraint/);
  });
});
