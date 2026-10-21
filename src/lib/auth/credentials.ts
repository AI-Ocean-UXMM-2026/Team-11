import { randomBytes } from "node:crypto";

// Generated only by server provisioning; returned once to the authorized HQ caller.
export function generateTemporaryPassword() {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}
