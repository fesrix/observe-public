import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { hash, argon2id } from "argon2";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { dateKey, today, DAYS, MONTHS } from "../../src/lib/calendar";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/lingua_test"
)
  throw new Error(
    "E2E tests require an isolated localhost lingua_test database.",
  );
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
test.afterAll(() => db.$disconnect());
test("Admin publishes an academy class and a TTC student books and cancels an observation", async ({
  page,
}, testInfo) => {
  // The test server is loopback-only; simulate an independent trusted proxy client.
  await page.setExtraHTTPHeaders({ "X-Real-IP": `e2e-${randomUUID()}` });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const key = randomUUID().slice(0, 8),
    email = `e2e-${key}@example.test`,
    password = randomBytes(20).toString("hex");
  await db.user.create({
    data: {
      name: "Alex Administrator",
      email,
      role: "ADMIN",
      passwordHash: await hash(password, { type: argon2id }),
    },
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Let’s keep growing." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/login-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "School administrator? Sign in" })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Alex." }),
  ).toBeVisible();
  const navigate = async (name: string) => {
    if (testInfo.project.name === "mobile")
      await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  };
  await navigate("Students");
  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByLabel("Full name").fill(`Jordan ${key}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  const code = await page.locator(".secret-code").textContent();
  expect(code).toHaveLength(43);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await navigate("Classes");
  await page.getByRole("button", { name: "Create class" }).click();
  await page
    .getByLabel("Class level and name")
    .fill(`Family and Friends ${key}`);
  await page
    .getByLabel("Class notes (optional)")
    .fill("Build confidence together, one conversation at a time.");
  await page.getByLabel("Instructor", { exact: true }).fill("Taylor");
  await page
    .getByLabel("Classroom / location", { exact: true })
    .fill("Studio 2");
  await page.getByRole("button", { name: "Save changes" }).click();
  const card = page
    .locator(".course-card")
    .filter({ hasText: `Family and Friends ${key}` });
  await card.getByRole("button", { name: "Publish schedule" }).click();
  await page.getByRole("button", { name: /^Starts:/ }).click();
  await expect(page.locator(".react-aria-Calendar")).toBeVisible();
  const calendarText = await page.locator(".react-aria-Calendar").innerText();
  expect(calendarText).toContain(String(today().year));
  expect(calendarText).not.toMatch(/[\u0600-\u06ff]/);
  await page.keyboard.press("Escape");
  // Choose tomorrow's weekday; default range includes the next three months.
  const weekday = (new Date(Date.now() + 86400_000).getUTCDay() + 1) % 7;
  await page.getByLabel("Weekday 1").selectOption(String(weekday));
  await page.getByRole("button", { name: "Add weekly slot" }).click();
  await page.getByLabel("Weekday 2").selectOption(String((weekday + 2) % 7));
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before confirming" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Private access code", { exact: true }).fill(code!);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Good to see you, Jordan." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await navigate("Calendar");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  const chips = page
    .locator(".agenda .session-chip")
    .filter({ hasText: `Family and Friends ${key}` });
  if ((await chips.count()) === 0) {
    await page.getByRole("button", { name: "Next period" }).click();
  }
  await chips.first().click();
  await expect(
    page.getByRole("dialog").getByText("Teacher: Taylor"),
  ).toBeVisible();
  await expect(page.locator(".session-detail")).toContainText(/14:00.*15:00/);
  await page.getByRole("button", { name: "Book this observation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate("My observations");
  await expect(
    page
      .locator(".observation-card")
      .getByRole("heading", { name: `Family and Friends ${key}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel observation", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await page
    .locator(".segmented")
    .getByRole("button", { name: /^Cancelled/ })
    .click();
  await expect(
    page.getByText("Student cancellation", { exact: true }),
  ).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({
    where: { user: { name: `Jordan ${key}` } },
  });
  expect(booking.cancelledAt).not.toBeNull();
  expect(
    await db.auditEvent.count({
      where: { subjectId: booking.userId, action: "BOOK_SESSION" },
    }),
  ).toBe(1);
  expect(await page.locator("input[type=date]").count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});

