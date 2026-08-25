export const API = "/api/underwriting/desk";

/** Fired when the server rejects a session mid-use, so the shell can return to sign-in. */
export const SESSION_EXPIRED_EVENT = "sino-desk-session-expired";

export class DeskError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Every call carries the session cookie; nothing is kept in browser storage. */
export async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${API}${path}`, { credentials: "same-origin", ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // A 401 outside the sign-in routes means the session lapsed or was withdrawn.
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new DeskError(typeof payload.error === "string" ? payload.error : "That request failed.", response.status);
  }
  return payload as T;
}

export function post<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patch<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export type DeskUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "staff";
  mustChangePassword: boolean;
};

export type ProjectRow = {
  id: number;
  reference: string;
  organisation: string | null;
  contactName: string | null;
  contactEmail: string | null;
  coverageInterest: string | null;
  status: string;
  origin: string;
  issuedBy: string | null;
  createdAt: string;
  expiresAt: string;
  lastAccessAt: string | null;
  proposalSentAt: string | null;
  documentCount: number;
};

export type DocumentRow = {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedBy: string | null;
  note: string | null;
  completedAt: string | null;
};

export type EventRow = { id: number; type: string; actor: string; detail: string | null; createdAt: string };

export type MatterDetail = {
  project: ProjectRow & { matterSummary: string | null };
  documents: DocumentRow[];
  events: EventRow[];
};

export type TeamMember = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "staff";
  status: "active" | "disabled";
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

/** What the console gets back after issuing a code — the email included. */
export type Issued = {
  project: ProjectRow;
  accessCode: string;
  uploadLink: string;
  invitation: string;
  email?: { to: string; subject: string; body: string };
  mailto?: string;
  delivered?: boolean;
  deliveryNote?: string;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
