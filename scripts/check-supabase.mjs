// Read-only checks plus a disposable Storage probe; no business rows are created.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import assert from "node:assert/strict";
loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (
  url !== "https://mtgqcmfnbubhlcxuhtpu.supabase.co" ||
  !publishable ||
  !secret
)
  throw new Error("Supply Link configuration is incomplete.");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options),
  anon = createClient(url, publishable, options);
const { data: bucket, error: bucketError } =
  await admin.storage.getBucket("payment-evidence");
assert.ok(!bucketError, "Private proof bucket exists");
assert.equal(bucket.public, false);
const { data: users, error: userError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1,
});
assert.ok(!userError, "Server key has Auth Admin access");
const { error: anonRpc } = await anon.rpc("workflow_snapshot");
assert.ok(anonRpc, "Anonymous workflow access must be rejected");
const { data: anonOrders, error: anonRead } = await anon
  .from("orders")
  .select("id");
assert.ok(
  anonRead || anonOrders.length === 0,
  "Anonymous order access is blocked",
);
const name = `connection-checks/${randomUUID()}.png`;
const bytes = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
})
  .png()
  .toBuffer();
let uploaded = false;
try {
  const { error } = await admin.storage
    .from("payment-evidence")
    .upload(name, bytes, { contentType: "image/png" });
  assert.ok(!error, "Server can upload private proof images");
  uploaded = true;
  const read = await admin.storage.from("payment-evidence").download(name);
  assert.ok(!read.error, "Server can read private proof images");
  const forbidden = await anon.storage.from("payment-evidence").download(name);
  assert.ok(forbidden.error, "Anonymous private proof download must be denied");
  const direct = await anon.storage
    .from("payment-evidence")
    .upload(`connection-checks/${randomUUID()}.png`, bytes, {
      contentType: "image/png",
    });
  assert.ok(direct.error, "Direct anonymous uploads must be denied");
} finally {
  if (uploaded) {
    const { error } = await admin.storage
      .from("payment-evidence")
      .remove([name]);
    assert.ok(!error, "Disposable storage probe was removed");
  }
}
console.log(
  JSON.stringify({
    project: "Supply Link",
    adminAccess: true,
    privateStorage: true,
    anonymousAccessBlocked: true,
    storageProbeRemoved: true,
    authUsers: users.total ?? null,
  }),
);
