"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, ShieldCheck, Truck, Store } from "lucide-react";
import { changePassword } from "@/app/actions";
import { DEMO_PASSWORD, demoUsernames } from "@/lib/auth/demo-presets";
import type { LoginPortal } from "@/lib/portals";

export function AuthForm({
  change = false,
  demo = false,
  portal = "hq",
}: {
  change?: boolean;
  demo?: boolean;
  portal?: LoginPortal;
}) {
  return change ? (
    <PasswordForm />
  ) : (
    <PortalLoginForm demo={demo} portal={portal} />
  );
}
function PortalLoginForm({
  demo,
  portal,
}: {
  demo: boolean;
  portal: LoginPortal;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const label = {
    hq: "Headquarters",
    sme: "SME",
    driver: "Driver",
    branch: "Branch",
  }[portal];
  const PortalIcon =
    portal === "driver" ? Truck : portal === "sme" ? Store : ShieldCheck;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${portal}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Unable to sign in. Try again.");
        setPending(false);
        return;
      }
      // The server returns only internal, role-derived destinations.
      if (
        typeof result.redirectTo !== "string" ||
        !result.redirectTo.startsWith("/") ||
        result.redirectTo.startsWith("//")
      )
        throw new Error("Invalid destination");
      window.location.assign(result.redirectTo);
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <span className="portal-icon">
        <PortalIcon size={24} aria-hidden="true" />
      </span>
      <span className="auth-brand-label">STT footwear supplier</span>
      <h1>{label} sign in</h1>
      <p>
        {portal === "sme"
          ? "Order STT shoes, follow deliveries and keep your shop moving."
          : portal === "driver"
            ? "Your assigned deliveries and handovers, in one place."
            : portal === "branch"
              ? "Your branch stock, refills, retail sales and assigned deliveries."
            : "Manage your STT stock, branches and business accounts."}
      </p>
      <div className="auth-issued-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          {portal === "hq"
            ? "Use your authorised headquarters account."
            : "Use the account ID and temporary password provided by HQ. There is no public sign-up."}
        </span>
      </div>
      <label className="field">
        Account ID
        <input
          name="username"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your HQ-issued account ID"
          aria-describedby={error ? "login-error" : undefined}
        />
      </label>
      <label className="field">
        Password
        <span className="password-input">
          <input
            name="password"
            aria-label="Password"
            required
            type={visible ? "text" : "password"}
            maxLength={128}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? "login-error" : undefined}
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? "Hide password" : "Show password"}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      {error && (
        <p id="login-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Signing in…" : `Sign in to ${label}`}
      </button>
      <small>Need credentials or a password reset? Contact headquarters.</small>
      {demo && (
        <div className="demo-credentials">
          <strong>Local demo credentials</strong>
          <span>Account ID: {demoUsernames[portal]}</span>
          <span>Password: {DEMO_PASSWORD}</span>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setUsername(demoUsernames[portal]);
              setPassword(DEMO_PASSWORD);
            }}
          >
            Use sample credentials
          </button>
          <small>
            HQ-created demo accounts also work until the server restarts.
          </small>
        </div>
      )}
      <div className="portal-links">
        <Link href="/login">Choose another portal</Link>
      </div>
    </form>
  );
}
function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {
    error: "",
  });
  return (
    <form className="auth-form" action={action}>
      <span className="portal-icon">
        <ShieldCheck size={24} />
      </span>
      <h1>Make this account yours.</h1>
      <p>
        Change your HQ-issued temporary password before entering your portal.
      </p>
      <label className="field">
        New password
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
        <small>
          Use at least 12 characters and choose a different password.
        </small>
      </label>
      <label className="field">
        Confirm new password
        <input
          name="confirm"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? "Saving password…" : "Save password & continue"}
      </button>
    </form>
  );
}
