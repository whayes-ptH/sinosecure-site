import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, count, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { underwritingEvents, underwritingSessions, underwritingUsers } from "../db/schema.js";
import { clientIp, failure, hashIp } from "./underwriting.js";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "sino_uw_session";
/** A trading day. Long enough not to nag, short enough that a shared laptop goes cold. */
export const SESSION_HOURS = 12;
export const MIN_PASSWORD_LENGTH = 12;
export const USER_ROLES = ["admin", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MINUTES = 15;
const TOUCH_AFTER_MINUTES = 5;
const KEY_LENGTH = 64;

export type DeskUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) return null;
  return email;
}

/** Length is the only rule that reliably helps; anything shorter is refused outright. */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > 200) return "That password is too long.";
  return null;
}

export async function hashPassword(password: string): Promise<{ passwordHash: string; passwordSalt: string }> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
}

export async function verifyPassword(password: string, passwordHash: string, passwordSalt: string): Promise<boolean> {
  const derived = await scrypt(password.normalize("NFKC"), Buffer.from(passwordSalt, "hex"), KEY_LENGTH);
  const expected = Buffer.from(passwordHash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/** A readable one-off password for a new account, spoken down a phone if need be. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 18; i += 1) out += alphabet[randomInt(alphabet.length)];
  return `${out.slice(0, 6)}-${out.slice(6, 12)}-${out.slice(12)}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(`sinosecure:session:${token}`).digest("hex");
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

function cookieAttributes(maxAgeSeconds: number): string {
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(SESSION_HOURS * 3600)}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}

export async function startSession(userId: number, req: Request): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(underwritingSessions).values({
    tokenHash: hashToken(token),
    userId,
    ipHash: hashIp(clientIp(req)),
    expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000),
  });
  // Opportunistic tidy-up so expired rows do not accumulate.
  await db.delete(underwritingSessions).where(lt(underwritingSessions.expiresAt, new Date()));
  return token;
}

export async function endSession(req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (!token) return;
  await db.delete(underwritingSessions).where(eq(underwritingSessions.tokenHash, hashToken(token)));
}

/** Drops every other session for a user — used after a password change. */
export async function endOtherSessions(userId: number, req: Request): Promise<void> {
  const token = readSessionToken(req);
  const keep = token ? hashToken(token) : "";
  await db
    .delete(underwritingSessions)
    .where(and(eq(underwritingSessions.userId, userId), ne(underwritingSessions.tokenHash, keep)));
}

export async function endAllSessions(userId: number): Promise<void> {
  await db.delete(underwritingSessions).where(eq(underwritingSessions.userId, userId));
}

/** Resolves the session cookie to a live, active account, or null. */
export async function authenticate(req: Request): Promise<DeskUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      sessionId: underwritingSessions.id,
      expiresAt: underwritingSessions.expiresAt,
      lastSeenAt: underwritingSessions.lastSeenAt,
      id: underwritingUsers.id,
      email: underwritingUsers.email,
      name: underwritingUsers.name,
      role: underwritingUsers.role,
      status: underwritingUsers.status,
      mustChangePassword: underwritingUsers.mustChangePassword,
    })
    .from(underwritingSessions)
    .innerJoin(underwritingUsers, eq(underwritingSessions.userId, underwritingUsers.id))
    .where(eq(underwritingSessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now() || row.status !== "active") {
    await db.delete(underwritingSessions).where(eq(underwritingSessions.id, row.sessionId));
    return null;
  }

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MINUTES * 60 * 1000) {
    await db
      .update(underwritingSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(underwritingSessions.id, row.sessionId));
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "staff",
    mustChangePassword: row.mustChangePassword,
  };
}

/**
 * The session cookie is SameSite=Lax, so a cross-site form post never carries it.
 * This closes the remaining gap: a browser always sends Origin on a state-changing
 * fetch, and it has to match the host being called.
 */
export function originAllowed(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function userCount(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(underwritingUsers);
  return row?.total ?? 0;
}

export async function activeAdminCount(exceptUserId?: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(underwritingUsers)
    .where(
      exceptUserId
        ? and(
            eq(underwritingUsers.role, "admin"),
            eq(underwritingUsers.status, "active"),
            ne(underwritingUsers.id, exceptUserId),
          )
        : and(eq(underwritingUsers.role, "admin"), eq(underwritingUsers.status, "active")),
    );
  return row?.total ?? 0;
}

/** Repeated failures from one address stop being answered, whatever the email. */
export async function loginThrottled(req: Request): Promise<boolean> {
  const ipHash = hashIp(clientIp(req));
  if (!ipHash) return false;
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000);
  const [row] = await db
    .select({ attempts: count() })
    .from(underwritingEvents)
    .where(
      and(
        eq(underwritingEvents.type, "auth.denied"),
        eq(underwritingEvents.ipHash, ipHash),
        gt(underwritingEvents.createdAt, since),
      ),
    );
  return (row?.attempts ?? 0) >= MAX_LOGIN_ATTEMPTS;
}

export function unauthorised(): Response {
  return failure("Please sign in again.", 401, { authenticated: false });
}

export function forbidden(message = "That action needs an administrator."): Response {
  return failure(message, 403);
}
