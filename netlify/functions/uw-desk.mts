import type { Config } from "@netlify/functions";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  underwritingDocuments,
  underwritingEvents,
  underwritingClients,
  underwritingProjects,
  underwritingUsers,
} from "../../db/schema.js";
import {
  COVERAGE_INTERESTS,
  DEFAULT_EXPIRY_DAYS,
  PROJECT_STATUSES,
  clampText,
  clientIp,
  documentStore,
  expiryFromNow,
  failure,
  formatAccessCode,
  hashIp,
  isEmail,
  json,
  notifyDesk,
  uploadLink,
} from "../../lib/underwriting.js";
import { authenticate, originAllowed, unauthorised, type DeskUser } from "../../lib/auth.js";
import { createProject, findOrCreateClient, logEvent, rotateAccessCode, type Client } from "../../lib/portal.js";
import {
  deliverProposal,
  invitationText,
  mailerConfigured,
  mailtoLink,
  proposalBody,
  proposalSubject,
  type ProposalEmail,
} from "../../lib/proposal.js";

const issuer = alias(underwritingUsers, "issuer");

type MatterInput = {
  clientId: number | null;
  clientName: string | null;
  projectName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  coverageInterest: string | null;
  matterSummary: string | null;
  expiryDays: number;
};

function readMatterInput(body: Record<string, unknown> | null): MatterInput {
  const interest = clampText(body?.coverageInterest, 60);
  const days = Number(body?.expiryDays);
  const clientId = Number(body?.clientId);
  return {
    clientId: Number.isInteger(clientId) && clientId > 0 ? clientId : null,
    clientName: clampText(body?.clientName, 160),
    projectName: clampText(body?.projectName, 200),
    contactName: clampText(body?.contactName, 120),
    contactEmail: clampText(body?.contactEmail, 160),
    coverageInterest: interest && (COVERAGE_INTERESTS as readonly string[]).includes(interest) ? interest : null,
    matterSummary: clampText(body?.matterSummary, 4000),
    expiryDays: Number.isFinite(days) ? days : DEFAULT_EXPIRY_DAYS,
  };
}

type ResolvedMatterClient = {
  client: Client;
  organisation: string | null;
  contactName: string | null;
  contactEmail: string;
};

async function resolveMatterClient(input: MatterInput): Promise<ResolvedMatterClient | null> {
  if (input.clientId) {
    const [client] = await db
      .select()
      .from(underwritingClients)
      .where(eq(underwritingClients.id, input.clientId))
      .limit(1);
    if (!client || client.status !== "active" || !client.contactEmail) return null;
    return {
      client,
      organisation: client.name,
      contactName: client.contactName,
      contactEmail: client.contactEmail,
    };
  }

  if (!input.clientName || !input.contactEmail || !isEmail(input.contactEmail)) return null;
  const client = await findOrCreateClient({
    name: input.clientName,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
  });
  return {
    client,
    organisation: client.name,
    contactName: client.contactName,
    contactEmail: client.contactEmail as string,
  };
}

async function listProjects(): Promise<Response> {
  const rows = await db
    .select({
      id: underwritingProjects.id,
      clientId: underwritingProjects.clientId,
      clientName: underwritingClients.name,
      projectName: underwritingProjects.projectName,
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
      proposalSentAt: underwritingProjects.proposalSentAt,
      issuedBy: issuer.name,
    })
    .from(underwritingProjects)
    .innerJoin(underwritingClients, eq(underwritingProjects.clientId, underwritingClients.id))
    .leftJoin(issuer, eq(underwritingProjects.issuedByUserId, issuer.id))
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
      proposalSentAt: row.proposalSentAt?.toISOString() ?? null,
      documentCount: byProject.get(row.id) ?? 0,
    })),
  });
}

async function listClients(): Promise<Response> {
  const rows = await db
    .select({
      id: underwritingClients.id,
      name: underwritingClients.name,
      contactName: underwritingClients.contactName,
      contactEmail: underwritingClients.contactEmail,
      status: underwritingClients.status,
      createdAt: underwritingClients.createdAt,
    })
    .from(underwritingClients)
    .orderBy(desc(underwritingClients.createdAt))
    .limit(500);
  const counts = await db
    .select({ clientId: underwritingProjects.clientId, total: count() })
    .from(underwritingProjects)
    .groupBy(underwritingProjects.clientId);
  const byClient = new Map(counts.map((row) => [row.clientId, row.total]));

  return json({
    ok: true,
    clients: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      projectCount: byClient.get(row.id) ?? 0,
    })),
  });
}

function serialiseProject(project: {
  id: number;
  clientId: number;
  projectName: string;
  reference: string;
  organisation: string | null;
  contactName: string | null;
  contactEmail: string | null;
  coverageInterest: string | null;
  status: string;
  origin: string;
  createdAt: Date;
  expiresAt: Date;
  proposalSentAt: Date | null;
}, issuedBy: string | null, clientName: string) {
  return {
    id: project.id,
    clientId: project.clientId,
    clientName,
    projectName: project.projectName,
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
    proposalSentAt: project.proposalSentAt?.toISOString() ?? null,
    issuedBy,
    documentCount: 0,
  };
}

/**
 * The whole job in one request: open the matter, mint the access code, write the
 * proposal around it and put it in front of the client. Staff never handle a token
 * by hand — sending the proposal is what issues it.
 */
async function sendProposal(req: Request, user: DeskUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = readMatterInput(body);
  if (!input.projectName) return failure("Enter a project or proposal name.");
  const resolvedClient = await resolveMatterClient(input);
  if (!resolvedClient) return failure("Select an active client or enter a new client's name and valid email address.");

  const { project, accessCode } = await createProject({
    clientId: resolvedClient.client.id,
    projectName: input.projectName,
    organisation: resolvedClient.organisation,
    contactName: resolvedClient.contactName,
    contactEmail: resolvedClient.contactEmail,
    coverageInterest: input.coverageInterest,
    matterSummary: input.matterSummary,
    origin: "underwriter",
    issuedByUserId: user.id,
    proposalSentAt: new Date(),
    expiresAt: expiryFromNow(input.expiryDays),
  });

  const link = uploadLink(accessCode);
  const email: ProposalEmail = {
    to: project.contactEmail as string,
    replyTo: user.email,
    subject: proposalSubject(project.reference, project.organisation, project.projectName),
    body: proposalBody({
      reference: project.reference,
      accessCode,
      uploadLink: link,
      expiresAt: project.expiresAt,
      contactName: project.contactName,
      organisation: project.organisation,
      coverageInterest: project.coverageInterest,
      message: clampText(body?.message, 4000),
      senderName: user.name,
      senderEmail: user.email,
    }),
  };

  const delivery = await deliverProposal(email);

  await logEvent({
    projectId: project.id,
    type: "project.created",
    actor: user.email,
    detail: "opened with a proposal",
    ipHash: hashIp(clientIp(req)),
  });
  await logEvent({
    projectId: project.id,
    type: "proposal.sent",
    actor: user.email,
    detail: delivery.delivered ? `emailed to ${email.to}` : `drafted for ${email.to}`,
    ipHash: hashIp(clientIp(req)),
  });
  void notifyDesk({
    reference: project.reference,
    event: delivery.delivered ? "proposal emailed" : "proposal drafted",
    detail: `${project.projectName} · ${email.to} · issued by ${user.name}`,
  });

  return json({
    ok: true,
    project: serialiseProject(project, user.name, resolvedClient.client.name),
    accessCode: formatAccessCode(accessCode),
    uploadLink: link,
    invitation: invitationText(project.reference, accessCode, link, project.expiresAt),
    email: { to: email.to, subject: email.subject, body: email.body },
    mailto: mailtoLink(email),
    delivered: delivery.delivered,
    deliveryNote: delivery.note,
  });
}

/** The same thing without an email — a link to hand over in a call or a chat. */
async function openProject(req: Request, user: DeskUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = readMatterInput(body);
  if (!input.projectName) return failure("Enter a project or proposal name.");
  const resolvedClient = await resolveMatterClient(input);
  if (!resolvedClient) return failure("Select an active client or enter a new client's name and valid email address.");

  const { project, accessCode } = await createProject({
    clientId: resolvedClient.client.id,
    projectName: input.projectName,
    organisation: resolvedClient.organisation,
    contactName: resolvedClient.contactName,
    contactEmail: resolvedClient.contactEmail,
    coverageInterest: input.coverageInterest,
    matterSummary: input.matterSummary,
    origin: "underwriter",
    issuedByUserId: user.id,
    expiresAt: expiryFromNow(input.expiryDays),
  });

  await logEvent({
    projectId: project.id,
    type: "project.created",
    actor: user.email,
    detail: "opened from the console",
    ipHash: hashIp(clientIp(req)),
  });

  const link = uploadLink(accessCode);
  return json({
    ok: true,
    project: serialiseProject(project, user.name, resolvedClient.client.name),
    accessCode: formatAccessCode(accessCode),
    uploadLink: link,
    invitation: invitationText(project.reference, accessCode, link, project.expiresAt),
  });
}

async function projectDetail(projectId: number): Promise<Response> {
  const [row] = await db
    .select({ project: underwritingProjects, issuedBy: issuer.name, clientName: underwritingClients.name })
    .from(underwritingProjects)
    .innerJoin(underwritingClients, eq(underwritingProjects.clientId, underwritingClients.id))
    .leftJoin(issuer, eq(underwritingProjects.issuedByUserId, issuer.id))
    .where(eq(underwritingProjects.id, projectId))
    .limit(1);
  if (!row) return failure("Unknown matter.", 404);
  const { project } = row;

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
      clientId: project.clientId,
      clientName: row.clientName,
      projectName: project.projectName,
      reference: project.reference,
      organisation: project.organisation,
      contactName: project.contactName,
      contactEmail: project.contactEmail,
      coverageInterest: project.coverageInterest,
      matterSummary: project.matterSummary,
      status: project.status,
      origin: project.origin,
      issuedBy: row.issuedBy,
      createdAt: project.createdAt.toISOString(),
      expiresAt: project.expiresAt.toISOString(),
      lastAccessAt: project.lastAccessAt?.toISOString() ?? null,
      proposalSentAt: project.proposalSentAt?.toISOString() ?? null,
    },
    documents: documents.map((doc) => ({ ...doc, completedAt: doc.completedAt?.toISOString() ?? null })),
    events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  });
}

async function updateProject(req: Request, user: DeskUser, projectId: number): Promise<Response> {
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
    actor: user.email,
    detail: `status set to ${status}`,
    ipHash: hashIp(clientIp(req)),
  });
  return json({ ok: true, status });
}

/** Issues a fresh code and silently retires the old link. */
async function rotate(req: Request, user: DeskUser, projectId: number): Promise<Response> {
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
    actor: user.email,
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
async function download(req: Request, user: DeskUser, documentId: number): Promise<Response> {
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
    actor: user.email,
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
  if (!originAllowed(req)) return failure("Request refused.", 403);

  const user = await authenticate(req);
  if (!user) return unauthorised();

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../desk/<resource>/<id?>/<action?>
  const deskIndex = segments.indexOf("desk");
  const [resource, rawId, action] = segments.slice(deskIndex + 1);
  const id = Number(rawId);

  try {
    if (resource === "session") return json({ ok: true, user, mailerConfigured: mailerConfigured() });
    if (resource === "clients" && !rawId && req.method === "GET") return await listClients();
    if (resource === "proposals" && !rawId && req.method === "POST") return await sendProposal(req, user);
    if (resource === "projects" && !rawId) {
      if (req.method === "GET") return await listProjects();
      if (req.method === "POST") return await openProject(req, user);
    }
    if (resource === "projects" && Number.isInteger(id)) {
      if (action === "rotate" && req.method === "POST") return await rotate(req, user, id);
      if (!action && req.method === "GET") return await projectDetail(id);
      if (!action && req.method === "PATCH") return await updateProject(req, user, id);
    }
    if (resource === "documents" && Number.isInteger(id) && req.method === "GET") {
      return await download(req, user, id);
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
    "/api/underwriting/desk/clients",
    "/api/underwriting/desk/proposals",
    "/api/underwriting/desk/projects",
    "/api/underwriting/desk/projects/:id",
    "/api/underwriting/desk/projects/:id/rotate",
    "/api/underwriting/desk/documents/:id",
  ],
};
