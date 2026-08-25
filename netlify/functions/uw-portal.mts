import type { Config } from "@netlify/functions";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { underwritingDocuments } from "../../db/schema.js";
import {
  CHUNK_BYTES,
  COVERAGE_INTERESTS,
  DEFAULT_EXPIRY_DAYS,
  MAX_CHUNK_BYTES,
  MAX_FILES_PER_PROJECT,
  MAX_FILE_BYTES,
  clampText,
  clientIp,
  documentStore,
  expiryFromNow,
  failure,
  formatAccessCode,
  hashIp,
  isAllowedFileName,
  isEmail,
  json,
  notifyDesk,
  sanitiseFileName,
  uploadLink,
} from "../../lib/underwriting.js";
import {
  countStoredDocuments,
  createProject,
  findOrCreateClient,
  hasOpenedTooManyProjects,
  listStoredDocuments,
  logEvent,
  markChunkReceived,
  resolveProjectByCode,
} from "../../lib/portal.js";

const STAGING_TTL_MS = 6 * 60 * 60 * 1000;

function stagingKey(documentId: number, index: number): string {
  return `staging/${documentId}/${index}`;
}

function projectView(project: {
  reference: string;
  projectName: string;
  organisation: string | null;
  contactName: string | null;
  coverageInterest: string | null;
  status: string;
  expiresAt: Date;
}) {
  return {
    reference: project.reference,
    projectName: project.projectName,
    organisation: project.organisation,
    contactName: project.contactName,
    coverageInterest: project.coverageInterest,
    status: project.status,
    expiresAt: project.expiresAt.toISOString(),
  };
}

/** Abandoned uploads would otherwise consume a matter's file allowance forever. */
async function purgeStaleUploads(projectId: number): Promise<void> {
  const cutoff = new Date(Date.now() - STAGING_TTL_MS);
  const stale = await db
    .select({ id: underwritingDocuments.id, chunkTotal: underwritingDocuments.chunkTotal })
    .from(underwritingDocuments)
    .where(
      and(
        eq(underwritingDocuments.projectId, projectId),
        eq(underwritingDocuments.status, "pending"),
        lt(underwritingDocuments.createdAt, cutoff),
      ),
    );
  if (!stale.length) return;

  const store = documentStore();
  for (const row of stale) {
    for (let index = 0; index < row.chunkTotal; index += 1) {
      await store.delete(stagingKey(row.id, index)).catch(() => undefined);
    }
    await db.delete(underwritingDocuments).where(eq(underwritingDocuments.id, row.id));
  }
}

/** Opens a matter straight from the enquiry form and hands the client its code. */
async function handleRequest(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return failure("Malformed request.");
  // Honeypot: real people never fill this in.
  if (clampText(body["company-website"], 80)) return json({ ok: true, skipped: true });

  const contactName = clampText(body.name, 120);
  const contactEmail = clampText(body.email, 160);
  const matterSummary = clampText(body.message, 4000);
  if (!contactName) return failure("Please tell us your name.");
  if (!contactEmail || !isEmail(contactEmail)) return failure("Please provide a valid business email address.");
  if (!matterSummary) return failure("Please describe the risk or opportunity.");
  if (await hasOpenedTooManyProjects(req)) {
    return failure("Several enquiries have already been received from this connection. Please contact us directly.", 429);
  }

  const interest = clampText(body.interest, 60);
  const coverageInterest =
    interest && (COVERAGE_INTERESTS as readonly string[]).includes(interest) ? interest : COVERAGE_INTERESTS[0];
  const organisation = clampText(body.company, 160);
  const client = await findOrCreateClient({
    name: organisation ?? contactName,
    contactName,
    contactEmail,
  });

  const { project, accessCode } = await createProject({
    clientId: client.id,
    projectName: `${coverageInterest} enquiry`,
    organisation,
    contactName,
    contactEmail,
    coverageInterest,
    matterSummary,
    origin: "client",
    expiresAt: expiryFromNow(DEFAULT_EXPIRY_DAYS),
  });

  await logEvent({
    projectId: project.id,
    type: "project.created",
    actor: "client",
    detail: "opened from the enquiry form",
    ipHash: hashIp(clientIp(req)),
  });

  // The enquiry itself is posted to Netlify Forms by the browser, so it keeps the
  // visitor's own address and spam filtering. This only flags the new matter.
  await notifyDesk({
    event: "New underwriting enquiry",
    reference: project.reference,
    organisation: project.organisation ?? "",
    contact: `${contactName} <${contactEmail}>`,
    detail: `Coverage interest: ${coverageInterest}.\n\n${matterSummary}`,
  });

  return json({
    ok: true,
    project: projectView(project),
    accessCode: formatAccessCode(accessCode),
    uploadLink: uploadLink(accessCode),
  });
}

/** Exchanges a code for the matter summary and everything already received. */
async function handleAccess(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const resolved = await resolveProjectByCode(body?.code, req);
  if (!resolved.ok) return failure(resolved.error, resolved.status);

  const documents = await listStoredDocuments(resolved.project.id);
  await logEvent({
    projectId: resolved.project.id,
    type: "access.granted",
    actor: "client",
    ipHash: hashIp(clientIp(req)),
  });

  return json({
    ok: true,
    project: projectView(resolved.project),
    documents: documents.map((doc) => ({ ...doc, completedAt: doc.completedAt?.toISOString() ?? null })),
    limits: { chunkBytes: CHUNK_BYTES, maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES_PER_PROJECT },
  });
}

async function handleInit(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const resolved = await resolveProjectByCode(body?.code, req);
  if (!resolved.ok) return failure(resolved.error, resolved.status);

  const rawName = clampText(body?.fileName, 240);
  if (!rawName) return failure("A file name is required.");
  const fileName = sanitiseFileName(rawName);
  if (!isAllowedFileName(fileName)) {
    return failure("That file type is not accepted. Please supply documents, spreadsheets, images or an archive.");
  }

  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0) return failure("That file appears to be empty.");
  if (size > MAX_FILE_BYTES) {
    return failure(`Each file must be ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`);
  }

  await purgeStaleUploads(resolved.project.id);
  if ((await countStoredDocuments(resolved.project.id)) >= MAX_FILES_PER_PROJECT) {
    return failure(`This submission has reached its limit of ${MAX_FILES_PER_PROJECT} files.`, 409);
  }

  const chunkTotal = Math.max(1, Math.ceil(size / CHUNK_BYTES));
  const [document] = await db
    .insert(underwritingDocuments)
    .values({
      projectId: resolved.project.id,
      storageKey: `matters/${resolved.project.reference}/${randomUUID()}`,
      fileName,
      contentType: clampText(body?.contentType, 120) ?? "application/octet-stream",
      sizeBytes: Math.round(size),
      chunkTotal,
      uploadedBy: clampText(body?.uploadedBy, 160),
      note: clampText(body?.note, 500),
    })
    .returning({ id: underwritingDocuments.id });

  return json({ ok: true, documentId: document.id, chunkBytes: CHUNK_BYTES, chunkTotal });
}

/**
 * Chunks arrive as raw bytes so nothing is inflated by base64 on the way in — a
 * synchronous Netlify Function is capped at 6 MB per request.
 */
async function handleChunk(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolved = await resolveProjectByCode(req.headers.get("x-underwriting-code"), req, { touch: false });
  if (!resolved.ok) return failure(resolved.error, resolved.status);

  const documentId = Number(url.searchParams.get("document"));
  const index = Number(url.searchParams.get("index"));
  if (!Number.isInteger(documentId) || !Number.isInteger(index) || index < 0) {
    return failure("Malformed upload request.");
  }

  const [document] = await db
    .select()
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.id, documentId), eq(underwritingDocuments.projectId, resolved.project.id)))
    .limit(1);
  if (!document) return failure("Unknown upload.", 404);
  if (document.status !== "pending") return failure("That upload has already been finalised.", 409);
  if (index >= document.chunkTotal) return failure("Malformed upload request.");

  const chunk = await req.arrayBuffer();
  if (chunk.byteLength === 0) return failure("Empty chunk received.");
  if (chunk.byteLength > MAX_CHUNK_BYTES) return failure("Chunk too large.", 413);

  await documentStore().set(stagingKey(documentId, index), chunk);
  await markChunkReceived(documentId, index);

  return json({ ok: true, index });
}

/** Reassembles the staged chunks into a single object and checksums the result. */
async function handleComplete(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const resolved = await resolveProjectByCode(body?.code, req);
  if (!resolved.ok) return failure(resolved.error, resolved.status);

  const documentId = Number(body?.documentId);
  if (!Number.isInteger(documentId)) return failure("Malformed upload request.");

  const [document] = await db
    .select()
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.id, documentId), eq(underwritingDocuments.projectId, resolved.project.id)))
    .limit(1);
  if (!document) return failure("Unknown upload.", 404);
  if (document.status === "stored") return json({ ok: true, documentId, alreadyStored: true });

  const store = documentStore();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < document.chunkTotal; index += 1) {
    const part = (await store.get(stagingKey(documentId, index), { type: "arrayBuffer" })) as ArrayBuffer | null;
    if (!part) return failure("Part of that file did not arrive. Please try the upload again.", 409);
    parts.push(new Uint8Array(part));
    total += part.byteLength;
  }
  if (total !== document.sizeBytes) {
    return failure("The uploaded file did not match its expected size. Please try again.", 409);
  }

  const assembled = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    assembled.set(part, offset);
    offset += part.byteLength;
  }

  const checksum = createHash("sha256").update(assembled).digest("hex");
  await store.set(document.storageKey, assembled.buffer as ArrayBuffer);
  for (let index = 0; index < document.chunkTotal; index += 1) {
    await store.delete(stagingKey(documentId, index)).catch(() => undefined);
  }

  const completedAt = new Date();
  await db
    .update(underwritingDocuments)
    .set({ status: "stored", checksum, completedAt })
    .where(eq(underwritingDocuments.id, documentId));

  await logEvent({
    projectId: resolved.project.id,
    type: "document.uploaded",
    actor: "client",
    detail: `${document.fileName} (${document.sizeBytes} bytes)`,
    ipHash: hashIp(clientIp(req)),
  });
  await notifyDesk({
    event: "Documents received",
    reference: resolved.project.reference,
    organisation: resolved.project.organisation ?? "",
    contact: document.uploadedBy ?? resolved.project.contactEmail ?? "",
    detail: `${document.fileName} (${(document.sizeBytes / (1024 * 1024)).toFixed(2)} MB) uploaded to the secure portal.`,
  });

  return json({
    ok: true,
    document: {
      id: documentId,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      contentType: document.contentType,
      checksum,
      note: document.note,
      uploadedBy: document.uploadedBy,
      completedAt: completedAt.toISOString(),
    },
  });
}

export default async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);
  try {
    if (pathname.endsWith("/request") && req.method === "POST") return await handleRequest(req);
    if (pathname.endsWith("/access") && req.method === "POST") return await handleAccess(req);
    if (pathname.endsWith("/upload/init") && req.method === "POST") return await handleInit(req);
    if (pathname.endsWith("/upload/chunk") && req.method === "PUT") return await handleChunk(req);
    if (pathname.endsWith("/upload/complete") && req.method === "POST") return await handleComplete(req);
    return failure("Not found.", 404);
  } catch (error) {
    console.error("underwriting portal error", error);
    return failure("Something went wrong handling that request. Please try again.", 500);
  }
};

export const config: Config = {
  path: [
    "/api/underwriting/request",
    "/api/underwriting/access",
    "/api/underwriting/upload/init",
    "/api/underwriting/upload/chunk",
    "/api/underwriting/upload/complete",
  ],
};
