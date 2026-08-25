import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A console account. Staff sign in with an email and password; the password is only
 * ever held as a scrypt digest with a per-account salt. The first admin is created
 * once, from the setup screen, using UNDERWRITING_ADMIN_KEY as the bootstrap secret.
 */
export const underwritingUsers = pgTable("underwriting_users", {
  id: serial().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  role: text().notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  status: text().notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** One row per signed-in browser. The cookie carries a token; only its digest is stored. */
export const underwritingSessions = pgTable(
  "underwriting_sessions",
  {
    id: serial().primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => underwritingUsers.id),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("underwriting_sessions_user_idx").on(table.userId)],
);

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
  issuedByUserId: integer("issued_by_user_id").references(() => underwritingUsers.id),
  proposalSentAt: timestamp("proposal_sent_at", { withTimezone: true }),
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
