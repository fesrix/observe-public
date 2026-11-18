import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { hash, argon2id } from "argon2";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { instant, today, dateKey } from "../../src/lib/calendar";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  new URL(url).pathname != "/lingua_test"
)
  throw new Error("Isolated localhost database required");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
test.afterAll(() => db.$disconnect());
test("Admin creates a TTC Master who reviews observers, feedback and activity without write access", async ({
  page,
}, info) => {
  const key = randomUUID().slice(0, 8),
    email = `master-test-${key}@example.test`,
    password = randomBytes(24).toString("hex");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await db.user.create({
    data: {
      name: "Master Test Administrator",
      email,
      role: "ADMIN",
      passwordHash: await hash(password, { type: argon2id }),
    },
  });
  const student = await db.user.create({ data: { name: `Observer ${key}` } });
  const course = await db.course.create({
    data: {
      title: `Master review class ${key}`,
      instructor: "Casey",
      location: "Studio 3",
      capacity: 1,
    },
  });
  const startAt = instant(dateKey(today().add({ days: 2 })), "14:00");
  const reserved = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt,
      endAt: new Date(+startAt + 3600000),
      instructor: "Casey",
      location: "Studio 3",
      capacity: 1,
    },
  });
  const available = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt: new Date(+startAt + 3600000),
      endAt: new Date(+startAt + 7200000),
      instructor: "Casey",
      location: "Studio 3",
      capacity: 1,
    },
  });
  const future = await db.booking.create({
    data: {
      userId: student.id,
      sessionId: reserved.id,
      requestKey: randomUUID(),
    },
  });
  const past = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt: new Date(Date.now() - 7200000),
      endAt: new Date(Date.now() - 3600000),
      instructor: "Casey",
      location: "Studio 3",
      capacity: 1,
    },
  });
  const old = await db.booking.create({
    data: { userId: student.id, sessionId: past.id, requestKey: randomUUID() },
  });
  await db.bookingFeedback.create({
    data: {
      bookingId: old.id,
      body: `Feedback visible to the TTC Master ${key}`,
    },
  });
  await db.auditEvent.create({
    data: {
      actorId: student.id,
      subjectId: student.id,
      action: "BOOK_SESSION",
      details: { sessionId: reserved.id },
    },
  });
  await page.setExtraHTTPHeaders({ "X-Real-IP": randomUUID() });
  await page.goto("/");
  await page
    .getByRole("button", { name: "School administrator? Sign in" })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  const navigate = async (name: string) => {
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  };
  await expect(
    page.getByRole("heading", { name: "Good to see you, Master." }),
  ).toBeVisible();
  await navigate("TTC masters");
  await page.getByRole("button", { name: "Add TTC master" }).click();
  await page.getByLabel("Full name").fill(`TTC Reviewer ${key}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  const code = await page.locator(".secret-code").innerText();
  expect(code.length).toBe(43);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const created = await db.user.findFirstOrThrow({
    where: { name: `TTC Reviewer ${key}` },
  });
  expect(created.role).toBe("TTC_MASTER");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Private access code").fill(code);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(page.locator(".read-only-notice")).toContainText("TTC Master");
  await expect(
    page.getByRole("button", { name: "Manage classes" }),
  ).toHaveCount(0);
  await navigate("Students");
  const row = page.getByRole("row").filter({ hasText: student.name });
  await expect(row).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "Observations", exact: true }).click();
  await expect(page.getByLabel("Filter observations by student")).toHaveValue(
    student.id,
  );
  await expect(page.locator(".observation-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Cancel observation", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".segmented")
    .getByRole("button", { name: /^Past/ })
    .click();
  await page
    .locator(".observation-card")
    .getByRole("button", { name: "View details" })
    .click();
  await expect(page.locator(".observation-feedback-read")).toContainText(
    `Feedback visible to the TTC Master ${key}`,
  );
  await expect(page.getByRole("button", { name: "Edit feedback" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: `test-results/ttc-master-${info.project.name}.png`,
    fullPage: true,
  });
  await navigate("Calendar");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const chips = page
    .locator(".agenda .session-chip")
    .filter({ hasText: course.title });
  if ((await chips.count()) === 0)
    await page.getByRole("button", { name: "Next period" }).click();
  await expect(chips.filter({ hasText: "Reserved" })).toHaveCount(2);
  await expect(chips.filter({ hasText: "Available" })).toHaveCount(1);
  await chips.filter({ hasText: "Reserved" }).last().press("Enter");
  await expect(page.getByRole("dialog")).toContainText(
    `Observer: ${student.name}`,
  );
  await expect(page.getByRole("dialog")).toContainText("Read-only access");
  for (const name of [
    "Book this observation",
    "Cancel session",
    "Edit session",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await page.keyboard.press("Escape");
  await navigate("Classes");
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish schedule" }),
  ).toHaveCount(0);
  await navigate("Activity");
  await expect(page.locator(".activity-list")).toContainText("book session");
  const original = await db.booking.findUniqueOrThrow({
    where: { id: future.id },
  });
  for (const command of [
    { action: "book", sessionId: available.id, requestKey: randomUUID() },
    { action: "cancelBooking", id: future.id },
    {
      action: "saveObservationFeedback",
      bookingId: old.id,
      body: "Forbidden edit",
    },
    { action: "createUser", name: "Forbidden account", role: "TTC_MASTER" },
    { action: "rotateCode", id: student.id },
  ])
    expect(
      (
        await page.request.post("/api/commands", {
          headers: { Origin: "http://127.0.0.1:3100" },
          data: command,
        })
      ).status(),
    ).toBe(403);
  expect(
    await db.booking.findUniqueOrThrow({ where: { id: future.id } }),
  ).toEqual(original);
  expect(
    (
      await db.bookingFeedback.findUniqueOrThrow({
        where: { bookingId: old.id },
      })
    ).body,
  ).toBe(`Feedback visible to the TTC Master ${key}`);
  expect(errors).toEqual([]);
});

