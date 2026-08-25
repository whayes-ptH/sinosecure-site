import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

/** Crockford base32 — no I, L, O or U, so codes survive being read down a phone line. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ACCESS_CODE_LENGTH = 16;
export const REFERENCE_LENGTH = 8;
export const DEFAULT_EXPIRY_DAYS = 90;
export const MAX_EXPIRY_DAYS = 365;
/** Client-side slice size. Netlify caps a synchronous function request at 6 MB. */
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_PROJECT = 40;
export const MAX_FAILED_ATTEMPTS = 12;
export const ATTEMPT_WINDOW_MINUTES = 15;

/** Document formats an underwriting package legitimately arrives in. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "rtf", "odt", "txt",
  "xls", "xlsx", "csv", "ods",
  "ppt", "pptx",
  "jpg", "jpeg", "png", "tif", "tiff", "heic", "webp",
  "zip", "7z", "msg", "eml", "xml", "json",
] as const;

export const COVERAGE_INTERESTS = [
  "Marine and cargo",
  "Financial guarantee",
  "Indemnity and liability",
  "Specialty risk",
  "Other",
] as const;

export const PROJECT_STATUSES = ["open", "in_review", "closed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

function randomToken(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function group(value: string): string {
  return (value.match(/.{1,4}/g) ?? []).join("-");
}

/** The secret half: what goes in the upload link and nowhere else. */
export function createAccessCode(): string {
  return randomToken(ACCESS_CODE_LENGTH);
}

/** The quotable half: safe to print on a term sheet or in an email subject. */
export function createReference(): string {
  return `SR-${group(randomToken(REFERENCE_LENGTH))}`;
}

export function formatAccessCode(code: string): string {
  return `SS-${group(code)}`;
}

/**
 * Accepts anything a client might paste — with or without the SS- prefix, dashes,
 * spaces, or the Crockford look-alikes (I/L becomes 1, O becomes 0, U becomes V).
 */
export function normaliseAccessCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^SS/, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
  if (cleaned.length !== ACCESS_CODE_LENGTH) return null;
  if (![...cleaned].every((char) => ALPHABET.includes(char))) return null;
  return cleaned;
}

export function normaliseReference(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^SR/, "");
  if (cleaned.length !== REFERENCE_LENGTH) return null;
  return `SR-${group(cleaned)}`;
}

export function hashAccessCode(normalisedCode: string): string {
  return createHash("sha256").update(`sinosecure:underwriting:${normalisedCode}`).digest("hex");
}

/** Client addresses are only ever kept as a salted digest, for throttling and audit. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`sinosecure:ip:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

export function extensionOf(fileName: string): string {
  const match = /\.([0-9a-z]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

export function isAllowedFileName(fileName: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Strips directory components and anything that could confuse a download header. */
export function sanitiseFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "document";
  const safe = base.replace(/[\u0000-\u001f\u007f"]/g, "").replace(/\s+/g, " ").trim();
  return (safe.length ? safe : "document").slice(0, 180);
}

export function clampText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.slice(0, max) : null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function documentStore() {
  // Strong consistency: a chunk is written and re-read moments later during assembly.
  return getStore({ name: "underwriting-documents", consistency: "strong" });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export function failure(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, status);
}

/** Constant-time comparison of the console key so the check leaks no timing signal. */
export function isAdminAuthorised(req: Request): boolean {
  const expected = process.env.UNDERWRITING_ADMIN_KEY;
  if (!expected || expected.length < 16) return false;
  const supplied = req.headers.get("x-underwriting-key") ?? "";
  const a = Buffer.from(createHash("sha256").update(supplied).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(expected).digest("hex"));
  return timingSafeEqual(a, b);
}

export function adminKeyConfigured(): boolean {
  const expected = process.env.UNDERWRITING_ADMIN_KEY;
  return Boolean(expected && expected.length >= 16);
}

export function siteOrigin(): string {
  return (process.env.URL ?? "https://sinosecure.eu").replace(/\/$/, "");
}

export function uploadLink(accessCode: string): string {
  return `${siteOrigin()}/secure-upload/${formatAccessCode(accessCode)}`;
}

/**
 * Best-effort alert to the underwriting desk via Netlify Forms, which already carries
 * the site's notification routing. Never allowed to fail the caller's request.
 */
async function submitForm(formName: string, fields: Record<string, string>): Promise<void> {
  try {
    const body = new URLSearchParams({ "form-name": formName, ...fields });
    await fetch(`${siteOrigin()}/__forms.html`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    // Notification is a convenience; the audit trail in Postgres is the record of truth.
  }
}

export function notifyDesk(fields: Record<string, string>): Promise<void> {
  return submitForm("sino-document-activity", fields);
}

export function expiryFromNow(days: number): Date {
  const safeDays = Math.min(Math.max(Math.round(days) || DEFAULT_EXPIRY_DAYS, 1), MAX_EXPIRY_DAYS);
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}
