"use client";

import { useState } from "react";
import { DeskError, post, type DeskUser, type NotificationConfiguration } from "./deskApi";

type GateState = { needsSetup: boolean; bootstrapReady: boolean };
type SignedIn = {
  user: DeskUser;
  mailerConfigured?: boolean;
  notifications?: NotificationConfiguration;
};

/**
 * The way in. On a brand-new site this creates the first super administrator using the
 * one-time setup key; from then on it is an ordinary email and password sign-in.
 */
export function DeskGate({
  gate,
  onSignedIn,
}: {
  gate: GateState;
  onSignedIn: (status: SignedIn) => void;
}) {
  const [mode, setMode] = useState<"signIn" | "setup">(gate.needsSetup ? "setup" : "signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;

    try {
      if (mode === "setup" && data.password !== data.confirmPassword) {
        throw new DeskError("Those two passwords do not match.", 400);
      }
      const payload = await post<SignedIn>(mode === "setup" ? "/auth/setup" : "/auth/login", data);
      onSignedIn(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk-gate">
      <p className="eyebrow">Sino Secure</p>
      <h1 className="desk-title">Underwriting console</h1>

      {mode === "setup" ? (
        <>
          <p>
            First-time setup. Create the super-administrator account that will run the console and add the rest of the team.
          </p>
          {!gate.bootstrapReady ? (
            <p className="form-error" role="alert">
              Set UNDERWRITING_ADMIN_KEY in the Netlify environment (at least 16 characters) and redeploy, then create
              the super administrator here. It is asked for once and never again.
            </p>
          ) : null}
          <form className="desk-form-plain" onSubmit={submit}>
            <label>
              Setup key
              <input name="adminKey" type="password" autoComplete="off" required />
            </label>
            <label>
              Your name
              <input name="name" autoComplete="name" required />
            </label>
            <label>
              Your email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              Repeat password
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <p className="form-note">At least 12 characters. This becomes your day-to-day sign-in.</p>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create super administrator"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p>Sign in to send proposals, issue upload links and collect submitted documents.</p>
          <form className="desk-form-plain" onSubmit={submit}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Sign in"}
            </button>
          </form>
        </>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {gate.needsSetup && mode === "signIn" ? (
        <p className="form-note">
          <button className="link-button" type="button" onClick={() => setMode("setup")}>
            Set the console up instead
          </button>
        </p>
      ) : null}
      {mode === "setup" && !gate.needsSetup ? (
        <p className="form-note">
          <button className="link-button" type="button" onClick={() => setMode("signIn")}>
            Back to sign in
          </button>
        </p>
      ) : null}
    </div>
  );
}
