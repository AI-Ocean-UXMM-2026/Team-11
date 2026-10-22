// Creates the first HQ account on an empty Supabase database.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.BOOTSTRAP_HQ !== "true")
  throw new Error("Set BOOTSTRAP_HQ=true to confirm first-HQ setup.");
if (!url || !key)
  throw new Error("Configure the target Supabase URL and server key first.");
const projectRef = new URL(url).hostname.split(".")[0];
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { count, error: checkError } = await admin
  .from("profiles")
  .select("id", { count: "exact", head: true });
if (checkError)
  throw new Error("Could not check HQ profiles; apply migrations first.");
if (count) {
  throw new Error(
    "This database already has profiles. First-HQ setup only runs on an empty database; existing credentials were not changed.",
  );
}
const directory = path.join(process.cwd(), ".data");
await mkdir(directory, { recursive: true });
const credentialPath = path.join(
  directory,
  `initial-hq-credentials-${projectRef}.txt`,
);
const username = "hq.admin";
const password = randomBytes(24).toString("base64url") + "Aa1!";
await writeFile(
  credentialPath,
  `Initial HQ access\nProject: ${projectRef}\nPortal: /hq/login\nAccount ID: ${username}\nTemporary password: ${password}\n\nYou must change this temporary password at first sign-in.\nThis local file is ignored by Git. Delete it after changing your password.\n`,
  { flag: "wx", mode: 0o600 },
);
let userId;
try {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@login.supplylink.invalid`,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(
      "HQ Auth creation failed. Check the Supabase Auth dashboard before retrying.",
    );
  userId = data.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    username,
    name: "Headquarters Administrator",
    role: "hq",
    status: "active",
    must_change_password: true,
  });
  if (profileError)
    throw new Error(`HQ profile creation failed: ${profileError.message}`);
} catch (error) {
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
  await rm(credentialPath, { force: true });
  throw error;
}

console.log("Created hq.admin with mandatory first-login password change.");
console.log(
  `Temporary credentials saved locally to ${credentialPath} (not printed).`,
);
