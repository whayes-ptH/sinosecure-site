import type { Config } from "@netlify/functions";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { underwritingUsers } from "../../db/schema.js";
import {
  USER_ROLES,
  activeAdminCount,
  authenticate,
  clearedSessionCookie,
  endAllSessions,
  endOtherSessions,
  endSession,
  forbidden,
  hashPassword,
  loginThrottled,
  normaliseEmail,
  originAllowed,
  passwordProblem,
  sessionCookie,
  startSession,
  temporaryPassword,
  unauthorised,
  userCount,
  verifyPassword,
  type DeskUser,
} from "../../lib/auth.js";
import {
  adminKeyConfigured,
  clampText,
  clientIp,
  failure,
  hashIp,
  json,
  matchesAdminKey,
} from "../../lib/underwriting.js";
import { logEvent } from "../../lib/portal.js";
import { mailerConfigured } from "../../lib/proposal.js";

function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

function publicUser(user: DeskUser) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
}

/** Tells the sign-in screen which of the three states it is in before anything is typed. */
async function status(req: Request): Promise<Response> {
  const user = await authenticate(req);
  if (user) {
    return json({ ok: true, authenticated: true, user: publicUser(user), mailerConfigured: mailerConfigured() });
  }
  return json({
    ok: true,
    authenticated: false,
    needsSetup: (await userCount()) === 0,
    bootstrapReady: adminKeyConfigured(),
  });
}

/**
 * One-time creation of the first administrator. Allowed only while no account exists,
 * and only against UNDERWRITING_ADMIN_KEY — after this the key is never asked for again.
 */
async function setup(req: Request): Promise<Response> {
  if (!adminKeyConfigured()) {
    return failure(
      "Set UNDERWRITING_ADMIN_KEY in the Netlify environment (at least 16 characters), redeploy, then create the first administrator here.",
      503,
      { bootstrapReady: false },
    );
  }
  if ((await userCount()) > 0) return failure("The console has already been set up. Please sign in.", 409);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!matchesAdminKey(body?.adminKey)) {
    await logEvent({ type: "auth.denied", actor: "setup", detail: "bad bootstrap key", ipHash: hashIp(clientIp(req)) });
    return failure("That setup key was not recognised.", 401);
  }

  const email = normaliseEmail(body?.email);
  const name = clampText(body?.name, 120);
  const problem = passwordProblem(body?.password);
  if (!email) return failure("Enter a valid email address.");
  if (!name) return failure("Enter the account holder's name.");
  if (problem) return failure(problem);

  const { passwordHash, passwordSalt } = await hashPassword(body!.password as string);
  const [created] = await db
    .insert(underwritingUsers)
    .values({ email, name, role: "admin", passwordHash, passwordSalt, lastLoginAt: new Date() })
    .returning({ id: underwritingUsers.id, email: underwritingUsers.email, name: underwritingUsers.name });

  await logEvent({ type: "auth.setup", actor: created.email, detail: "first administrator created", ipHash: hashIp(clientIp(req)) });
  const token = await startSession(created.id, req);
  return withCookie(
    json({
      ok: true,
      user: { id: created.id, email: created.email, name: created.name, role: "admin", mustChangePassword: false },
      mailerConfigured: mailerConfigured(),
    }),
    sessionCookie(token),
  );
}

/** Burns the same scrypt work as a real check, so a missing account looks identical. */
async function decoyVerify(password: string): Promise<false> {
  const { passwordHash, passwordSalt } = await hashPassword("sinosecure:no-such-account");
  await verifyPassword(password, passwordHash, passwordSalt);
  return false;
}

async function login(req: Request): Promise<Response> {
  if (await loginThrottled(req)) {
    return failure("Too many sign-in attempts. Please try again shortly.", 429);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normaliseEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const ipHash = hashIp(clientIp(req));

  const [account] = email
    ? await db.select().from(underwritingUsers).where(eq(underwritingUsers.email, email)).limit(1)
    : [];

  // The same answer either way, and the same work either way: an unknown address is
  // still put through a hash so it cannot be told apart from a wrong password by timing.
  const ok = account
    ? await verifyPassword(password, account.passwordHash, account.passwordSalt)
    : await decoyVerify(password);
  if (!account || !ok || account.status !== "active") {
    await logEvent({ type: "auth.denied", actor: email ?? "unknown", detail: "sign-in refused", ipHash });
    return failure("Those sign-in details were not recognised.", 401);
  }

  await db.update(underwritingUsers).set({ lastLoginAt: new Date() }).where(eq(underwritingUsers.id, account.id));
  await logEvent({ type: "auth.signin", actor: account.email, detail: null, ipHash });

  const token = await startSession(account.id, req);
  return withCookie(
    json({
      ok: true,
      user: {
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role === "admin" ? "admin" : "staff",
        mustChangePassword: account.mustChangePassword,
      },
      mailerConfigured: mailerConfigured(),
    }),
    sessionCookie(token),
  );
}

async function logout(req: Request): Promise<Response> {
  await endSession(req);
  return withCookie(json({ ok: true }), clearedSessionCookie());
}

async function changePassword(req: Request, user: DeskUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const problem = passwordProblem(body?.newPassword);
  if (problem) return failure(problem);

  const [account] = await db.select().from(underwritingUsers).where(eq(underwritingUsers.id, user.id)).limit(1);
  if (!account) return unauthorised();

  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  if (!(await verifyPassword(current, account.passwordHash, account.passwordSalt))) {
    return failure("That current password is not correct.", 401);
  }

  const { passwordHash, passwordSalt } = await hashPassword(body!.newPassword as string);
  await db
    .update(underwritingUsers)
    .set({ passwordHash, passwordSalt, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(underwritingUsers.id, user.id));
  await endOtherSessions(user.id, req);
  await logEvent({ type: "auth.password_changed", actor: user.email, detail: null, ipHash: hashIp(clientIp(req)) });
  return json({ ok: true, user: { ...publicUser(user), mustChangePassword: false } });
}

async function listUsers(): Promise<Response> {
  const rows = await db
    .select({
      id: underwritingUsers.id,
      email: underwritingUsers.email,
      name: underwritingUsers.name,
      role: underwritingUsers.role,
      status: underwritingUsers.status,
      mustChangePassword: underwritingUsers.mustChangePassword,
      createdAt: underwritingUsers.createdAt,
      lastLoginAt: underwritingUsers.lastLoginAt,
    })
    .from(underwritingUsers)
    .orderBy(asc(underwritingUsers.name));

  return json({
    ok: true,
    users: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    })),
  });
}

/** Creates a colleague with a one-off password shown to the administrator once. */
async function createUser(req: Request, admin: DeskUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = normaliseEmail(body?.email);
  const name = clampText(body?.name, 120);
  const requestedRole = clampText(body?.role, 10) ?? "staff";
  const role = (USER_ROLES as readonly string[]).includes(requestedRole) ? requestedRole : "staff";
  if (!email) return failure("Enter a valid email address.");
  if (!name) return failure("Enter the colleague's name.");

  const [existing] = await db.select({ id: underwritingUsers.id }).from(underwritingUsers).where(eq(underwritingUsers.email, email)).limit(1);
  if (existing) return failure("An account already exists for that address.", 409);

  const password = temporaryPassword();
  const { passwordHash, passwordSalt } = await hashPassword(password);
  const [created] = await db
    .insert(underwritingUsers)
    .values({ email, name, role, passwordHash, passwordSalt, mustChangePassword: true })
    .returning({
      id: underwritingUsers.id,
      email: underwritingUsers.email,
      name: underwritingUsers.name,
      role: underwritingUsers.role,
      status: underwritingUsers.status,
      mustChangePassword: underwritingUsers.mustChangePassword,
      createdAt: underwritingUsers.createdAt,
    });

  await logEvent({ type: "auth.user_created", actor: admin.email, detail: created.email, ipHash: hashIp(clientIp(req)) });
  return json({
    ok: true,
    user: { ...created, createdAt: created.createdAt.toISOString(), lastLoginAt: null },
    temporaryPassword: password,
  });
}

/** Role, access and password resets. Guarded so the last administrator cannot be locked out. */
async function updateUser(req: Request, admin: DeskUser, userId: number): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const [account] = await db.select().from(underwritingUsers).where(eq(underwritingUsers.id, userId)).limit(1);
  if (!account) return failure("Unknown account.", 404);

  const ipHash = hashIp(clientIp(req));

  if (body?.resetPassword === true) {
    const password = temporaryPassword();
    const { passwordHash, passwordSalt } = await hashPassword(password);
    await db
      .update(underwritingUsers)
      .set({ passwordHash, passwordSalt, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(underwritingUsers.id, userId));
    await endAllSessions(userId);
    await logEvent({ type: "auth.password_reset", actor: admin.email, detail: account.email, ipHash });
    return json({ ok: true, temporaryPassword: password, user: { id: userId, mustChangePassword: true } });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const role = clampText(body?.role, 10);
  const state = clampText(body?.status, 10);

  if (role && (USER_ROLES as readonly string[]).includes(role) && role !== account.role) {
    if (account.role === "admin" && role !== "admin" && (await activeAdminCount(userId)) === 0) {
      return failure("There has to be at least one active administrator.", 409);
    }
    patch.role = role;
  }
  if (state && (state === "active" || state === "disabled") && state !== account.status) {
    if (account.id === admin.id) return failure("You cannot disable your own account.", 409);
    if (state === "disabled" && account.role === "admin" && (await activeAdminCount(userId)) === 0) {
      return failure("There has to be at least one active administrator.", 409);
    }
    patch.status = state;
  }

  if (Object.keys(patch).length === 1) return failure("Nothing to change.");

  const [updated] = await db
    .update(underwritingUsers)
    .set(patch)
    .where(eq(underwritingUsers.id, userId))
    .returning({ id: underwritingUsers.id, role: underwritingUsers.role, status: underwritingUsers.status });

  if (patch.status === "disabled") await endAllSessions(userId);
  await logEvent({
    type: "auth.user_updated",
    actor: admin.email,
    detail: `${account.email}: ${patch.role ? `role ${patch.role} ` : ""}${patch.status ? `access ${patch.status}` : ""}`.trim(),
    ipHash,
  });
  return json({ ok: true, user: updated });
}

export default async (req: Request): Promise<Response> => {
  if (!originAllowed(req)) return failure("Request refused.", 403);

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const deskIndex = segments.indexOf("desk");
  const [resource, second, third] = segments.slice(deskIndex + 1);

  try {
    if (resource === "auth") {
      if (second === "status" && req.method === "GET") return await status(req);
      if (second === "setup" && req.method === "POST") return await setup(req);
      if (second === "login" && req.method === "POST") return await login(req);
      if (second === "logout" && req.method === "POST") return await logout(req);
      if (second === "password" && req.method === "POST") {
        const user = await authenticate(req);
        return user ? await changePassword(req, user) : unauthorised();
      }
      return failure("Not found.", 404);
    }

    if (resource === "users") {
      const user = await authenticate(req);
      if (!user) return unauthorised();
      if (user.role !== "admin") return forbidden("Only an administrator can manage console accounts.");

      if (!second) {
        if (req.method === "GET") return await listUsers();
        if (req.method === "POST") return await createUser(req, user);
      }
      const id = Number(second);
      if (Number.isInteger(id) && !third && req.method === "PATCH") return await updateUser(req, user, id);
    }

    return failure("Not found.", 404);
  } catch (error) {
    console.error("underwriting auth error", error);
    return failure("Something went wrong handling that request.", 500);
  }
};

export const config: Config = {
  path: [
    "/api/underwriting/desk/auth/status",
    "/api/underwriting/desk/auth/setup",
    "/api/underwriting/desk/auth/login",
    "/api/underwriting/desk/auth/logout",
    "/api/underwriting/desk/auth/password",
    "/api/underwriting/desk/users",
    "/api/underwriting/desk/users/:id",
  ],
};
