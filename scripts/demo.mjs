// An isolated local preview. Never change the user's .env.local or port 3000.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const env = {
  ...process.env,
  NEXT_PUBLIC_DEMO_MODE: "true",
  SUPPLYLINK_BUILD_DIR: ".next-demo",
  SUPPLYLINK_DEMO_DATA_DIR: path.join(root, ".data", "catalog-demo"),
};
const port = process.env.SUPPLYLINK_DEMO_PORT || "3100";
async function run(args) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (code !== 0) process.exit(typeof code === "number" ? code : 1);
}
await run(["build"]);
console.log(`SupplyLink local demo: http://127.0.0.1:${port}/sme/login`);
console.log(
  "Sample accounts: myathida (SME), hq.admin (HQ), zawmin (driver), branch.hlaing (branch).",
);
console.log("Demo password: SttDemo-2026! — only accepted by the local demo.");
await run(["start", "--hostname", "127.0.0.1", "--port", port]);
