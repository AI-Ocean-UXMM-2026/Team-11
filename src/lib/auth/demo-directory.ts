import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { demoData } from "../demo-data";
import { accountSchema, type Account, type Role } from "../domain";
import { DEMO_PASSWORD } from "./demo-presets";
import { generateTemporaryPassword } from "./credentials";

type DemoUser = Account & { mustChangePassword: boolean; phone: string };
type SecretUser = DemoUser & { salt: string; hash: Buffer };
const publicUser = ({
  hash: _hash,
  salt: _salt,
  ...user
}: SecretUser): DemoUser => ({ ...user });

/** Process-local demo adapter. Supabase remains the only live persistence layer. */
export class DemoDirectory {
  private users = new Map<string, SecretUser>();
  private sessions = new Map<string, { userId: string; expires: number }>();
  private failures = new Map<string, { count: number; expires: number }>();
  constructor() {
    const seeds: Account[] = [
      {
        id: "demo-branch",
        name: "Nandar Win",
        username: "branch.hlaing",
        role: "branch",
        status: "Active",
        affiliation: "Hlaing branch",
      },
      {
        id: "demo-hq",
        name: "Aye Chan",
        username: "hq.admin",
        role: "hq",
        status: "Active",
        affiliation: "Ocean Pride Longyi HQ",
      },
      ...demoData.accounts.map((a, i) => ({
        ...a,
        id: ["demo-sme", "demo-sme-other", "demo-driver", "demo-driver-other"][
          i
        ],
      })),
    ];
    for (const user of seeds)
      this.add(
        { ...user, mustChangePassword: false, phone: "" },
        DEMO_PASSWORD,
      );
  }
  private add(user: DemoUser, password: string) {
    const salt = randomBytes(16).toString("hex");
    this.users.set(user.username, {
      ...user,
      salt,
      hash: scryptSync(password, salt, 64),
    });
  }
  listAccounts(): Account[] {
    return [...this.users.values()]
      .filter((u) => u.role !== "hq")
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        status: u.status,
        affiliation: u.affiliation,
        branchId: u.branchId,
      }));
  }
  workflowUsers(): DemoUser[] {
    return [...this.users.values()].map(publicUser);
  }
  authenticate(
    portal: Role,
    username: string,
    password: string,
  ): { status: number; error?: string; token?: string; user?: DemoUser } {
    const identifier = username.trim().toLowerCase();
    const byId = this.users.get(identifier);
    const names = byId
      ? []
      : [...this.users.values()].filter(
          (u) => u.role === portal && u.name.toLowerCase() === identifier,
        );
    const user = byId ?? (names.length === 1 ? names[0] : undefined);
    const key = `${portal}:${user?.username ?? identifier}`;
    const now = Date.now();
    const attempts = this.failures.get(key);
    if (attempts && attempts.expires > now && attempts.count >= 8)
      return {
        status: 429,
        error: "Too many attempts. Try again in 15 minutes.",
      };
    // Always derive a hash to avoid a cheap account-existence timing signal.
    const hash = scryptSync(password, user?.salt ?? "missing-account-salt", 64);
    const valid =
      user &&
      timingSafeEqual(hash, user.hash) &&
      user.status === "Active" &&
      user.role === portal;
    if (!valid) {
      if (this.failures.size >= 1000)
        this.failures.delete(this.failures.keys().next().value!);
      this.failures.set(key, {
        count: attempts && attempts.expires > now ? attempts.count + 1 : 1,
        expires:
          attempts && attempts.expires > now
            ? attempts.expires
            : now + 15 * 60 * 1000,
      });
      return {
        status: 401,
        error:
          "These credentials do not match an active account in this portal. If your name is shared, use your account ID.",
      };
    }
    this.failures.delete(key);
    for (const [token, session] of this.sessions)
      if (session.expires <= now) this.sessions.delete(token);
    if (this.sessions.size >= 1000)
      this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, {
      userId: user.id,
      expires: now + 8 * 60 * 60 * 1000,
    });
    return { status: 200, token, user: publicUser(user) };
  }
  session(token?: string): DemoUser | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expires <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    const user = [...this.users.values()].find((u) => u.id === session.userId);
    return user?.status === "Active" ? publicUser(user) : null;
  }
  signOut(token?: string) {
    if (token) this.sessions.delete(token);
  }
  provision(
    token: string | undefined,
    input: unknown,
  ): {
    error?: string;
    id?: string;
    username?: string;
    temporaryPassword?: string;
  } {
    const actor = this.session(token);
    if (actor?.role !== "hq" || actor.mustChangePassword)
      return {
        error: "Sign in to the HQ portal before issuing login credentials.",
      };
    const parsed = accountSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    if (this.users.size >= 1000)
      return {
        error:
          "Demo account limit reached. Restart the demo to reset sample accounts.",
      };
    const id = randomUUID();
    const temporaryPassword = generateTemporaryPassword();
    this.add(
      {
        id,
        name: v.name,
        username: id,
        role: v.role,
        status: "Active",
        affiliation: "",
        address: v.address,
        phone: v.phone,
        pin: v.pin,
        branchId: v.branchId || null,
        mustChangePassword: true,
      },
      temporaryPassword,
    );
    return { id, username: id, temporaryPassword };
  }
  changePassword(
    token: string | undefined,
    password: string,
  ): { error?: string } {
    const viewer = this.session(token);
    if (!viewer) return { error: "Sign in again." };
    if (password.length < 12 || password.length > 128)
      return { error: "Use 12–128 characters." };
    const user = this.users.get(viewer.username)!;
    if (timingSafeEqual(scryptSync(password, user.salt, 64), user.hash))
      return {
        error: "Choose a different password from your temporary password.",
      };
    this.add({ ...viewer, mustChangePassword: false }, password);
    for (const [key, value] of this.sessions)
      if (value.userId === viewer.id && key !== token)
        this.sessions.delete(key);
    return {};
  }
}
const state = globalThis as typeof globalThis & {
  supplylinkDemoDirectory?: DemoDirectory;
};
export function demoDirectory() {
  const directory = (state.supplylinkDemoDirectory ??= new DemoDirectory());
  // Next.js keeps global state through hot reload. Adopt the current methods
  // so retained instances cannot validate new requests with an obsolete schema.
  // Keep their account/session maps intact instead of resetting demo logins.
  if (Object.getPrototypeOf(directory) !== DemoDirectory.prototype)
    Object.setPrototypeOf(directory, DemoDirectory.prototype);
  return directory;
}
