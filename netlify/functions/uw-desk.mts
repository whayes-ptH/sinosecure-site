import type { Config } from "@netlify/functions";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { underwritingDocuments, underwritingEvents, underwritingProjects } from "../../db/schema.js";
import {
  COVERAGE_INTERESTS,
  DEFAULT_EXPIRY_DAYS,
  PROJECT_STATUSES,
  adminKeyConfigured,
  clampText,
  clientIp,
  documentStore,
  expiryFromNow,
  failure,
  formatAccessCode,
  hashIp,
  isAdminAuthorised,
  json,
  uploadLink,
} from "../../lib/underwriting.js";
import { createProject, logEvent, rotateAccessCode } from "../../lib/portal.js";

/** The paragraph the desk pastes under a proposal, matching how they already write. */
function invitationText(reference: string, accessCode: string, link: string, expiresAt: Date): string {
  const expiry = expiresAt.toISOString().slice(0, 10);
  return [
    `Please submit the package via our secure upload portal. The link below is tied to underwriting reference ${reference} and is open until ${expiry}.`,
    "",
    `Upload link: ${link}`,
    `Access code: ${formatAccessCode(accessCode)}`,
    "",
    "Once we have reviewed a complete set of documents we will revert with any clarifying questions and an indicative term sheet / consideration proposal.",
  ].join("\n");
}

async function listProjects(): Promise<Response> {
  const rows = await db
    .select({
      id: underwritingProjects.id,
      reference: underwritingProjects.reference,
      organisation: underwritingProjects.organisation,
      contactName: underwritingProjects.contactName,
      contactEmail: underwritingProjects.contactEmail,
      coverageInterest: underwritingProjects.coverageInterest,
      status: underwritingProjects.status,
      origin: underwritingProjects.origin,
      createdAt: underwritingProjects.createdAt,
      expiresAt: underwritingProjects.expiresAt,
      lastAccessAt: underwritingProjects.lastAccessAt,
    })
    .from(underwritingProjects)
    .orderBy(desc(underwritingProjects.createdAt))
    .limit(200);

  const counts = await db
    .select({ projectId: underwritingDocuments.projectId, total: count() })
    .from(underwritingDocuments)
    .where(eq(underwritingDocuments.status, "stored"))
    .groupBy(underwritingDocuments.projectId);
  const byProject = new Map(counts.map((row) => [row.projectId, row.total]));

  return json({
    ok: true,
    projects: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
      documentCount: byProject.get(row.id) ?? 0,
    })),
  });
}

async function openProject(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return failure("Malformed request.");

  const interest = clampText(body.coverageInterest, 60);
  const days = Number(body.expiryDays);
  const { project, accessCode } = await createProject({
    organisation: clampText(body.organisation, 160),
    contactName: clampText(body.contactName, 120),
    contactEmail: clampText(body.contactEmail, 160),
    coverageInterest:
      interest && (COVERAGE_INTERESTS as readonly string[]).includes(interest) ? interest : null,
    matterSummary: clampText(body.matterSummary, 4000),
    origin: "underwriter",
    expiresAt: expiryFromNow(Number.isFinite(days) ? days : DEFAULT_EXPIRY_DAYS),
  });

  await logEvent({
    projectId: project.id,
    type: "project.created",
    actor: "underwriter",
    detail: "opened from the underwriting console",
    ipHash: hashIp(clientIp(req)),
  });

  const link = uploadLink(accessCode);
  return json({
    ok: true,
    project: {
      id: project.id,
      reference: project.reference,
      organisation: project.organisation,
      contactName: project.contactName,
      contactEmail: project.contactEmail,
      coverageInterest: project.coverageInterest,
      status: project.status,
      origin: project.origin,
      createdAt: project.createdAt.toISOString(),
      expiresAt: project.expiresAt.toISOString(),
      lastAccessAt: null,
      documentCount: 0,
    },
    accessCode: formatAccessCode(accessCode),
    uploadLink: link,
    invitation: invitationText(project.reference, accessCode, link, project.expiresAt),
  });
}

async function projectDetail(projectId: number): Promise<Response> {
  const [project] = await db
    .select()
    .from(underwritingProjects)
    .where(eq(underwritingProjects.id, projectId))
    .limit(1);
  if (!project) return failure("Unknown matter.", 404);

  const documents = await db
    .select({
      id: underwritingDocuments.id,
      fileName: underwritingDocuments.fileName,
      contentType: underwritingDocuments.contentType,
      sizeBytes: underwritingDocuments.sizeBytes,
      checksum: underwritingDocuments.checksum,
      uploadedBy: underwritingDocuments.uploadedBy,
      note: underwritingDocuments.note,
      completedAt: underwritingDocuments.completedAt,
    })
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.projectId, projectId), eq(underwritingDocuments.status, "stored")))
    .orderBy(desc(underwritingDocuments.completedAt));

  const events = await db
    .select({
      id: underwritingEvents.id,
      type: underwritingEvents.type,
      actor: underwritingEvents.actor,
      detail: underwritingEvents.detail,
      createdAt: underwritingEvents.createdAt,
    })
    .from(underwritingEvents)
    .where(eq(underwritingEvents.projectId, projectId))
    .orderBy(desc(underwritingEvents.createdAt))
    .limit(60);

  return json({
    ok: true,
    project: {
      id: project.id,
      reference: project.reference,
      organisation: project.organisation,
      contactName: project.contactName,
      contactEmail: project.contactEmail,
      coverageInterest: project.coverageInterest,
      matterSummary: project.matterSummary,
      status: project.status,
      origin: project.origin,
      createdAt: project.createdAt.toISOString(),
      expiresAt: project.expiresAt.toISOString(),
      lastAccessAt: project.lastAccessAt?.toISOString() ?? null,
    },
    documents: documents.map((doc) => ({ ...doc, completedAt: doc.completedAt?.toISOString() ?? null })),
    events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}

async function updateProject(req: Request, projectId: number): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const status = clampText(body?.status, 20);
  if (!status || !(PROJECT_STATUSES as readonly string[]).includes(status)) {
    return failure("Unknown status.");
  }

  const [updated] = await db
    .update(underwritingProjects)
    .set({ status, updatedAt: new Date() })
    .where(eq(underwritingProjects.id, projectId))
    .returning({ id: underwritingProjects.id });
  if (!updated) return failure("Unknown matter.", 404);

  await logEvent({
    projectId,
    type: "project.status",
    actor: "underwriter",
    detail: `status set to ${status}`,
    ipHash: hashIp(clientIp(req)),
  });
  return json({ ok: true, status });
}

/** Issues a fresh code and silently retires the old link. */
async function rotate(req: Request, projectId: number): Promise<Response> {
  const [project] = await db
    .select({ reference: underwritingProjects.reference, expiresAt: underwritingProjects.expiresAt })
    .from(underwritingProjects)
    .where(eq(underwritingProjects.id, projectId))
    .limit(1);
  if (!project) return failure("Unknown matter.", 404);

  const accessCode = await rotateAccessCode(projectId);
  await logEvent({
    projectId,
    type: "project.code_rotated",
    actor: "underwriter",
    detail: "a new access code was issued",
    ipHash: hashIp(clientIp(req)),
  });

  const link = uploadLink(accessCode);
  return json({
    ok: true,
    accessCode: formatAccessCode(accessCode),
    uploadLink: link,
    invitation: invitationText(project.reference, accessCode, link, project.expiresAt),
  });
}

/**
 * Streams the stored object back to the desk. Everything is served as an opaque
 * attachment so a hostile upload can never execute in the browser.
 */
async function download(req: Request, documentId: number): Promise<Response> {
  const [document] = await db
    .select()
    .from(underwritingDocuments)
    .where(and(eq(underwritingDocuments.id, documentId), eq(underwritingDocuments.status, "stored")))
    .limit(1);
  if (!document) return failure("Unknown document.", 404);

  const stream = (await documentStore().get(document.storageKey, { type: "stream" })) as ReadableStream | null;
  if (!stream) return failure("That document is no longer available.", 410);

  await logEvent({
    projectId: document.projectId,
    type: "document.downloaded",
    actor: "underwriter",
    detail: document.fileName,
    ipHash: hashIp(clientIp(req)),
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${document.fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export default async (req: Request): Promise<Response> => {
  if (!adminKeyConfigured()) {
    return failure(
      "The underwriting console is not configured. Set UNDERWRITING_ADMIN_KEY in the Netlify environment.",
      503,
      { configured: false },
    );
  }
  if (!isAdminAuthorised(req)) return failure("Not authorised.", 401);

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../desk/<resource>/<id?>/<action?>
  const deskIndex = segments.indexOf("desk");
  const [resource, rawId, action] = segments.slice(deskIndex + 1);
  const id = Number(rawId);

  try {
    if (resource === "session") return json({ ok: true });
    if (resource === "projects" && !rawId) {
      if (req.method === "GET") return await listProjects();
      if (req.method === "POST") return await openProject(req);
    }
    if (resource === "projects" && Number.isInteger(id)) {
      if (action === "rotate" && req.method === "POST") return await rotate(req, id);
      if (!action && req.method === "GET") return await projectDetail(id);
      if (!action && req.method === "PATCH") return await updateProject(req, id);
    }
    if (resource === "documents" && Number.isInteger(id) && req.method === "GET") {
      return await download(req, id);
    }
    return failure("Not found.", 404);
  } catch (error) {
    console.error("underwriting console error", error);
    return failure("Something went wrong handling that request.", 500);
  }
};

export const config: Config = {
  path: [
    "/api/underwriting/desk/session",
    "/api/underwriting/desk/projects",
    "/api/underwriting/desk/projects/:id",
    "/api/underwriting/desk/projects/:id/rotate",
    "/api/underwriting/desk/documents/:id",
  ],
};
