import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set TEST_DATABASE_URL to an isolated localhost lingua_test database.",
  );
const target = new URL(url);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/lingua_test"
)
  throw new Error("Refusing to test on a non-isolated database.");
process.env.DATABASE_URL = url;
const { db } = await import("../../src/server/db");
const { execute, bookingHistory, snapshot } = await import(
  "../../src/server/service"
);
const { secret, digest, login } = await import("../../src/server/auth");
const { dateKey, today, formatTime, instant } = await import(
  "../../src/lib/calendar"
);
after(() => db.$disconnect());
async function applyPreview(
  adminId: string,
  command: Parameters<typeof execute>[1],
) {
  const preview = (await execute(adminId, command)) as { fingerprint: string };
  return execute(adminId, {
    ...command,
    preview: false,
    fingerprint: preview.fingerprint,
  } as Parameters<typeof execute>[1]);
}
async function fixture() {
  const admin = await db.user.create({
    data: { name: "Test Admin", role: "ADMIN" },
  });
  const users = await Promise.all(
    [0, 1].map((i) => db.user.create({ data: { name: `Test Student ${i}` } })),
  );
  const course = await db.course.create({
    data: {
      title: "Test course",
      instructor: "Teacher",
      location: "Room A",
      capacity: 1,
    },
  });
  await db.assignment.createMany({
    data: users.map((u) => ({ userId: u.id, courseId: course.id })),
  });
  const startAt = instant(dateKey(today().add({ days: 3 })), "14:00"),
    endAt = new Date(startAt.getTime() + 3600_000);
  const session = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt,
      endAt,
      instructor: "Teacher",
      location: "Room A",
      capacity: 1,
    },
  });
  return { admin, users, course, session };
}
test("Only one concurrent booking can take the last seat; audit commits with it", async () => {
  const { users, session } = await fixture();
  const results = await Promise.allSettled(
    users.map((u) =>
      execute(u.id, {
        action: "book",
        sessionId: session.id,
        requestKey: randomUUID(),
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await db.booking.count({
      where: { sessionId: session.id, cancelledAt: null },
    }),
    1,
  );
  const b = await db.booking.findFirstOrThrow({
    where: { sessionId: session.id },
  });
  assert.equal(
    await db.auditEvent.count({
      where: { subjectId: b.userId, action: "BOOK_SESSION" },
    }),
    1,
  );
});
test("Duplicate retries are idempotent; students can book distinct sessions but not overlaps", async () => {
  const { users, session, course } = await fixture();
  const key = randomUUID();
  const a = await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: key,
  });
  const b = await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: key,
  });
  assert.deepEqual(a, b);
  const other = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt: session.startAt,
      endAt: session.endAt,
      instructor: "Other",
      location: "Room B",
      capacity: 1,
    },
  });
  await assert.rejects(
    execute(users[0].id, {
      action: "book",
      sessionId: other.id,
      requestKey: randomUUID(),
    }),
    /overlaps/,
  );
  const races = await Promise.allSettled(
    [session.id, other.id].map((sessionId) =>
      execute(users[1].id, {
        action: "book",
        sessionId,
        requestKey: randomUUID(),
      }),
    ),
  );
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
  const later = await db.classSession.create({
    data: {
      courseId: course.id,
      // Same clock time on the following day must not count as an overlap.
      startAt: new Date(session.startAt.getTime() + 24 * 3600_000),
      endAt: new Date(session.endAt.getTime() + 24 * 3600_000),
      instructor: "Teacher",
      location: "Room A",
      capacity: 1,
    },
  });
  await execute(users[0].id, {
    action: "book",
    sessionId: later.id,
    requestKey: randomUUID(),
  });
  assert.equal(
    await db.booking.count({
      where: { userId: users[0].id, cancelledAt: null },
    }),
    2,
  );
});
test("Cancel, rebook, enforce deadline, and allow admin override", async () => {
  const { admin, users, session } = await fixture();
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const b = await db.booking.findFirstOrThrow({
    where: { sessionId: session.id },
  });
  await execute(users[0].id, { action: "cancelBooking", id: b.id });
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const b2 = await db.booking.findFirstOrThrow({
    where: { sessionId: session.id, cancelledAt: null },
  });
  assert.notEqual(b.id, b2.id);
  await db.booking.update({
    where: { id: b2.id },
    data: { createdAt: new Date(Date.now() - 31 * 60_000) },
  });
  await assert.rejects(
    execute(users[0].id, { action: "cancelBooking", id: b2.id }),
    /window has closed/,
  );
  await execute(admin.id, { action: "cancelBooking", id: b2.id });
  assert.equal(
    await db.booking.count({
      where: { sessionId: session.id, cancelledAt: null },
    }),
    0,
  );
});
test("Cancellation and last-seat booking race leaves consistent capacity", async () => {
  const { users, session } = await fixture();
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const booking = await db.booking.findFirstOrThrow({
    where: { sessionId: session.id },
  });
  await Promise.allSettled([
    execute(users[0].id, { action: "cancelBooking", id: booking.id }),
    execute(users[1].id, {
      action: "book",
      sessionId: session.id,
      requestKey: randomUUID(),
    }),
  ]);
  assert.ok(
    (await db.booking.count({
      where: { sessionId: session.id, cancelledAt: null },
    })) <= 1,
  );
  assert.ok(
    (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .cancelledAt,
  );
});
test("All active students can view and book classes without assignment; inactive students are rejected", async () => {
  const { admin, users, session, course } = await fixture();
  await db.assignment.delete({
    where: { userId_courseId: { userId: users[0].id, courseId: course.id } },
  });
  const view = await snapshot(users[0].id, new URLSearchParams());
  assert.ok(view.courses.some((item) => item.id === course.id));
  assert.ok(view.sessions.some((item) => item.id === session.id));
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  assert.equal(
    await db.booking.count({
      where: { sessionId: session.id, cancelledAt: null },
    }),
    1,
  );
  await assert.rejects(
    execute(users[1].id, { action: "createUser", name: "Intruder" }),
    /Administrator/,
  );
  await db.user.update({ where: { id: users[1].id }, data: { active: false } });
  await assert.rejects(
    execute(users[1].id, {
      action: "book",
      sessionId: session.id,
      requestKey: randomUUID(),
    }),
    /sign in/,
  );
});
test("Revocation and rotation invalidate old codes and sessions", async () => {
  const { admin, users } = await fixture();
  const code = secret();
  await db.credential.create({
    data: { userId: users[0].id, hash: digest(code) },
  });
  await login({ code }, randomUUID());
  assert.equal(
    await db.authSession.count({ where: { userId: users[0].id } }),
    1,
  );
  await execute(admin.id, { action: "rotateCode", id: users[0].id });
  assert.equal(
    await db.authSession.count({ where: { userId: users[0].id } }),
    0,
  );
  await assert.rejects(login({ code }, randomUUID()), /incorrect/);
  await execute(admin.id, { action: "revokeCode", id: users[0].id });
  assert.equal(
    await db.credential.count({ where: { userId: users[0].id } }),
    0,
  );
});
test("Occurrence edit preserves booking identity; conflicting changes roll back without audit", async () => {
  const { admin, users, session } = await fixture();
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const b = await db.booking.findFirstOrThrow({
    where: { sessionId: session.id },
  });
  const newStart = new Date(session.startAt.getTime() + 3 * 3600_000),
    newEnd = new Date(newStart.getTime() + 3600_000);
  const command = {
    action: "editSession" as const,
    id: session.id,
    date: dateKey(today(newStart)),
    start: formatTime(newStart),
    end: formatTime(newEnd),
    instructor: "Updated teacher",
    location: "Room C",
    preview: true,
  };
  const preview = (await execute(admin.id, command)) as any;
  await execute(admin.id, {
    ...command,
    preview: false,
    fingerprint: preview.fingerprint,
  });
  assert.equal(
    (await db.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionId,
    session.id,
  );
  assert.equal(
    (await db.classSession.findUniqueOrThrow({ where: { id: session.id } }))
      .exception,
    true,
  );
  const before = await db.auditEvent.count({
    where: { action: "EDIT_SESSION" },
  });
  await assert.rejects(
    execute(admin.id, { ...command, preview: false, fingerprint: "stale" }),
    /Preview again/,
  );
  assert.equal(
    await db.auditEvent.count({ where: { action: "EDIT_SESSION" } }),
    before,
  );
});
test("Recurring changes preserve exceptions and booking IDs without duplicating an exception slot", async () => {
  const { admin, users, course } = await fixture();
  const startDate = dateKey(today().add({ days: 10 })),
    endDate = dateKey(today().add({ days: 40 }));
  const command = {
    action: "schedule" as const,
    courseId: course.id,
    startDate,
    endDate,
    slots: [
      { weekday: 1, start: "14:00", end: "16:00" },
      { weekday: 3, start: "19:00", end: "21:00" },
    ],
    preview: true,
  };
  await applyPreview(admin.id, command);
  const rule = await db.scheduleRule.findFirstOrThrow({
    where: { courseId: course.id },
  });
  const sessions = await db.classSession.findMany({
    where: { ruleId: rule.id },
    orderBy: { startAt: "asc" },
  });
  const exception = sessions.find((s) => formatTime(s.startAt) === "14:00")!;
  const retained = sessions.find((s) => s.id !== exception.id)!;
  await execute(users[0].id, {
    action: "book",
    sessionId: retained.id,
    requestKey: randomUUID(),
  });
  const booking = await db.booking.findFirstOrThrow({
    where: { sessionId: retained.id },
  });
  await applyPreview(admin.id, {
    action: "editSession",
    id: exception.id,
    date: dateKey(today(exception.startAt)),
    start: "12:00",
    end: "13:00",
    instructor: "Exception teacher",
    location: "Special room",
    preview: true,
  });
  await applyPreview(admin.id, {
    ...command,
    ruleId: rule.id,
    effectiveDate: startDate,
    slots: [
      { weekday: 1, start: "15:00", end: "17:00" },
      { weekday: 3, start: "18:00", end: "20:00" },
    ],
  });
  await applyPreview(admin.id, {
    ...command,
    ruleId: rule.id,
    effectiveDate: startDate,
    slots: [
      { weekday: 1, start: "16:00", end: "18:00" },
      { weekday: 3, start: "17:00", end: "19:00" },
    ],
  });
  const updated = await db.classSession.findMany({
    where: { ruleId: rule.id, cancelled: false },
  });
  assert.equal(updated.length, sessions.length);
  assert.equal(
    formatTime(updated.find((s) => s.id === exception.id)!.startAt),
    "12:00",
  );
  assert.equal(
    updated.find((s) => s.id === exception.id)!.instructor,
    "Exception teacher",
  );
  assert.equal(
    (await db.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .sessionId,
    retained.id,
  );
});
test("Schedule overlap rejection rolls back session changes, rule version, and audit", async () => {
  const { admin, users, course, session } = await fixture();
  const start = dateKey(today().add({ days: 10 }));
  const weekday =
    (new Date(today().add({ days: 10 }).toString() + "T12:00:00Z").getUTCDay() +
      1) %
    7;
  const cmd = {
    action: "schedule" as const,
    courseId: course.id,
    startDate: start,
    endDate: start,
    slots: [{ weekday, start: "14:00", end: "15:00" }],
    preview: true,
  };
  await applyPreview(admin.id, cmd);
  const rule = await db.scheduleRule.findFirstOrThrow({
    where: { courseId: course.id },
  });
  const generated = await db.classSession.findFirstOrThrow({
    where: { ruleId: rule.id },
  });
  await execute(users[0].id, {
    action: "book",
    sessionId: generated.id,
    requestKey: randomUUID(),
  });
  const later = new Date(generated.startAt.getTime() + 2 * 3600_000);
  await db.classSession.update({
    where: { id: session.id },
    data: { startAt: later, endAt: new Date(later.getTime() + 3600_000) },
  });
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const change = {
    ...cmd,
    ruleId: rule.id,
    effectiveDate: start,
    slots: [{ weekday, start: "16:00", end: "17:00" }],
  };
  const preview = (await execute(admin.id, change)) as any;
  const count = await db.auditEvent.count({
    where: { action: "PUBLISH_SCHEDULE" },
  });
  await assert.rejects(
    execute(admin.id, {
      ...change,
      preview: false,
      fingerprint: preview.fingerprint,
    }),
    /overlap/,
  );
  assert.equal(
    (await db.scheduleRule.findUniqueOrThrow({ where: { id: rule.id } }))
      .version,
    1,
  );
  assert.equal(
    (
      await db.classSession.findUniqueOrThrow({ where: { id: generated.id } })
    ).startAt.toISOString(),
    generated.startAt.toISOString(),
  );
  assert.equal(
    await db.auditEvent.count({ where: { action: "PUBLISH_SCHEDULE" } }),
    count,
  );
});
test("Single observer capacity is immutable and cancelled occurrences retain booking history", async () => {
  const { admin, users, session } = await fixture();
  await assert.rejects(
    db.classSession.update({
      where: { id: session.id },
      data: { capacity: 2 },
    }),
  );
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  await applyPreview(admin.id, {
    action: "cancelSession",
    id: session.id,
    preview: true,
  });
  assert.equal(await db.booking.count({ where: { sessionId: session.id } }), 1);
  assert.equal(
    await db.booking.count({
      where: { sessionId: session.id, cancelledAt: null },
    }),
    0,
  );
});
test("An already-resolved HTTP identity cannot mutate after its session is revoked", async () => {
  const { admin, users, session } = await fixture();
  const code = secret();
  await db.credential.create({
    data: { userId: users[0].id, hash: digest(code) },
  });
  const raw = await login({ code }, randomUUID());
  await execute(admin.id, { action: "revokeCode", id: users[0].id });
  await assert.rejects(
    execute(
      users[0].id,
      { action: "book", sessionId: session.id, requestKey: randomUUID() },
      digest(raw),
    ),
    /session has ended/,
  );
});
test("Database audit records reject update and delete", async () => {
  const event = await db.auditEvent.create({
    data: { action: "APPEND_ONLY_CHECK", details: {} },
  });
  await assert.rejects(
    db.auditEvent.update({
      where: { id: event.id },
      data: { action: "TAMPERED" },
    }),
    /append-only/,
  );
  await assert.rejects(
    db.auditEvent.delete({ where: { id: event.id } }),
    /append-only/,
  );
});
test("Booking history paginates without losing older records or exposing another student", async () => {
  const { users, session } = await fixture();
  await db.booking.createMany({
    data: Array.from({ length: 61 }, (_, i) => ({
      userId: users[0].id,
      sessionId: session.id,
      requestKey: randomUUID(),
      createdAt: new Date(Date.now() - (i + 1) * 86400_000),
      cancelledAt: new Date(),
      cancellationReason: "Historical fixture",
    })),
  });
  await db.booking.create({
    data: {
      userId: users[1].id,
      sessionId: session.id,
      requestKey: randomUUID(),
      createdAt: new Date(Date.now() - 1000),
      cancelledAt: new Date(),
    },
  });
  const first = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Cancelled", page: "1" }),
  );
  const last = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Cancelled", page: "3" }),
  );
  assert.equal(first.total, 61);
  assert.equal(first.bookings.length, 30);
  assert.equal(last.bookings.length, 1);
  assert.ok(
    [...first.bookings, ...last.bookings].every(
      (b) => b.userId === users[0].id,
    ),
  );
});

test("Observation hub filters before pagination, keeps global totals and finds the nearest booking", async () => {
  const { users, course } = await fixture();
  const { instant } = await import("../../src/lib/calendar");
  const firstDate = dateKey(today().add({ days: 8 }));
  const secondDate = dateKey(today().add({ days: 9 }));
  const add = async (
    day: string,
    time: string,
    instructor: string,
    cancelled = false,
  ) => {
    const startAt = instant(day, time);
    const s = await db.classSession.create({
      data: {
        courseId: course.id,
        startAt,
        endAt: new Date(startAt.getTime() + 3600000),
        instructor,
        location: "Hub test",
        capacity: 1,
      },
    });
    return db.booking.create({
      data: {
        userId: users[0].id,
        sessionId: s.id,
        requestKey: randomUUID(),
        ...(cancelled
          ? {
              createdAt: new Date(Date.now() - 1000),
              cancelledAt: new Date(),
              cancellationReason: "Fixture cancellation",
            }
          : {}),
      },
    });
  };
  // Book later sessions first to ensure session chronology wins over booking order.
  const later = await add(secondDate, "15:00", "Evening Tutor");
  const nearest = await add(firstDate, "00:00", "Midnight Tutor");
  await add(firstDate, "23:00", "Night Tutor");
  await add(dateKey(today().subtract({ days: 2 })), "15:00", "Past Tutor");
  for (let i = 0; i < 35; i++)
    await add(
      secondDate,
      "18:00",
      i === 34 ? "Needle Tutor" : "Other Tutor",
      true,
    );
  const unfiltered = await bookingHistory(users[0].id, new URLSearchParams());
  assert.deepEqual(unfiltered.counts, { Upcoming: 3, Past: 1, Cancelled: 35 });
  assert.equal(unfiltered.next?.id, nearest.id);
  assert.equal(unfiltered.bookings[0].id, nearest.id);
  assert.equal(unfiltered.bookings[2].id, later.id);
  const ranged = await bookingHistory(
    users[0].id,
    new URLSearchParams({ start: firstDate, end: firstDate }),
  );
  assert.equal(ranged.total, 2); // Tehran midnight inclusive, next midnight exclusive.
  assert.deepEqual(ranged.counts, unfiltered.counts);
  const searched = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Cancelled", q: "needle tutor", page: "1" }),
  );
  assert.equal(searched.total, 1);
  assert.equal(searched.bookings[0].session.instructor, "Needle Tutor");
  assert.equal(searched.next?.id, nearest.id);
  assert.deepEqual(searched.counts, unfiltered.counts);
  const classMatch = await bookingHistory(
    users[0].id,
    new URLSearchParams({ q: course.title, student: users[0].id }),
  );
  assert.equal(classMatch.total, 3);
  const stranger = await bookingHistory(
    users[1].id,
    new URLSearchParams({ q: course.title, student: users[0].id }),
  );
  assert.equal(stranger.total, 0);
  assert.equal(stranger.next, null);
  assert.deepEqual(stranger.counts, { Upcoming: 0, Past: 0, Cancelled: 0 });
  const legacy = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Completed" }),
  );
  assert.equal(legacy.total, 1);
  const last = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Cancelled", page: "999" }),
  );
  assert.equal(last.page, 2);
  assert.equal(last.bookings.length, 5);
});

test("Observation hub validates Jalali ranges and keeps cancelled classes out of upcoming totals", async () => {
  const { admin, users, session } = await fixture();
  await db.booking.create({
    data: {
      userId: users[0].id,
      sessionId: session.id,
      requestKey: randomUUID(),
    },
  });
  await db.classSession.update({
    where: { id: session.id },
    data: { cancelled: true },
  });
  const result = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Cancelled" }),
  );
  assert.deepEqual(result.counts, { Upcoming: 0, Past: 0, Cancelled: 1 });
  assert.equal(result.next, null);
  assert.equal(result.bookings.length, 1);
  const adminResult = await bookingHistory(
    admin.id,
    new URLSearchParams({ state: "Cancelled", q: "Test course" }),
  );
  assert.ok(adminResult.bookings.length > 0);
  const invalidQueries: Record<string, string>[] = [
    { state: "Unknown" },
    { student: "not-a-uuid" },
    { page: "0" },
    { q: "x".repeat(101) },
    { start: "1405-12-30" },
    { start: "1405-09-05", end: "1405-09-04" },
  ];
  for (const query of invalidQueries)
    await assert.rejects(
      bookingHistory(users[0].id, new URLSearchParams(query)),
    );
});

test("Session feedback is private to its student and admins, editable after the session, and audited atomically", async () => {
  const { admin, users, session, course } = await fixture();
  const booking = await db.booking.create({
    data: {
      userId: users[0].id,
      sessionId: session.id,
      requestKey: randomUUID(),
    },
  });
  const command = {
    action: "saveObservationFeedback" as const,
    bookingId: booking.id,
    body: "The teacher explained the activity clearly.",
  };
  await assert.rejects(execute(users[0].id, command), /after a non-cancelled/);
  assert.equal(
    await db.bookingFeedback.count({ where: { bookingId: booking.id } }),
    0,
  );
  await db.classSession.update({
    where: { id: session.id },
    data: {
      startAt: new Date(Date.now() - 7200000),
      endAt: new Date(Date.now() - 3600000),
    },
  });
  await assert.rejects(execute(users[1].id, command), /not found/);
  await assert.rejects(execute(admin.id, command), /Only students/);
  const before = await db.booking.findUniqueOrThrow({
    where: { id: booking.id },
  });
  await execute(users[0].id, command);
  assert.deepEqual(
    await db.booking.findUniqueOrThrow({ where: { id: booking.id } }),
    before,
  );
  const mine = await bookingHistory(
    users[0].id,
    new URLSearchParams({ state: "Past" }),
  );
  assert.equal(mine.bookings[0].feedback?.body, command.body);
  assert.equal(mine.feedbackPrompt, null);
  const stranger = await bookingHistory(
    users[1].id,
    new URLSearchParams({ state: "Past" }),
  );
  assert.equal(stranger.bookings.length, 0);
  const school = await bookingHistory(
    admin.id,
    new URLSearchParams({ state: "Past", q: course.title }),
  );
  assert.equal(
    school.bookings.find((b) => b.id === booking.id)?.feedback?.body,
    command.body,
  );
  await execute(users[0].id, {
    ...command,
    body: "Updated reflection about classroom management.",
  });
  assert.equal(
    await db.bookingFeedback.count({ where: { bookingId: booking.id } }),
    1,
  );
  assert.equal(
    (
      await db.bookingFeedback.findUniqueOrThrow({
        where: { bookingId: booking.id },
      })
    ).body,
    "Updated reflection about classroom management.",
  );
  const events = await db.auditEvent.findMany({
    where: {
      subjectId: users[0].id,
      action: {
        in: ["WRITE_OBSERVATION_FEEDBACK", "UPDATE_OBSERVATION_FEEDBACK"],
      },
    },
  });
  assert.equal(events.length, 2);
  assert.ok(
    events.every(
      (e) => !JSON.stringify(e.details).includes("teacher explained"),
    ),
  );
  await db.booking.update({
    where: { id: booking.id },
    data: { cancelledAt: new Date() },
  });
  await assert.rejects(execute(users[0].id, command), /after a non-cancelled/);
  assert.equal(
    await db.auditEvent.count({
      where: {
        subjectId: users[0].id,
        action: {
          in: ["WRITE_OBSERVATION_FEEDBACK", "UPDATE_OBSERVATION_FEEDBACK"],
        },
      },
    }),
    2,
  );
  assert.equal(
    await db.bookingFeedback.count({ where: { bookingId: booking.id } }),
    1,
  );
});

test("TTC Master reads school activity and feedback but every domain command is denied", async () => {
  const { admin, users, session, course } = await fixture();
  const created = (await execute(admin.id, {
    action: "createUser",
    role: "TTC_MASTER",
    name: "Read-only TTC Master",
  })) as { code: string; userId: string };
  const master = await db.user.findUniqueOrThrow({
    where: { id: created.userId },
  });
  assert.equal(master.role, "TTC_MASTER");
  const raw = await login({ code: created.code }, randomUUID());
  assert.ok(await db.authSession.findUnique({ where: { id: digest(raw) } }));
  await execute(users[0].id, {
    action: "book",
    sessionId: session.id,
    requestKey: randomUUID(),
  });
  const past = await db.classSession.create({
    data: {
      courseId: course.id,
      startAt: new Date(Date.now() - 7200000),
      endAt: new Date(Date.now() - 3600000),
      instructor: "Master review teacher",
      location: "Room M",
      capacity: 1,
    },
  });
  const oldBooking = await db.booking.create({
    data: { userId: users[0].id, sessionId: past.id, requestKey: randomUUID() },
  });
  await execute(users[0].id, {
    action: "saveObservationFeedback",
    bookingId: oldBooking.id,
    body: "A useful reflection for the TTC Master.",
  });
  const school = await snapshot(master.id, new URLSearchParams());
  assert.ok(school.users.some((u) => u.id === users[0].id));
  assert.ok(school.courses.some((c) => c.id === course.id));
  const reserved = school.sessions.find((s) => s.id === session.id)!;
  assert.equal(reserved.bookedCount, 1);
  assert.equal(reserved.bookings[0].userId, users[0].id);
  assert.ok(
    school.events.some(
      (e) =>
        e.action === "WRITE_OBSERVATION_FEEDBACK" &&
        e.subjectId === users[0].id,
    ),
  );
  const records = await bookingHistory(
    master.id,
    new URLSearchParams({ state: "Past", student: users[0].id }),
  );
  assert.equal(
    records.bookings.find((b) => b.id === oldBooking.id)?.feedback?.body,
    "A useful reflection for the TTC Master.",
  );
  const unrelated = await bookingHistory(
    master.id,
    new URLSearchParams({ student: users[1].id }),
  );
  assert.equal(unrelated.total, 0);
  const counts = async () => ({
    users: await db.user.count(),
    bookings: await db.booking.count(),
    sessions: await db.classSession.count(),
    events: await db.auditEvent.count(),
    feedback: await db.bookingFeedback.count(),
    credentials: await db.credential.count(),
  });
  const before = await counts();
  const { commands } = await import("../../src/server/validation");
  for (const variant of commands.options) {
    const action = variant.shape.action.value;
    await assert.rejects(
      execute(master.id, { action } as Parameters<typeof execute>[1]),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 403,
      `Master must not execute ${action}`,
    );
  }
  assert.deepEqual(await counts(), before);
  await execute(admin.id, { action: "revokeCode", id: master.id });
  assert.equal(
    await db.authSession.findUnique({ where: { id: digest(raw) } }),
    null,
  );
  await assert.rejects(login({ code: created.code }, randomUUID()));
});
