import { z } from "zod";
import type { Role } from "./domain";

export const loginPortals = ["hq", "sme", "driver", "branch"] as const;
export type LoginPortal = (typeof loginPortals)[number];
export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(100)
    .regex(/^[^@\p{Cc}]+$/u),
  password: z.string().min(1).max(128),
});
export function portalHome(role: Role) {
  return role !== "hq" ? `/${role}` : "/";
}
export function portalLogin(role: Role) {
  return `/${role}/login`;
}
export function workspaceHref(role: Role, section: string, demo = false) {
  if (role !== "hq")
    return section === "overview" ? `/${role}` : `/${role}/${section}`;
  return `${section === "overview" ? "/" : `/${section}`}${demo ? `?role=${role}` : ""}`;
}
