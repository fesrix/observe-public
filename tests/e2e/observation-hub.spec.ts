import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { instant, dateKey, today } from "../../src/lib/calendar";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  new URL(url).pathname != "/lingua_test"
)
  throw new Error("Isolated localhost test database required");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
test.afterAll(() => db.$disconnect());
test("Observation hub supports search, details, date filters, safe cancellation and mobile layout", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const key = randomUUID().slice(0, 8),
    code = randomBytes(32).toString("base64url");
  const user = await db.user.create({
    data: { name: "Observation hub student" },
  });
  await db.credential.create({
    data: {
      userId: user.id,
      hash: createHash("sha256").update(code).digest("hex"),
    },
  });
  const add = async (
    label: string,
    days: number,
    teacher: string,
    old = false,
    cancelled = false,
  ) => {
    const course = await db.course.create({
      data: {
        title: `${label} ${key}`,
        instructor: teacher,
        location: "Studio 2",
        capacity: 1,
      },
    });
    const startAt = instant(dateKey(today().add({ days })), "14:00");
    const session = await db.classSession.create({
      data: {
        courseId: course.id,
        startAt,
        endAt: new Date(+startAt + 3600000),
        instructor: teacher,
        location: "Studio 2",
        capacity: 1,
      },
    });
    const booking = await db.booking.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        requestKey: randomUUID(),
        createdAt: new Date(Date.now() - (old ? 31 * 60000 : 1000)),
        ...(cancelled
          ? {
              cancelledAt: new Date(),
              cancellationReason: "Student cancellation",
            }
          : {}),
      },
    });
    return { course, booking, session };
  };
  const far = await add("Advanced conversation", 7, "Taylor");
  const near = await add("Young learners", 3, "Casey", true);
  const fresh = await add("Family and Friends", 5, "Morgan");
  await add("Past class", -3, "Avery", true);
  await add("Cancelled class", 6, "Jordan", false, true);
  await page.setExtraHTTPHeaders({ "X-Real-IP": randomUUID() });
  await page.goto("/");
  await page.getByLabel("Private access code").fill(code);
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("button", { name: "My observations", exact: true }),
  ).toBeAttached();
  const navigate = async (name: string) => {
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  };
  await navigate("My observations");
  const cards = page.locator(".observation-card");
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".observation-next")).toContainText(
    near.course.title,
  );
  await expect(cards.first()).toContainText(near.course.title);
  await expect(page.locator(".observation-summary")).toContainText("3");
  await expect(cards.first()).toContainText("Cancellation closed");
  const countdown = cards
    .filter({ hasText: far.course.title })
    .locator(".observation-window");
  const initialCountdown = await countdown.textContent();
  await expect.poll(() => countdown.textContent()).not.toBe(initialCountdown);
  await expect(
    cards.first().getByRole("button", { name: "Cancel observation" }),
  ).toHaveCount(0);
  await cards
    .first()
    .getByRole("button", { name: "View details" })
    .press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Booked on");
  await expect(page.getByRole("dialog")).toContainText("Cancellation deadline");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Search classes or teachers").fill("morgan");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(fresh.course.title);
  await expect(page.locator(".observation-next")).toContainText(
    near.course.title,
  );
  await page
    .getByLabel("Search classes or teachers")
    .fill("no matching teacher");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching observations" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: /^From date:/ }).click();
  await expect(page.locator(".react-aria-Calendar")).toBeVisible();
  expect(await page.locator(".react-aria-Calendar").innerText()).not.toMatch(
    /[\u0600-\u06ff]/,
  );
  await page.keyboard.press("Escape");
  const freshCard = cards.filter({ hasText: fresh.course.title });
  await freshCard.getByRole("button", { name: "Cancel observation" }).click();
  await expect(
    page.getByRole("heading", { name: "Cancel this observation?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep reservation" }).click();
  expect(
    (await db.booking.findUniqueOrThrow({ where: { id: fresh.booking.id } }))
      .cancelledAt,
  ).toBeNull();
  await freshCard.getByRole("button", { name: "Cancel observation" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cards).toHaveCount(2);
  expect(
    (await db.booking.findUniqueOrThrow({ where: { id: fresh.booking.id } }))
      .cancelledAt,
  ).not.toBeNull();
  await page
    .locator(".segmented")
    .getByRole("button", { name: /^Cancelled/ })
    .click();
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: fresh.course.title })).toContainText(
    "Student cancellation",
  );
  await page
    .locator(".segmented")
    .getByRole("button", { name: /^Past/ })
    .click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("attendance is not verified");
  await cards.first().getByRole("button", { name: "Write feedback" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Visible only to you, school admins, and TTC masters",
  );
  const reflection = "The teacher used clear examples. <b>A useful lesson.</b>";
  await page
    .getByLabel("Your thoughts about the session or teacher")
    .fill(reflection);
  await page
    .getByRole("button", { name: "Save feedback", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    cards.first().getByRole("button", { name: "Edit feedback" }),
  ).toBeVisible();
  await cards.first().getByRole("button", { name: "View details" }).click();
  await expect(page.locator(".observation-feedback-read")).toContainText(
    reflection,
  );
  await expect(page.locator(".observation-feedback-read b")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await cards.first().getByRole("button", { name: "Edit feedback" }).click();
  await page
    .getByLabel("Your thoughts about the session or teacher")
    .fill("Updated: a helpful teaching approach.");
  await page
    .getByRole("button", { name: "Save feedback", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const savedFeedback = await db.bookingFeedback.findFirstOrThrow({
    where: { booking: { userId: user.id } },
  });
  expect(savedFeedback.body).toBe("Updated: a helpful teaching approach.");
  await page.screenshot({
    path: `test-results/observation-hub-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .locator(".segmented")
    .getByRole("button", { name: /^Upcoming/ })
    .click();
  await page
    .locator(".observation-next")
    .getByRole("button", { name: "View on calendar" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  let failHistory = true;
  await page.route(/\/api\/bookings(?:\?|$)/, (route) =>
    failHistory
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary history interruption" }),
        })
      : route.continue(),
  );
  await navigate("My observations");
  await expect(page.locator(".observation-error")).toContainText(
    "Temporary history interruption",
  );
  failHistory = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".observation-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});
