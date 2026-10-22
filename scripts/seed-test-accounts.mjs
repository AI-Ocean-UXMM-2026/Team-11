// Create loginable test accounts on a fresh, dedicated Supabase test project.
// This never targets the configured SupplyLink project or replaces existing users.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SEED_TEST_ACCOUNTS !== "true") {
  throw new Error("Set SEED_TEST_ACCOUNTS=true to confirm test-account setup.");
}
if (!url || !key)
  throw new Error("Configure the test Supabase URL and service key first.");

const projectRef = new URL(url).hostname.split(".")[0];
if (projectRef === "mtgqcmfnbubhlcxuhtpu") {
  throw new Error(
    "Refusing to seed test accounts into the configured SupplyLink project.",
  );
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: existingProfiles, error: profileLookupError } = await admin
  .from("profiles")
  .select("id,username,name,role,status");
if (profileLookupError)
  throw new Error("Could not verify that migrations are applied.");
if (
  existingProfiles.length > 1 ||
  existingProfiles.some(
    (profile) => profile.role !== "hq" || profile.status !== "active",
  )
) {
  throw new Error(
    "Test account setup supports an empty profiles table or one active HQ profile.",
  );
}
const existingHq = existingProfiles[0] ?? null;

const branchNames = [
  "TEST Yangon Central",
  "TEST Yangon East",
  "TEST Yangon West",
  "TEST Yangon North",
];
const { data: branches, error: branchError } = await admin
  .from("branches")
  .select("id,name")
  .in("name", branchNames)
  .order("name");
if (branchError || branches?.length !== branchNames.length) {
  throw new Error(
    "Apply the test workspace migration before creating accounts.",
  );
}

const accounts = [
  ...(!existingHq
    ? [
        {
          username: "hq.test",
          name: "Test Headquarters",
          role: "hq",
          portal: "hq",
        },
      ]
    : []),
  {
    username: "sme.test01",
    name: "Test SME 01",
    role: "sme",
    portal: "sme",
    address: "TEST Yangon Central",
  },
  {
    username: "sme.test02",
    name: "Test SME 02",
    role: "sme",
    portal: "sme",
    address: "TEST Yangon East",
  },
  {
    username: "sme.test03",
    name: "Test SME 03",
    role: "sme",
    portal: "sme",
    address: "TEST Yangon West",
  },
  ...branches.flatMap((branch, index) => [
    {
      username: `branch.test0${index + 1}`,
      name: `Test Branch Staff 0${index + 1}`,
      role: "branch",
      portal: "branch",
      branch_id: branch.id,
    },
  ]),
  ...Array.from({ length: 3 }, (_, index) => ({
    username: `driver.hq0${index + 1}`,
    name: `Test HQ Driver 0${index + 1}`,
    role: "driver",
    portal: "driver",
    branch_id: null,
  })),
  ...branches.flatMap((branch, branchIndex) =>
    Array.from({ length: 2 }, (_, driverIndex) => ({
      username: `driver.branch0${branchIndex + 1}.0${driverIndex + 1}`,
      name: `Test Driver ${branchIndex + 1}-0${driverIndex + 1}`,
      role: "driver",
      portal: "driver",
      branch_id: branch.id,
    })),
  ),
];

const password = "Longyi-Test-2026!";
const created = [];
const credentialsPath = path.join(
  process.cwd(),
  ".data",
  `test-accounts-${projectRef}.txt`,
);
try {
  for (const account of accounts) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${account.username}@login.supplylink.invalid`,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `Could not create Auth user ${account.username}: ${error?.message ?? "no user returned"}`,
      );
    }
    created.push({ id: data.user.id, username: account.username });

    const { error: profileError } = await admin.from("profiles").insert({
      id: data.user.id,
      username: account.username,
      name: account.name,
      role: account.role,
      status: "active",
      branch_id: account.branch_id ?? null,
      address: account.address ?? "",
      must_change_password: false,
    });
    if (profileError)
      throw new Error(
        `Could not create profile ${account.username}: ${profileError.message}`,
      );
  }

  await mkdir(path.dirname(credentialsPath), { recursive: true });
  await writeFile(
    credentialsPath,
    [
      "Dedicated Supabase test database accounts",
      `Project: ${projectRef}`,
      "Shared test-only password: Longyi-Test-2026!",
      "Change or delete these accounts before using the project for real data.",
      "",
      ...(existingHq
        ? [
            `HQ  ${existingHq.username}  Use its existing HQ password (not changed by this script).`,
          ]
        : []),
      ...accounts.map(
        (account) =>
          `${account.portal.toUpperCase()}  ${account.username}  Longyi-Test-2026!`,
      ),
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `Created ${accounts.length} test accounts. Credentials saved to ${credentialsPath}`,
  );
} catch (error) {
  for (const account of created.reverse()) {
    await admin.from("profiles").delete().eq("id", account.id);
    await admin.auth.admin.deleteUser(account.id);
  }
  throw error;
}
