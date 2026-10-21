// Creates the first HQ only; never rotates an existing account or prints secrets.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url !== "https://mtgqcmfnbubhlcxuhtpu.supabase.co" || !key)
  throw new Error("Configure the Supply Link project and server key first.");
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { count, error: checkError } = await admin
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "hq");
if (checkError)
  throw new Error("Could not check HQ profiles; apply migrations first.");
if (count) {
  console.log("An HQ account already exists. No credentials were changed.");
  process.exit(0);
}
const directory = path.join(process.cwd(), ".data");
await mkdir(directory, { recursive: true });
const credentialPath = path.join(directory, "initial-hq-credentials.txt");
const username = "hq.admin";
const password = randomBytes(24).toString("base64url") + "Aa1!";
await writeFile(
  credentialPath,
  `Supply Link — initial HQ access\nPortal: http://127.0.0.1:3000/hq/login\nAccount ID: ${username}\nTemporary password: ${password}\n\nYou must change this temporary password at first sign-in.\nThis local file is ignored by Git. Delete it after changing your password.\n`,
  { flag: "wx", mode: 0o600 },
);
const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@login.supplylink.invalid`,
  password,
  email_confirm: true,
});
if (error || !data.user)
  throw new Error(
    "HQ Auth creation failed. Check the Supabase Auth dashboard before retrying.",
  );
const { error: profileError } = await admin.from("profiles").insert({
  id: data.user.id,
  username,
  name: "Supply Link Administrator",
  role: "hq",
  status: "active",
  must_change_password: true,
});
if (profileError)
  throw new Error(
    "HQ Auth user exists but the profile could not be saved. Reconcile the profile before retrying.",
  );
console.log("Created hq.admin with mandatory first-login password change.");
console.log(
  "Temporary credentials saved locally to .data/initial-hq-credentials.txt (not printed).",
);
