import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * An underwriting matter. The `reference` is the non-secret identifier quoted in
 * proposals and correspondence; `accessCodeHash` is the SHA-256 of the secret code
 * that unlocks the upload portal. The plaintext code is never stored.
 */
export const underwritingProjects = pgTable("underwriting_projects", {
  id: serial().primaryKey(),
  reference: text().notNull().unique(),
  accessCodeHash: text("access_code_hash").notNull().unique(),
  organisation: text(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  coverageInterest: text("coverage_interest"),
  matterSummary: text("matter_summary"),
  status: text().notNull().default("open"),
  origin: text().notNull().default("client"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
});

/**
 * One row per file. Rows start as `pending` while chunks are streamed into Blobs
 * and flip to `stored` once the object has been assembled and checksummed.
 */
export const underwritingDocuments = pgTable(
  "underwriting_documents",
  {
    id: serial().primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => underwritingProjects.id),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    chunkTotal: integer("chunk_total").notNull().default(1),
    chunksReceived: integer("chunks_received").notNull().default(0),
    checksum: text(),
    status: text().notNull().default("pending"),
    uploadedBy: text("uploaded_by"),
    note: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("underwriting_documents_project_idx").on(table.projectId)],
);

/** Append-only audit trail: who touched a matter, when, and from where. */
export const underwritingEvents = pgTable(
  "underwriting_events",
  {
    id: serial().primaryKey(),
    projectId: integer("project_id").references(() => underwritingProjects.id),
    type: text().notNull(),
    actor: text().notNull(),
    detail: text(),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("underwriting_events_project_idx").on(table.projectId),
    index("underwriting_events_created_idx").on(table.createdAt),
  ],
);
