"use client";

import { useState } from "react";
import { DeskError, post, type DeskUser } from "./deskApi";

export function AccountView({ user, onUpdated }: { user: DeskUser; onUpdated: (user: DeskUser) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    try {
      if (data.newPassword !== data.confirmPassword) throw new DeskError("Those two passwords do not match.", 400);
      await post("/auth/password", { currentPassword: data.currentPassword, newPassword: data.newPassword });
      onUpdated({ ...user, mustChangePassword: false });
      setDone(true);
      form.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="desk-form" onSubmit={submit}>
      <p className="eyebrow">{user.mustChangePassword ? "Choose your password" : "Your account"}</p>
      <p className="form-lead">
        {user.mustChangePassword
          ? "Set a password of your own before you start. The one you were given stops working."
          : `Signed in as ${user.name} · ${user.email}`}
      </p>
      <label>
        {user.mustChangePassword ? "The password you were given" : "Current password"}
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <div className="field-row">
        <label>
          New password
          <input name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <label>
          Repeat new password
          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
        </label>
      </div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Change password"}
      </button>
      <p className="form-note">
        At least 12 characters. Changing it signs out every other browser you are signed in on.
      </p>
      {done ? <p className="form-success">Password changed.</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
