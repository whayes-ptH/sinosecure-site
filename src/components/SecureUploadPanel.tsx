"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type ProjectSummary = {
  reference: string;
  organisation: string | null;
  contactName: string | null;
  coverageInterest: string | null;
  status: string;
  expiresAt: string;
};

type StoredDocument = {
  id: number;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  checksum: string | null;
  note: string | null;
  uploadedBy: string | null;
  completedAt: string | null;
};

type Limits = { chunkBytes: number; maxFileBytes: number; maxFiles: number };

type QueueItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: "waiting" | "uploading" | "done" | "failed";
  error?: string;
};

const DEFAULT_LIMITS: Limits = { chunkBytes: 3145728, maxFileBytes: 26214400, maxFiles: 40 };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "That request could not be completed.");
  return payload;
}

export function SecureUploadPanel({
  initialCode = "",
  autoUnlock = false,
  enquiryHref = "/contact#enquiry",
}: {
  initialCode?: string;
  autoUnlock?: boolean;
  /** Where "no code yet" sends someone. A bare hash when the enquiry form is on the same page. */
  enquiryHref?: string;
}) {
  const [codeInput, setCodeInput] = useState(initialCode);
  const [code, setCode] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedBy, setUploadedBy] = useState("");
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = queue.some((item) => item.status === "uploading" || item.status === "waiting");

  const unlock = useCallback(async (candidate: string) => {
    if (!candidate.trim()) return;
    setUnlocking(true);
    setError(null);
    try {
      const payload = await postJson("/api/underwriting/access", { code: candidate });
      setProject(payload.project as ProjectSummary);
      setDocuments((payload.documents as StoredDocument[]) ?? []);
      setLimits((payload.limits as Limits) ?? DEFAULT_LIMITS);
      setCode(candidate);
    } catch (unlockError) {
      setProject(null);
      setCode(null);
      setError(unlockError instanceof Error ? unlockError.message : "That access code was not recognised.");
    } finally {
      setUnlocking(false);
    }
  }, []);

  useEffect(() => {
    if (!initialCode) return;
    setCodeInput(initialCode);
    if (autoUnlock) void unlock(initialCode);
  }, [initialCode, autoUnlock, unlock]);

  const updateItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  /** Files go up in slices so no single request approaches the platform's request ceiling. */
  const sendFile = useCallback(
    async (file: File, accessCode: string, key: string) => {
      const init = await postJson("/api/underwriting/upload/init", {
        code: accessCode,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        uploadedBy: uploadedBy || null,
        note: note || null,
      });
      const documentId = init.documentId as number;
      const chunkBytes = (init.chunkBytes as number) || limits.chunkBytes;
      const chunkTotal = (init.chunkTotal as number) || 1;

      for (let index = 0; index < chunkTotal; index += 1) {
        const slice = file.slice(index * chunkBytes, Math.min((index + 1) * chunkBytes, file.size));
        const response = await fetch(`/api/underwriting/upload/chunk?document=${documentId}&index=${index}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "x-underwriting-code": accessCode },
          body: slice,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(typeof payload.error === "string" ? payload.error : "The upload was interrupted.");
        }
        updateItem(key, { progress: Math.round(((index + 1) / chunkTotal) * 96) });
      }

      const completed = await postJson("/api/underwriting/upload/complete", { code: accessCode, documentId });
      return completed.document as StoredDocument;
    },
    [limits.chunkBytes, note, updateItem, uploadedBy],
  );

  const enqueue = useCallback(
    async (files: File[]) => {
      if (!code) return;
      setError(null);
      const accepted: { file: File; key: string }[] = [];

      for (const file of files) {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        if (file.size > limits.maxFileBytes) {
          setQueue((current) => [
            ...current,
            {
              key,
              name: file.name,
              size: file.size,
              progress: 0,
              status: "failed",
              error: `Larger than the ${formatBytes(limits.maxFileBytes)} limit.`,
            },
          ]);
          continue;
        }
        setQueue((current) => [...current, { key, name: file.name, size: file.size, progress: 0, status: "waiting" }]);
        accepted.push({ file, key });
      }

      // Sequential: a steadier connection for the large scanned packages we usually receive.
      for (const { file, key } of accepted) {
        updateItem(key, { status: "uploading" });
        try {
          const stored = await sendFile(file, code, key);
          updateItem(key, { status: "done", progress: 100 });
          setDocuments((current) => [stored, ...current]);
        } catch (uploadError) {
          updateItem(key, {
            status: "failed",
            error: uploadError instanceof Error ? uploadError.message : "The upload failed.",
          });
        }
      }
    },
    [code, limits.maxFileBytes, sendFile, updateItem],
  );

  if (!project || !code) {
    return (
      <div className="secure-card">
        <p className="eyebrow">Secure document upload</p>
        <h3>Enter your access code</h3>
        <p>
          Your code arrives with your proposal or acknowledgement. It ties every file you send to a single underwriting
          reference, so nothing is separated from its matter.
        </p>
        <form
          className="code-form"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock(codeInput);
          }}
        >
          <label>
            Access code
            <input
              name="access-code"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="SS-0000-0000-0000-0000"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              required
            />
          </label>
          <button className="button" type="submit" disabled={unlocking}>
            {unlocking ? "Checking…" : "Unlock upload"} <span aria-hidden="true">↗</span>
          </button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="form-note">
          No code yet? <Link href={enquiryHref}>Send an underwriting enquiry</Link> and one is issued to you the moment
          it reaches us.
        </p>
      </div>
    );
  }

  return (
    <div className="secure-card unlocked">
      <div className="matter-head">
        <div>
          <p className="eyebrow">Underwriting reference</p>
          <h3>{project.reference}</h3>
          <p className="matter-meta">
            {project.organisation ?? project.contactName ?? "Submission"}
            {project.coverageInterest ? ` · ${project.coverageInterest}` : ""} · open until {formatDate(project.expiresAt)}
          </p>
        </div>
        <span className={`status-pill status-${project.status}`}>{project.status.replace("_", " ")}</span>
      </div>

      <div className="field-row">
        <label>
          Your name (optional)
          <input value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} autoComplete="name" />
        </label>
        <label>
          Note for the underwriter (optional)
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Survey report, part 1 of 2" />
        </label>
      </div>

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void enqueue(Array.from(event.dataTransfer.files));
        }}
      >
        <p className="dropzone-title">Drop documents here</p>
        <p>
          Up to {limits.maxFiles} files per submission, {formatBytes(limits.maxFileBytes)} each. PDF, Office, image and
          archive formats accepted.
        </p>
        <button className="button button-small" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Choose files"}
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          onChange={(event) => {
            void enqueue(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {queue.length ? (
        <ul className="upload-queue">
          {queue.map((item) => (
            <li key={item.key} className={`queue-${item.status}`}>
              <div className="queue-row">
                <span className="queue-name">{item.name}</span>
                <span className="queue-state">
                  {item.status === "done" ? "Received" : item.status === "failed" ? "Failed" : `${item.progress}%`}
                </span>
              </div>
              <div className="queue-track">
                <span style={{ width: `${item.status === "done" ? 100 : item.progress}%` }} />
              </div>
              {item.error ? <p className="queue-error">{item.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="received">
        <h4>Received against this reference</h4>
        {documents.length ? (
          <ul className="document-list">
            {documents.map((document) => (
              <li key={document.id}>
                <span>{document.fileName}</span>
                <small>
                  {formatBytes(document.sizeBytes)} · {formatDate(document.completedAt)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing received yet. Files appear here the moment they land with us.</p>
        )}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="form-note">
        Files are stored encrypted against reference {project.reference} and are visible only to the Sino Secure
        underwriting desk. Every access is logged. Uploading documents does not bind or confirm coverage.
      </p>
    </div>
  );
}
