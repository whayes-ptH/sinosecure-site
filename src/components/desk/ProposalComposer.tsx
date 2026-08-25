"use client";

import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { post, type DeskUser, type Issued, type ProjectRow } from "./deskApi";

const COVERAGE = [
  "Marine and cargo",
  "Financial guarantee",
  "Indemnity and liability",
  "Specialty risk",
  "Other",
];

/**
 * One form, one button. Sending the proposal is what opens the matter and mints the
 * access code — nobody types or invents a token, and nobody has to visit a second
 * screen to get one. If the site has no outbound mail service configured the finished
 * email opens in the underwriter's own client instead, which is often preferable:
 * the proposal then goes out from their real mailbox and lands in their sent items.
 */
export function ProposalComposer({
  user,
  mailerConfigured,
  onIssued,
}: {
  user: DeskUser;
  mailerConfigured: boolean;
  onIssued: (project: ProjectRow) => void;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "link" | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "link" ? "link" : "send";
    setBusy(intent);
    setError(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const payload = await post<Issued>(intent === "send" ? "/proposals" : "/projects", data);
      setIssued(payload);
      onIssued(payload.project);
      form.reset();
      // No mail service, or it refused: hand the finished email to the desktop client.
      if (intent === "send" && payload.mailto && !payload.delivered) {
        window.location.href = payload.mailto;
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "That could not be sent.");
    } finally {
      setBusy(null);
    }
  }

  if (issued) {
    return (
      <div className="proposal-result">
        <p className="eyebrow">{issued.delivered ? "Proposal sent" : "Proposal ready to send"}</p>
        <h2 className="desk-title">{issued.project.reference}</h2>
        <p>{issued.deliveryNote ?? "The upload link and access code below are live."}</p>

        <dl className="issued-grid">
          <div>
            <dt>Client</dt>
            <dd>{issued.project.contactEmail ?? "no address on file"}</dd>
          </div>
          <div>
            <dt>Access code</dt>
            <dd className="mono">
              {issued.accessCode}
              <CopyButton value={issued.accessCode} />
            </dd>
          </div>
          <div>
            <dt>Upload link</dt>
            <dd className="mono break">
              {issued.uploadLink}
              <CopyButton value={issued.uploadLink} label="Copy link" />
            </dd>
          </div>
        </dl>

        <pre>{issued.email?.body ?? issued.invitation}</pre>

        <div className="desk-actions">
          <CopyButton value={issued.email?.body ?? issued.invitation} label="Copy email" />
          <CopyButton value={issued.invitation} label="Copy link paragraph" />
          {issued.mailto ? (
            <a className="ghost-button" href={issued.mailto}>
              {issued.delivered ? "Open a copy in mail" : "Open in mail client"}
            </a>
          ) : null}
          <button className="button button-small" type="button" onClick={() => setIssued(null)}>
            Send another
          </button>
        </div>

        <p className="form-note">
          The access code is shown once. A replacement can be issued from the matter at any time, which retires the old
          link.
        </p>
      </div>
    );
  }

  return (
    <form className="desk-form" onSubmit={submit}>
      <p className="eyebrow">Send a proposal</p>
      <p className="form-lead">
        Fill this in once and send. The reference and the secure upload code are created as the proposal goes out —
        there is nothing to generate by hand.
      </p>

      <div className="field-row">
        <label>
          Client email
          <input name="contactEmail" type="email" required autoComplete="off" />
        </label>
        <label>
          Contact name
          <input name="contactName" autoComplete="off" />
        </label>
      </div>
      <div className="field-row">
        <label>
          Organisation
          <input name="organisation" autoComplete="off" />
        </label>
        <label>
          Coverage interest
          <select name="coverageInterest" defaultValue={COVERAGE[0]}>
            {COVERAGE.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Opening line <span className="label-hint">optional — replaces the standard wording</span>
        <textarea name="message" rows={3} placeholder="Thank you for your enquiry regarding…" />
      </label>
      <div className="field-row">
        <label>
          Link open for (days)
          <input name="expiryDays" type="number" min={1} max={365} defaultValue={90} />
        </label>
        <label>
          Internal note <span className="label-hint">not sent to the client</span>
          <input name="matterSummary" placeholder="Risk, territory, broker" autoComplete="off" />
        </label>
      </div>

      <div className="desk-actions">
        <button className="button" type="submit" value="send" disabled={busy !== null}>
          {busy === "send" ? "Sending…" : "Send proposal"}
        </button>
        {/* Same code, no email — for a link handed over on a call. */}
        <button className="ghost-button" type="submit" value="link" disabled={busy !== null}>
          {busy === "link" ? "Creating…" : "Create link only"}
        </button>
      </div>
      <p className="form-note">
        {mailerConfigured
          ? `Sent from the site's underwriting mailbox with replies going to ${user.email}.`
          : `The finished email opens in your own mail client, addressed and ready — sent from ${user.email}.`}
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
