import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { verify } from "argon2";
import { db, transaction, mutationLock, audit, AppError, type Tx } from "./db";
export const COOKIE = "lingua_session";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export async function viewer() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const session = await db.authSession.findUnique({
    where: { id: digest(raw) },
    include: { user: true },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.active &&
    !session.user.archivedAt
    ? session.user
    : null;
}
export async function authorize(tx: Tx, userId: string, admin = false) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user?.active || user.archivedAt)
    throw new AppError(401, "Please sign in again.");
  if (admin && user.role !== "ADMIN")
    throw new AppError(403, "Administrator access required.");
  return user;
}
export function checkOrigin(request: Request) {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new AppError(503, "APP_ORIGIN is not configured.");
  if (request.headers.get("origin") !== new URL(origin).origin)
    throw new AppError(403, "Request origin is not allowed.");
}
export async function login(
  input: { code?: string; email?: string; password?: string },
  ip: string,
) {
  // Nginx overwrites X-Real-IP. Direct Node listener must remain loopback-only.
  const key = digest(ip);
  const allowed = await transaction(async (tx) => {
    await mutationLock(tx);
    const now = new Date();
    const row = await tx.loginThrottle.findUnique({ where: { key } });
    if (row && row.resetAt > now && row.attempts >= 10) return false;
    await tx.loginThrottle.upsert({
      where: { key },
      create: {
        key,
        attempts: 1,
        resetAt: new Date(now.getTime() + 15 * 60_000),
      },
      update:
        !row || row.resetAt <= now
          ? { attempts: 1, resetAt: new Date(now.getTime() + 15 * 60_000) }
          : { attempts: { increment: 1 } },
    });
    return true;
  });
  if (!allowed)
    throw new AppError(
      429,
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  const credential = input.code
    ? await db.credential.findUnique({
        where: { hash: digest(input.code) },
        include: { user: true },
      })
    : null;
  const user = input.code
    ? credential?.user
    : await db.user.findUnique({
        where: { email: input.email?.toLowerCase() || "" },
      });
  const valid =
    !!user?.active &&
    !user.archivedAt &&
    (input.code
      ? user.role === "STUDENT" || user.role === "TTC_MASTER"
      : user.role === "ADMIN" &&
        !!user.passwordHash &&
        (await verify(user.passwordHash, input.password || "")));
  if (!valid || !user) {
    await transaction((tx) =>
      audit(
        tx,
        null,
        "SIGN_IN",
        null,
        { method: input.code ? "code" : "password" },
        "DENIED",
      ),
    );
    throw new AppError(401, "The sign-in details are incorrect.");
  }
  const raw = secret();
  await transaction(async (tx) => {
    await mutationLock(tx);
    await authorize(tx, user.id);
    if (
      input.code &&
      (await tx.credential.findUnique({ where: { userId: user.id } }))?.hash !==
        digest(input.code)
    )
      throw new AppError(401, "Access code was replaced.");
    if (
      !input.code &&
      (await tx.user.findUnique({ where: { id: user.id } }))?.passwordHash !==
        user.passwordHash
    )
      throw new AppError(401, "Password was changed.");
    await tx.authSession.create({
      data: {
        id: digest(raw),
        userId: user.id,
        expiresAt: new Date(
          Date.now() + (user.role === "STUDENT" ? 24 : 8) * 3600_000,
        ),
      },
    });
    // Successful sign-ins must not exhaust a school's shared-IP failure budget.
    await tx.loginThrottle.deleteMany({ where: { key } });
    await audit(tx, user.id, "SIGN_IN", user.id);
  });
  return raw;
}
