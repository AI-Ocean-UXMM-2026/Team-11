import "server-only";
import { cookies } from "next/headers";
import { demoDirectory } from "./demo-directory";
export const DEMO_COOKIE = "supplylink_demo_session";
export async function getDemoSession() {
  return demoDirectory().session((await cookies()).get(DEMO_COOKIE)?.value);
}
export async function getDemoToken() {
  return (await cookies()).get(DEMO_COOKIE)?.value;
}
