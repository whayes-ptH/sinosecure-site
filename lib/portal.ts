import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { underwritingClients, underwritingDocuments, underwritingEvents, underwritingProjects } from "../db/schema.js";
import {
  ATTEMPT_WINDOW_MINUTES,
  MAX_FAILED_ATTEMPTS,
  clientIp,
  createAccessCode,
  createReference,
  hashAccessCode,
  hashIp,
  normaliseAccessCode,
} from "./underwriting.js";

export type Project = typeof underwritingProjects.$inferSelect;
export type Client = typeof underwritingClients.$inferSelect;

export function normaliseClientEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Reuses an existing client by normalized email, otherwise creates it. */
export async function findOrCreateClient(input: {
  name: string;
  contactName?: string | null;
  contactEmail: string;
}): Promise<Client> {
  const contactEmail = normaliseClientEmail(input.contactEmail);
  const [existing] = await db
    .select()
    .from(underwritingClients)
    .where(eq(underwritingClients.contactEmail, contactEmail))
    .limit(1);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(underwritingClients)
      .values({ name: input.name, contactName: input.contactName ?? null, contactEmail })
      .returning();
    return created;
  } catch (error) {
    // A simultaneous enquiry for the same email can win the unique-index race.
    const [raced] = await db
      .select()
      .from(underwritingClients)
      .where(eq(underwritingClients.contactEmail, contactEmail))
      .limit(1);
    if (raced) return raced;
    throw error;
  }
}

export async function logEvent(entry: {
  projectId?: number | null;
  type: string;
  actor: string;
  detail?: string | null;
  ipHash?: string | null;
}): Promise<void> {
  await db.insert(underwritingEvents).values({
    projectId: entry.projectId ?? null,
    type: entry.type,
    actor: entry.actor,
    detail: entry.detail ?? null,
    ipHash: entry.ipHash ?? null,
  });
}

/**
 * Codes carry 80 bits of entropy, so guessing is already impractical. This caps the
 * noise anyway: repeated misses from one address stop being answered.
 */
async function isThrottled(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false;
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);
  const [row] = await db
    .select({ attempts: count() })
    .from(underwritingEvents)
    .where(
      and(
        eq(underwritingEvents.type, "access.denied"),
        eq(underwritingEvents.ipHash, ipHash),
        gt(underwritingEvents.createdAt, since),
      ),
    );
  return (row?.attempts ?? 0) >= MAX_FAILED_ATTEMPTS;
}

export type Resolution =
  | { ok: true; project: Project }
  | { ok: false; status: number; error: string };

/**
 * Turns a client-supplied code into a live matter, or an error that deliberately
 * says nothing about whether the code exists. `touch` is skipped for chunk uploads,
 * which would otherwise rewrite the same row once per slice of a large file.
 */
export async function resolveProjectByCode(
  rawCode: unknown,
  req: Request,
  { touch = true }: { touch?: boolean } = {},
): Promise<Resolution> {
  const ipHash = hashIp(clientIp(req));
  if (await isThrottled(ipHash)) {
    return { ok: false, status: 429, error: "Too many attempts. Please try again shortly." };
  }

  const code = typeof rawCode === "string" ? normaliseAccessCode(rawCode) : null;
  if (!code) {
    await logEvent({ type: "access.denied", actor: "client", detail: "malformed code", ipHash });
    return { ok: false, status: 401, error: "That access code was not recognised." };
  }

  const [project] = await db
    .select()
    .from(underwritingProjects)
    .where(eq(underwritingProjects.accessCodeHash, hashAccessCode(code)))
    .limit(1);

  if (!project) {
    await logEvent({ type: "access.denied", actor: "client", detail: "unknown code", ipHash });
    return { ok: false, status: 401, error: "That access code was not recognised." };
  }
  if (project.status === "closed") {
    await logEvent({ projectId: project.id, type: "access.denied", actor: "client", detail: "closed matter", ipHash });
    return { ok: false, status: 403, error: "This submission has been closed. Please contact your underwriter." };
  }
  if (project.expiresAt.getTime() < Date.now()) {
    await logEvent({ projectId: project.id, type: "access.denied", actor: "client", detail: "expired link", ipHash });
    return { ok: false, status: 403, error: "This upload link has expired. Please contact your underwriter for a new one." };
  }

  if (touch) {
    await db
      .update(underwritingProjects)
      .set({ lastAccessAt: new Date(), updatedAt: new Date() })
      .where(eq(underwritingProjects.id, project.id));
  }

  return { ok: true, project };
}

/** Caps how many matters a single address can open, so the form cannot be farmed. */
export async function hasOpenedTooManyProjects(req: Request): Promise<boolean> {
  const ipHash = hashIp(clientIp(req));
  if (!ipHash) return false;
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);
  const [row] = await db
    .select({ opened: count() })
    .from(underwritingEvents)
    .where(
      and(
        eq(underwritingEvents.type, "project.created"),
        eq(underwritingEvents.ipHash, ipHash),
        gt(underwritingEvents.createdAt, since),
      ),
    );
  return (row?.opened ?? 0) >= 5;
}

/** Retries on the (vanishingly unlikely) reference collision rather than failing a client. */
export async function createProject(input: {
  clientId: number;
  projectName: string;
  organisation?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  coverageInterest?: string | null;
  matterSummary?: string | null;
  origin: "client" | "underwriter";
  /** The console account that issued the code, when a member of staff did. */
  issuedByUserId?: number | null;
  proposalSentAt?: Date | null;
  expiresAt: Date;
}): Promise<{ project: Project; accessCode: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const accessCode = createAccessCode();
    try {
      const [project] = await db
        .insert(underwritingProjects)
        .values({
          clientId: input.clientId,
          projectName: input.projectName,
          reference: createReference(),
          accessCodeHash: hashAccessCode(accessCode),
          organisation: input.organisation ?? null,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          coverageInterest: input.coverageInterest ?? null,
          matterSummary: input.matterSummary ?? null,
          origin: input.origin,
          issuedByUserId: input.issuedByUserId ?? null,
          proposalSentAt: input.proposalSentAt ?? null,
          expiresAt: input.expiresAt,
        })
        .returning();
      return { project, accessCode };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not allocate a reference");
}

export async function rotateAccessCode(projectId: number): Promise<string> {
  const accessCode = createAccessCode();
  await db
    .update(underwritingProjects)
    .set({ accessCodeHash: hashAccessCode(accessCode), updatedAt: new Date() })
    .where(eq(underwritingProjects.id, projectId));
  return accessCode;
}

export async function listStoredDocuments(projectId: number) {
  return db
    .select({
      id: underwritingDocuments.id,
      fileName: underwritingDocuments.fileName,
      sizeBytes: underwritingDocuments.sizeBytes,
      contentType: underwritingDocuments.contentType,
      checksum: underwritingDocuments.checksum,
      note: underwritingDocuments.note,
      uploadedBy: underwritingDocuments.uploadedBy,
      completedAt: underwritingDocuments.completedAt,
    })
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.projectId, projectId), eq(underwritingDocuments.status, "stored")))
    .orderBy(desc(underwritingDocuments.completedAt));
}

export async function countStoredDocuments(projectId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.projectId, projectId), eq(underwritingDocuments.status, "stored")));
  return row?.total ?? 0;
}

export function markChunkReceived(documentId: number, index: number) {
  return db
    .update(underwritingDocuments)
    .set({ chunksReceived: sql`greatest(${underwritingDocuments.chunksReceived}, ${index + 1})` })
    .where(eq(underwritingDocuments.id, documentId));
}
