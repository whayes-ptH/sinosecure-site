"use client";

import { useState } from "react";
import { SecureUploadPanel } from "./SecureUploadPanel";

type Issued = {
  reference: string;
  accessCode: string;
  uploadLink: string;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-button"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function UnderwritingPortal() {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoUnlock, setAutoUnlock] = useState(false);

  async function submitEnquiry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    try {
      const response = await fetch("/api/underwriting/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We could not record that enquiry.");
      const project = payload.project as { reference: string } | undefined;
      if (!project) throw new Error("We could not record that enquiry. Please email us directly.");

      // Mirror the enquiry into Netlify Forms from the browser so it keeps the
      // visitor's own address, the honeypot and the desk's existing notifications.
      void fetch("/__forms.html", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "form-name": "sino-underwriting",
          name: data.name ?? "",
          email: data.email ?? "",
          company: data.company ?? "",
          interest: data.interest ?? "",
          message: `${data.message ?? ""}\n\n— Secure upload reference ${project.reference}`,
          "company-website": data["company-website"] ?? "",
        }).toString(),
      }).catch(() => undefined);

      setIssued({
        reference: project.reference,
        accessCode: payload.accessCode as string,
        uploadLink: payload.uploadLink as string,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not record that enquiry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="page-hero" id="enquiry">
        <div className="container contact-layout">
          <div>
            <p className="eyebrow">Underwriting enquiry</p>
            <h1>Give us the risk in context.</h1>
            <p className="lead">
              Share the exposure, territories and timing. We will respond with the right next questions — and a secure
              place to send the paperwork.
            </p>
            <div className="contact-details">
              <p>
                <strong>Australia office</strong>
                <br />
                Suite 7, 334 Highbury Road
                <br />
                Mount Waverley VIC 3149
              </p>
              <p>
                <strong>Office hours</strong>
                <br />
                Monday–Friday
                <br />
                9:00–17:00 AEST
              </p>
            </div>
          </div>

          {issued ? (
            <div className="contact-form issued-panel">
              <p className="eyebrow">Enquiry received</p>
              <h2 className="issued-title">Your reference is open.</h2>
              <p>
                Keep the access code below. It unlocks the secure upload portal for this matter and is the only way back
                in — we cannot recover it for you.
              </p>
              <dl className="issued-grid">
                <div>
                  <dt>Underwriting reference</dt>
                  <dd className="mono">{issued.reference}</dd>
                </div>
                <div>
                  <dt>Access code</dt>
                  <dd className="mono">
                    {issued.accessCode}
                    <CopyButton value={issued.accessCode} label="Copy" />
                  </dd>
                </div>
                <div>
                  <dt>Direct upload link</dt>
                  <dd className="mono break">
                    {issued.uploadLink}
                    <CopyButton value={issued.uploadLink} label="Copy" />
                  </dd>
                </div>
              </dl>
              <a
                className="button"
                href="#secure-upload"
                onClick={() => setAutoUnlock(true)}
              >
                Upload documents now <span aria-hidden="true">↓</span>
              </a>
              <p className="form-note">
                Submitting this form does not bind coverage. This acknowledgement confirms receipt only.
              </p>
            </div>
          ) : (
            <form className="contact-form" onSubmit={submitEnquiry}>
              <p className="hidden-field">
                <label>
                  Do not fill this out: <input name="company-website" tabIndex={-1} autoComplete="off" />
                </label>
              </p>
              <div className="field-row">
                <label>
                  Full name
                  <input required name="name" autoComplete="name" />
                </label>
                <label>
                  Business email
                  <input required name="email" type="email" autoComplete="email" />
                </label>
              </div>
              <div className="field-row">
                <label>
                  Company
                  <input name="company" autoComplete="organization" />
                </label>
                <label>
                  Coverage interest
                  <select name="interest" defaultValue="Marine and cargo">
                    <option>Marine and cargo</option>
                    <option>Financial guarantee</option>
                    <option>Indemnity and liability</option>
                    <option>Specialty risk</option>
                    <option>Other</option>
                  </select>
                </label>
              </div>
              <label>
                Risk or opportunity
                <textarea
                  required
                  name="message"
                  rows={6}
                  placeholder="Please include territories, timing and an indicative exposure where appropriate."
                />
              </label>
              <button className="button" type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Request a response"} <span aria-hidden="true">↗</span>
              </button>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <p className="form-note">
                Submitting this form does not bind coverage. Please do not include highly sensitive personal information
                here — send documents through the secure portal below.
              </p>
            </form>
          )}
        </div>
      </section>

      <section className="section secure-section" id="secure-upload">
        <div className="container secure-layout">
          <div className="secure-intro">
            <p className="eyebrow">Document submission</p>
            <h2>A single, tracked channel for the package.</h2>
            <p>
              Every enquiry is assigned an underwriting reference and an access code. Documents uploaded against that
              code stay bound to the matter, so nothing is reconciled by hand and nothing travels as an email
              attachment.
            </p>
            <ol className="secure-steps">
              <li>
                <span>01</span>
                <div>
                  <h3>We issue the reference</h3>
                  <p>Raised the moment you enquire, or sent with your proposal when we open the file at our end.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h3>You upload the package</h3>
                  <p>
                    Financials, surveys, contracts, bills of lading, schedules. Large files are sent in parts and
                    checksummed on arrival.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h3>We revert</h3>
                  <p>
                    Once we have reviewed a complete set of documents we come back with any clarifying questions and an
                    indicative term sheet or consideration proposal.
                  </p>
                </div>
              </li>
            </ol>
          </div>
          <SecureUploadPanel initialCode={issued?.accessCode ?? ""} autoUnlock={autoUnlock} enquiryHref="#enquiry" />
        </div>
      </section>
    </>
  );
}
