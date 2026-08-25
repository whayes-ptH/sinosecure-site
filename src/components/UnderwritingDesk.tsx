"use client";

import { useCallback, useEffect, useState } from "react";

type ProjectRow = {
  id: number;
  reference: string;
  organisation: string | null;
  contactName: string | null;
  contactEmail: string | null;
  coverageInterest: string | null;
  status: string;
  origin: string;
  createdAt: string;
  expiresAt: string;
  lastAccessAt: string | null;
  documentCount: number;
};

type DocumentRow = {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedBy: string | null;
  note: string | null;
  completedAt: string | null;
};

type EventRow = { id: number; type: string; actor: string; detail: string | null; createdAt: string };

type Detail = {
  project: ProjectRow & { matterSummary: string | null };
  documents: DocumentRow[];
  events: EventRow[];
};

type Credentials = { accessCode: string; uploadLink: string; invitation: string };

const API = "/api/underwriting/desk";
const KEY_STORAGE = "sino-underwriting-key";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
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

export function UnderwritingDesk() {
  const [key, setKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const call = useCallback(
    async (path: string, init: RequestInit = {}, activeKey?: string): Promise<Record<string, unknown>> => {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), "x-underwriting-key": activeKey ?? key ?? "" },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "That request failed.");
      return payload;
    },
    [key],
  );

  const loadProjects = useCallback(
    async (activeKey?: string) => {
      const payload = await call("/projects", { method: "GET" }, activeKey);
      setProjects((payload.projects as ProjectRow[]) ?? []);
    },
    [call],
  );

  const signIn = useCallback(
    async (candidate: string) => {
      setBusy(true);
      setError(null);
      try {
        await call("/session", { method: "GET" }, candidate);
        await loadProjects(candidate);
        sessionStorage.setItem(KEY_STORAGE, candidate);
        setKey(candidate);
      } catch (signInError) {
        setError(signInError instanceof Error ? signInError.message : "Not authorised.");
      } finally {
        setBusy(false);
      }
    },
    [call, loadProjects],
  );

  useEffect(() => {
    const stored = sessionStorage.getItem(KEY_STORAGE);
    if (stored) void signIn(stored);
    // Restoring the stored key runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openMatter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const payload = await call("/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      setCredentials({
        accessCode: payload.accessCode as string,
        uploadLink: payload.uploadLink as string,
        invitation: payload.invitation as string,
      });
      setProjects((current) => [payload.project as ProjectRow, ...current]);
      setCreating(false);
      form.reset();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The matter could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: number) {
    setBusy(true);
    setError(null);
    try {
      setDetail((await call(`/projects/${id}`, { method: "GET" })) as unknown as Detail);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "That matter could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: number, status: string) {
    await call(`/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setProjects((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
    setDetail((current) => (current && current.project.id === id ? { ...current, project: { ...current.project, status } } : current));
  }

  async function rotate(id: number) {
    const payload = await call(`/projects/${id}/rotate`, { method: "POST" });
    setCredentials({
      accessCode: payload.accessCode as string,
      uploadLink: payload.uploadLink as string,
      invitation: payload.invitation as string,
    });
  }

  /** Documents are fetched with the console key attached, then handed to the browser. */
  async function download(document: DocumentRow) {
    setError(null);
    try {
      const response = await fetch(`${API}/documents/${document.id}`, {
        headers: { "x-underwriting-key": key ?? "" },
      });
      if (!response.ok) throw new Error("That document could not be downloaded.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "That document could not be downloaded.");
    }
  }

  if (!key) {
    return (
      <div className="desk-gate">
        <p className="eyebrow">Sino Secure</p>
        <h1 className="desk-title">Underwriting console</h1>
        <p>Open matters, issue upload codes and collect submitted documents.</p>
        <form
          className="code-form"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(keyInput);
          }}
        >
          <label>
            Console key
            <input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} autoComplete="current-password" required />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <p className="eyebrow">Underwriting console</p>
          <h1 className="desk-title">Matters</h1>
        </div>
        <div className="desk-actions">
          <button className="button button-small" type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cancel" : "Open a matter"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              sessionStorage.removeItem(KEY_STORAGE);
              setKey(null);
              setKeyInput("");
              setProjects([]);
              setDetail(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {credentials ? (
        <div className="credentials">
          <p className="eyebrow">Send this with the proposal</p>
          <p className="mono">{credentials.accessCode}</p>
          <p className="mono break">{credentials.uploadLink}</p>
          <pre>{credentials.invitation}</pre>
          <div className="desk-actions">
            <CopyButton value={credentials.invitation} label="Copy invitation" />
            <CopyButton value={credentials.uploadLink} label="Copy link" />
            <button className="ghost-button" type="button" onClick={() => setCredentials(null)}>
              Dismiss
            </button>
          </div>
          <p className="form-note">
            The access code is shown once. Dismiss this panel only after it has been copied — it cannot be retrieved
            later, though a replacement can be issued.
          </p>
        </div>
      ) : null}

      {creating ? (
        <form className="desk-form" onSubmit={openMatter}>
          <div className="field-row">
            <label>
              Organisation
              <input name="organisation" />
            </label>
            <label>
              Contact name
              <input name="contactName" />
            </label>
          </div>
          <div className="field-row">
            <label>
              Contact email
              <input name="contactEmail" type="email" />
            </label>
            <label>
              Coverage interest
              <select name="coverageInterest" defaultValue="Marine and cargo">
                <option>Marine and cargo</option>
                <option>Financial guarantee</option>
                <option>Indemnity and liability</option>
                <option>Specialty risk</option>
                <option>Other</option>
              </select>
            </label>
          </div>
          <div className="field-row">
            <label>
              Link open for (days)
              <input name="expiryDays" type="number" min={1} max={365} defaultValue={90} />
            </label>
            <label>
              Internal note
              <input name="matterSummary" placeholder="Risk, territory, broker" />
            </label>
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open matter and issue code"}
          </button>
        </form>
      ) : null}

      <table className="desk-table">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Client</th>
            <th>Coverage</th>
            <th>Files</th>
            <th>Status</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td className="mono">{project.reference}</td>
              <td>
                {project.organisation ?? project.contactName ?? "—"}
                {project.contactEmail ? <small>{project.contactEmail}</small> : null}
              </td>
              <td>{project.coverageInterest ?? "—"}</td>
              <td>{project.documentCount}</td>
              <td>
                <span className={`status-pill status-${project.status}`}>{project.status.replace("_", " ")}</span>
              </td>
              <td>{formatDate(project.expiresAt)}</td>
              <td>
                <button className="ghost-button" type="button" onClick={() => void openDetail(project.id)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
          {!projects.length ? (
            <tr>
              <td colSpan={7}>No matters yet. Open one to issue an upload code.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {detail ? (
        <div className="desk-detail">
          <div className="matter-head">
            <div>
              <p className="eyebrow">{detail.project.reference}</p>
              <h2 className="desk-title">{detail.project.organisation ?? detail.project.contactName ?? "Matter"}</h2>
              <p className="matter-meta">
                {detail.project.contactEmail ?? "no email on file"} · opened {formatDate(detail.project.createdAt)} ·
                last client access {formatDate(detail.project.lastAccessAt)}
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>

          {detail.project.matterSummary ? <p className="matter-summary">{detail.project.matterSummary}</p> : null}

          <div className="desk-actions">
            <select
              value={detail.project.status}
              onChange={(event) => void setStatus(detail.project.id, event.target.value)}
              aria-label="Matter status"
            >
              <option value="open">open</option>
              <option value="in_review">in review</option>
              <option value="closed">closed</option>
            </select>
            <button className="ghost-button" type="button" onClick={() => void rotate(detail.project.id)}>
              Issue a new access code
            </button>
          </div>

          <h3>Documents</h3>
          {detail.documents.length ? (
            <ul className="document-list">
              {detail.documents.map((document) => (
                <li key={document.id}>
                  <span>
                    {document.fileName}
                    {document.note ? <em> — {document.note}</em> : null}
                  </span>
                  <small>
                    {formatBytes(document.sizeBytes)} · {formatDate(document.completedAt)}
                    {document.uploadedBy ? ` · ${document.uploadedBy}` : ""}
                  </small>
                  <button className="ghost-button" type="button" onClick={() => void download(document)}>
                    Download
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No documents received yet.</p>
          )}

          <h3>Audit trail</h3>
          <ul className="audit-list">
            {detail.events.map((event) => (
              <li key={event.id}>
                <span className="mono">{event.type}</span>
                <span>{event.detail ?? event.actor}</span>
                <small>{formatDate(event.createdAt)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
