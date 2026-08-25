"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";
import {
  API,
  call,
  formatBytes,
  formatDate,
  patch,
  post,
  type DocumentRow,
  type Issued,
  type MatterDetail,
  type ProjectRow,
} from "./deskApi";

export function MattersView({
  projects,
  onProjects,
  onError,
}: {
  projects: ProjectRow[];
  onProjects: (rows: ProjectRow[]) => void;
  onError: (message: string | null) => void;
}) {
  const [detail, setDetail] = useState<MatterDetail | null>(null);
  const [reissued, setReissued] = useState<Issued | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await call<{ projects: ProjectRow[] }>("/projects");
      onProjects(payload.projects ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The matters could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [onError, onProjects]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: number) {
    onError(null);
    try {
      setDetail(await call<MatterDetail>(`/projects/${id}`));
    } catch (error) {
      onError(error instanceof Error ? error.message : "That matter could not be loaded.");
    }
  }

  async function setStatus(id: number, status: string) {
    try {
      await patch(`/projects/${id}`, { status });
      onProjects(projects.map((row) => (row.id === id ? { ...row, status } : row)));
      setDetail((current) =>
        current && current.project.id === id ? { ...current, project: { ...current.project, status } } : current,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "The status could not be changed.");
    }
  }

  async function rotate(id: number) {
    onError(null);
    try {
      setReissued(await post<Issued>(`/projects/${id}/rotate`));
    } catch (error) {
      onError(error instanceof Error ? error.message : "A new code could not be issued.");
    }
  }

  /** Fetched with the session cookie, then handed to the browser as a download. */
  async function download(row: DocumentRow) {
    onError(null);
    try {
      const response = await fetch(`${API}/documents/${row.id}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("That document could not be downloaded.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = row.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "That document could not be downloaded.");
    }
  }

  return (
    <>
      {reissued ? (
        <div className="credentials">
          <p className="eyebrow">New access code issued</p>
          <p className="mono">
            {reissued.accessCode}
            <CopyButton value={reissued.accessCode} />
          </p>
          <p className="mono break">{reissued.uploadLink}</p>
          <pre>{reissued.invitation}</pre>
          <div className="desk-actions">
            <CopyButton value={reissued.invitation} label="Copy paragraph" />
            <CopyButton value={reissued.uploadLink} label="Copy link" />
            <button className="ghost-button" type="button" onClick={() => setReissued(null)}>
              Dismiss
            </button>
          </div>
          <p className="form-note">The previous link stopped working the moment this was issued.</p>
        </div>
      ) : null}

      <table className="desk-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Client</th>
            <th>Coverage</th>
            <th>Issued by</th>
            <th>Files</th>
            <th>Status</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>
                {project.projectName}
                <small className="mono">{project.reference}</small>
              </td>
              <td>
                {project.clientName}
                {project.contactEmail ? <small>{project.contactEmail}</small> : null}
              </td>
              <td>{project.coverageInterest ?? "—"}</td>
              <td>
                {project.issuedBy ?? (project.origin === "client" ? "client enquiry" : "—")}
                {project.proposalSentAt ? <small>proposal {formatDate(project.proposalSentAt)}</small> : null}
              </td>
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
              <td colSpan={8}>{loading ? "Loading…" : "No matters yet. Send a proposal to open the first one."}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {detail ? (
        <div className="desk-detail">
          <div className="matter-head">
            <div>
              <p className="eyebrow">{detail.project.reference}</p>
              <h2 className="desk-title">{detail.project.projectName}</h2>
              <p className="matter-meta">
                {detail.project.clientName} · {detail.project.contactEmail ?? "no email on file"} · opened {formatDate(detail.project.createdAt)}
                {detail.project.issuedBy ? ` by ${detail.project.issuedBy}` : ""} · last client access{" "}
                {formatDate(detail.project.lastAccessAt)}
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
              {detail.documents.map((row) => (
                <li key={row.id}>
                  <span>
                    {row.fileName}
                    {row.note ? <em> — {row.note}</em> : null}
                  </span>
                  <small>
                    {formatBytes(row.sizeBytes)} · {formatDate(row.completedAt)}
                    {row.uploadedBy ? ` · ${row.uploadedBy}` : ""}
                  </small>
                  <button className="ghost-button" type="button" onClick={() => void download(row)}>
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
    </>
  );
}
