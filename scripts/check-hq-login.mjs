// Verify the initial HQ guard without changing the user's password or printing it.
import nextEnv from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
nextEnv.loadEnvConfig(process.cwd());
const credentials = await readFile(".data/initial-hq-credentials.txt", "utf8");
const username = credentials.match(/^Account ID: (.+)$/m)?.[1];
const password = credentials.match(/^Temporary password: (.+)$/m)?.[1];
assert.ok(username && password, "Initial HQ credentials file is present");
const base = "http://127.0.0.1:3000";
const response = await fetch(base + "/api/auth/hq/login", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
assert.equal(response.status, 200, "Live HQ sign-in succeeds");
const result = await response.json();
assert.equal(result.redirectTo, "/change-password?portal=hq");
const jar = response.headers.getSetCookie().map((value) => {
  const [name, ...rest] = value.split(";")[0].split("=");
  return { name, value: rest.join("=") };
});
assert.ok(jar.length, "Supabase session cookies were issued");
const cookie = jar.map((v) => `${v.name}=${v.value}`).join("; ");
try {
  const protectedPage = await fetch(base + "/", {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.ok(
    [303, 307, 308].includes(protectedPage.status),
    "Protected page redirects to password change",
  );
  assert.ok(protectedPage.headers.get("location")?.includes("change-password"));
  const workflow = await fetch(base + "/api/workflow", {
    headers: { Cookie: cookie },
  });
  assert.equal(
    workflow.status,
    403,
    "First-login users cannot operate the workflow",
  );
  console.log(
    "PASS live HQ cookie sign-in, mandatory password change, protected-page redirect, and operation denial before setup.",
  );
} finally {
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { cookies: { getAll: () => jar, setAll: () => {} } },
  );
  await client.auth.signOut({ scope: "local" });
}
