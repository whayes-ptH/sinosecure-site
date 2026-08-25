"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";
import {
  call,
  formatDate,
  patch,
  post,
  type DeskUser,
  type NotificationConfiguration,
  type TeamMember,
} from "./deskApi";

type Handover = { name: string; email: string; password: string };

/**
 * The admin surface. Colleagues are added here and sign in with their own details,
 * so proposals can be traced to the person who sent them and access can be withdrawn
 * without changing anything the rest of the team relies on.
 */
export function TeamView({
  user,
  notifications,
  onError,
}: {
  user: DeskUser;
  notifications: NotificationConfiguration | null;
  onError: (message: string | null) => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await call<{ users: TeamMember[] }>("/users");
      setMembers(payload.users ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The team could not be loaded.");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    try {
      const payload = await post<{ user: TeamMember; temporaryPassword: string }>("/users", data);
      setMembers((current) => [...current, payload.user].sort((a, b) => a.name.localeCompare(b.name)));
      setHandover({ name: payload.user.name, email: payload.user.email, password: payload.temporaryPassword });
      setAdding(false);
      form.reset();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That colleague could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function update(member: TeamMember, body: Record<string, unknown>) {
    onError(null);
    try {
      const payload = await patch<{ temporaryPassword?: string }>(`/users/${member.id}`, body);
      if (payload.temporaryPassword) {
        setHandover({ name: member.name, email: member.email, password: payload.temporaryPassword });
      }
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "That change could not be saved.");
    }
  }

  return (
    <>
      <section className="desk-form" aria-labelledby="notification-routing-title">
        <p className="eyebrow">Email routing</p>
        <h2 id="notification-routing-title" className="settings-title">Underwriting notifications</h2>
        <dl className="settings-grid">
          <div>
            <dt>Application recipient</dt>
            <dd>{notifications?.recipient ?? "Not configured"}</dd>
          </div>
          <div>
            <dt>Direct delivery</dt>
            <dd>{notifications?.directEmailReady ? "Ready" : "Not configured"}</dd>
          </div>
          <div>
            <dt>Netlify Forms archive</dt>
            <dd>{notifications?.formsArchiveEnabled ? "Enabled" : "Unknown"}</dd>
          </div>
        </dl>
        <p className="form-note">
          The application recipient comes from UNDERWRITING_NOTIFY_EMAIL. Any additional notification address set in
          Netlify Forms is controlled in the Netlify dashboard and cannot be read from this repository.
        </p>
      </section>

      {handover ? (
        <div className="credentials">
          <p className="eyebrow">One-time password for {handover.name}</p>
          <p className="mono">
            {handover.password}
            <CopyButton value={handover.password} />
          </p>
          <p className="form-note">
            Pass this to {handover.email} by whatever means you would use for any other credential. They will be asked
            to choose their own password the first time they sign in, and this one stops working. It is shown once.
          </p>
          <div className="desk-actions">
            <button className="ghost-button" type="button" onClick={() => setHandover(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="desk-actions">
        <button className="button button-small" type="button" onClick={() => setAdding((value) => !value)}>
          {adding ? "Cancel" : "Add a colleague"}
        </button>
      </div>

      {adding ? (
        <form className="desk-form" onSubmit={addMember}>
          <div className="field-row">
            <label>
              Name
              <input name="name" required autoComplete="off" />
            </label>
            <label>
              Email
              <input name="email" type="email" required autoComplete="off" />
            </label>
          </div>
          <label>
            Role
            <select name="role" defaultValue="staff">
              <option value="staff">Staff — sends proposals and reviews documents</option>
              <option value="admin">Administrator — manages underwriting matters</option>
              <option value="super_admin">Super administrator — also manages users and settings</option>
            </select>
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add and issue a password"}
          </button>
        </form>
      ) : null}

      <table className="desk-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Access</th>
            <th>Last sign-in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>
                {member.name}
                <small>{member.email}</small>
              </td>
              <td>
                {member.id === user.id ? (
                  <span className={`status-pill role-${member.role}`}>{member.role.replace("_", " ")}</span>
                ) : (
                  <select
                    value={member.role}
                    aria-label={`Role for ${member.name}`}
                    onChange={(event) => void update(member, { role: event.target.value })}
                  >
                    <option value="staff">staff</option>
                    <option value="admin">administrator</option>
                    <option value="super_admin">super administrator</option>
                  </select>
                )}
              </td>
              <td>
                {member.status === "active" ? "active" : "disabled"}
                {member.mustChangePassword ? <small>password not yet set</small> : null}
              </td>
              <td>{formatDate(member.lastLoginAt)}</td>
              <td className="row-actions">
                {/* Your own credentials, role and access are handled outside this table
                    so nobody locks the active super administrator out mid-session. */}
                {member.id === user.id ? null : (
                  <>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void update(member, { resetPassword: true })}
                    >
                      Reset password
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void update(member, { status: member.status === "active" ? "disabled" : "active" })}
                    >
                      {member.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="form-note">
        Only a super administrator can add or change users. Disabling an account signs it out everywhere immediately;
        its matters and audit trail are retained. Every active console user can create a customer token or send a
        proposal from the Send proposal screen.
      </p>
    </>
  );
}
