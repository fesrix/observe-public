import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { today, dateKey, instant, MONTHS } from "../../src/lib/calendar";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  new URL(url).pathname != "/lingua_test"
)
  throw new Error("Isolated test database required");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
test.afterAll(() => db.$disconnect());
test("Compact calendar filters and opens selected-day sessions", async ({
  page,
}, info) => {
  const key = randomUUID().slice(0, 8),
    code = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: { name: "Calendar fixture" } });
  await db.credential.create({
    data: {
      userId: user.id,
      hash: createHash("sha256").update(code).digest("hex"),
    },
  });
  const day = today().add({ days: 2 }),
    dayKey = dateKey(day);
  for (let i = 0; i < 4; i++) {
    const teacher = i === 0 ? `Unique teacher ${key}` : "Other teacher";
    const course = await db.course.create({
      data: {
        title: `Calendar ${key} ${i}`,
        instructor: teacher,
        location: "Room C",
        capacity: 1,
      },
    });
    const startAt = instant(dayKey, `${String(12 + i).padStart(2, "0")}:00`);
    await db.classSession.create({
      data: {
        courseId: course.id,
        startAt,
        endAt: new Date(+startAt + 3600000),
        instructor: teacher,
        location: "Room C",
        capacity: 1,
      },
    });
  }
  await page.setExtraHTTPHeaders({ "X-Real-IP": randomUUID() });
  await page.goto("/");
  await page.getByLabel("Private access code").fill(code);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  if (day.month !== today().month)
    await page.getByRole("button", { name: "Next period" }).click();
  const dayButton = page.getByRole("button", {
    name: new RegExp(`^${day.day} ${MONTHS[day.month - 1]} ${day.year},`),
  });
  await dayButton.press("Enter");
  await expect(page.locator(".calendar-day-list")).toContainText(
    `Unique teacher ${key}`,
  );
  await expect(page.locator(".calendar-day-list")).toContainText("Room C");
  await page
    .getByLabel("Search calendar classes or teachers")
    .fill(`Unique teacher ${key}`);
  await expect(
    page.locator(".calendar-day-cards .calendar-detail-card"),
  ).toHaveCount(1);
  await page
    .getByLabel("Filter calendar availability")
    .selectOption("reserved");
  await expect(page.getByText("No matching sessions").first()).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(
    page
      .locator(".calendar-day-cards .calendar-detail-card")
      .filter({ hasText: key }),
  ).toHaveCount(4);
  await page.getByLabel("Search calendar classes or teachers").fill(key);
  await expect(page.locator(".calendar-day-cards .calendar-detail-card")).toHaveCount(4);
  await page.screenshot({path:`test-results/compact-calendar-${info.project.name}.png`,fullPage:true});
  await page
    .locator(".calendar-day-cards .calendar-detail-card")
    .filter({ hasText: key })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(`Unique teacher ${key}`);
  await expect(
    page.getByRole("button", { name: "Book this observation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
