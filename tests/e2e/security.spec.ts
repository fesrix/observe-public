import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/lingua_test"
)
  throw new Error("An isolated localhost test database is required.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
test.afterAll(() => db.$disconnect());
test("HTTP authentication, CSRF, role restrictions, and revocation", async ({
  request,
}) => {
  const code = randomBytes(32).toString("base64url");
  const user = await db.user.create({
    data: { name: "Security test student" },
  });
  await db.credential.create({
    data: {
      userId: user.id,
      hash: createHash("sha256").update(code).digest("hex"),
    },
  });
  const headers = {
    Origin: "http://127.0.0.1:3100",
    "X-Real-IP": randomUUID(),
  };
  const unauthenticated = await request.get("/api/workspace");
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["cache-control"]).toBe("no-store");
  expect(
    (
      await request.post("/api/auth/login", {
        data: { code },
        headers: { ...headers, Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  const signIn = await request.post("/api/auth/login", {
    data: { code },
    headers,
  });
  expect(signIn.status()).toBe(200);
  expect(signIn.headers()["set-cookie"]).toContain("HttpOnly");
  expect(signIn.headers()["set-cookie"]).toContain("SameSite=strict");
  expect((await request.get("/api/bookings?state=Unknown")).status()).toBe(400);
  expect(
    (
      await request.get("/api/workspace?start=1405-13-40&end=1405-01-01")
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/commands", {
        data: { action: "createUser", name: "Forbidden student" },
        headers,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/commands", {
        data: {
          action: "book",
          sessionId: "not-a-uuid",
          requestKey: randomUUID(),
        },
        headers,
      })
    ).status(),
  ).toBe(400);
  await db.authSession.deleteMany({ where: { userId: user.id } });
  await db.credential.delete({ where: { userId: user.id } });
  expect((await request.get("/api/workspace")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/login", { data: { code }, headers })
    ).status(),
  ).toBe(401);
});
test("Sign-in throttling persists in PostgreSQL and excludes secrets from audit", async ({
  request,
}) => {
  const headers = {
    Origin: "http://127.0.0.1:3100",
    "X-Real-IP": randomUUID(),
  };
  const code = randomBytes(32).toString("base64url");
  for (let i = 0; i < 10; i++)
    expect(
      (
        await request.post("/api/auth/login", { data: { code }, headers })
      ).status(),
    ).toBe(401);
  expect(
    (
      await request.post("/api/auth/login", { data: { code }, headers })
    ).status(),
  ).toBe(429);
  expect(
    await db.auditEvent.count({
      where: { details: { string_contains: code } },
    }),
  ).toBe(0);
});
