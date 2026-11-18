import { Prisma } from "@prisma/client";
import { db, transaction, mutationLock, audit, AppError, type Tx } from "./db";
import { authorize, digest, secret } from "./auth";
import { canCancel, instant, occurrences, type Slot } from "@/lib/calendar";
import type { Command } from "./validation";
function fail(message: string): never {
  throw new AppError(409, message);
}
async function conflicts(
  tx: Tx,
  userId: string,
  startAt: Date,
  endAt: Date,
  exclude?: string,
) {
  const active = await tx.booking.findMany({
    where: {
      userId,
      cancelledAt: null,
      sessionId: exclude ? { not: exclude } : undefined,
      session: { cancelled: false },
    },
    select: { session: { select: { startAt: true, endAt: true } } },
  });
  const targetStart = startAt.getTime();
  const targetEnd = endAt.getTime();
  return active.some(
    ({ session }) =>
      session.startAt.getTime() < targetEnd &&
      session.endAt.getTime() > targetStart,
  );
}
function confirmPreview(
  input: { preview: boolean; fingerprint?: string },
  details: unknown,
) {
  const fingerprint = digest(JSON.stringify(details));
  if (input.preview) return { preview: true, fingerprint, details };
  if (input.fingerprint !== fingerprint)
    fail("The affected records changed. Preview again before saving.");
  return null;
}
async function student(tx: Tx, id: string) {
  const u = await tx.user.findUnique({ where: { id } });
  if (!u || !["STUDENT", "TTC_MASTER"].includes(u.role) || u.archivedAt)
    throw new AppError(404, "Account not found.");
  return u;
}
export async function execute(
  userId: string,
  input: Command,
  sessionHash?: string,
) {
  return transaction(async (tx) => {
    await mutationLock(tx);
    if (sessionHash) {
      const session = await tx.authSession.findUnique({
        where: { id: sessionHash },
      });
      if (
        !session ||
        session.userId !== userId ||
        session.expiresAt <= new Date()
      )
        throw new AppError(
          401,
          "Your session has ended. Please sign in again.",
        );
    }
    const user = await authorize(
      tx,
      userId,
      !["book", "cancelBooking", "saveObservationFeedback"].includes(
        input.action,
      ),
    );
    const now = new Date();
    if (user.role === "TTC_MASTER")
      throw new AppError(403, "TTC Master access is read-only.");
    switch (input.action) {
      case "saveObservationFeedback": {
        if (user.role !== "STUDENT")
          throw new AppError(
            403,
            "Only students can write their observation feedback.",
          );
        const booking = await tx.booking.findUnique({
          where: { id: input.bookingId },
          include: { session: true, feedback: true },
        });
        if (!booking || booking.userId !== userId)
          throw new AppError(404, "Observation not found.");
        if (
          booking.cancelledAt ||
          booking.session.cancelled ||
          booking.session.endAt > now
        )
          fail(
            "Feedback is available after a non-cancelled observation session ends.",
          );
        const feedback = await tx.bookingFeedback.upsert({
          where: { bookingId: booking.id },
          create: { bookingId: booking.id, body: input.body },
          update: { body: input.body },
        });
        await audit(
          tx,
          userId,
          booking.feedback
            ? "UPDATE_OBSERVATION_FEEDBACK"
            : "WRITE_OBSERVATION_FEEDBACK",
          userId,
          {
            bookingId: booking.id,
            characters: input.body.length,
          },
        );
        return { feedback };
      }
      case "book": {
        if (user.role !== "STUDENT")
          throw new AppError(403, "Use a student account to book.");
        const prior = await tx.booking.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (prior) {
          if (prior.userId !== userId || prior.sessionId !== input.sessionId)
            fail("Request key already used.");
          return { booking: prior };
        }
        const s = await tx.classSession.findUnique({
          where: { id: input.sessionId },
          include: { course: true },
        });
        if (!s || s.cancelled || s.course.archived || s.startAt <= now)
          fail("This session is unavailable.");
        const existing = await tx.booking.findFirst({
          where: { userId, sessionId: s.id, cancelledAt: null },
        });
        if (existing) return { booking: existing };
        if (
          (await tx.booking.count({
            where: { sessionId: s.id, cancelledAt: null },
          })) >= 1
        )
          fail("This session is full.");
        if (await conflicts(tx, userId, s.startAt, s.endAt))
          fail("This session overlaps one of your bookings.");
        const booking = await tx.booking.create({
          data: {
            userId,
            sessionId: s.id,
            requestKey: input.requestKey,
            createdAt: now,
          },
        });
        await audit(tx, userId, "BOOK_SESSION", userId, {
          bookingId: booking.id,
          sessionId: s.id,
        });
        return { booking };
      }
      case "cancelBooking": {
        const b = await tx.booking.findUnique({
          where: { id: input.id },
          include: { session: true },
        });
        if (!b || (user.role !== "ADMIN" && b.userId !== userId))
          throw new AppError(404, "Booking not found.");
        if (b.cancelledAt) return { ok: true };
        if (
          user.role !== "ADMIN" &&
          !canCancel(b.createdAt, b.session.startAt, now)
        )
          fail("Your cancellation window has closed. Contact the school.");
        await tx.booking.update({
          where: { id: b.id },
          data: {
            cancelledAt: now,
            cancellationReason:
              user.role === "ADMIN"
                ? "Administrator cancellation"
                : "Student cancellation",
          },
        });
        await audit(tx, userId, "CANCEL_BOOKING", b.userId, {
          bookingId: b.id,
          sessionId: b.sessionId,
        });
        return { ok: true };
      }
      case "createUser": {
        const u = await tx.user.create({
          data: {
            name: input.name,
            email: input.email?.toLowerCase() || null,
            role: input.role,
          },
        });
        const code = secret();
        await tx.credential.create({
          data: { userId: u.id, hash: digest(code) },
        });
        await audit(tx, userId, "CREATE_USER", u.id, {
          name: u.name,
          email: u.email,
          role: u.role,
        });
        return { code, userId: u.id };
      }
      case "updateUser": {
        const before = await student(tx, input.id);
        await tx.user.update({
          where: { id: input.id },
          data: {
            name: input.name,
            email: input.email?.toLowerCase() || null,
            active: input.active,
          },
        });
        if (!input.active)
          await tx.authSession.deleteMany({ where: { userId: input.id } });
        await audit(tx, userId, "UPDATE_USER", input.id, {
          before: {
            name: before.name,
            email: before.email,
            active: before.active,
          },
          after: {
            name: input.name,
            email: input.email || null,
            active: input.active,
          },
        });
        return { ok: true };
      }
      case "archiveUser": {
        await student(tx, input.id);
        await tx.user.update({
          where: { id: input.id },
          data: { active: false, archivedAt: now },
        });
        await tx.credential.deleteMany({ where: { userId: input.id } });
        await tx.authSession.deleteMany({ where: { userId: input.id } });
        const affected = await tx.booking.findMany({
          where: {
            userId: input.id,
            cancelledAt: null,
            session: { startAt: { gt: now } },
          },
          select: { id: true, sessionId: true },
        });
        await tx.booking.updateMany({
          where: { id: { in: affected.map((b) => b.id) } },
          data: { cancelledAt: now, cancellationReason: "Account archived" },
        });
        await audit(tx, userId, "ARCHIVE_USER", input.id, {
          cancelledBookings: affected,
        });
        return { ok: true };
      }
      case "rotateCode":
      case "revokeCode": {
        await student(tx, input.id);
        await tx.authSession.deleteMany({ where: { userId: input.id } });
        const code = input.action === "rotateCode" ? secret() : null;
        if (code)
          await tx.credential.upsert({
            where: { userId: input.id },
            create: { userId: input.id, hash: digest(code) },
            update: { hash: digest(code), createdAt: now },
          });
        else await tx.credential.deleteMany({ where: { userId: input.id } });
        await audit(
          tx,
          userId,
          input.action === "rotateCode" ? "ROTATE_CODE" : "REVOKE_CODE",
          input.id,
        );
        return { code };
      }
      case "saveCourse": {
        const { action, id, ...data } = input;
        const before = id
          ? await tx.course.findUnique({ where: { id } })
          : null;
        const courseData = { ...data, capacity: 1 };
        const c = id
          ? await tx.course.update({ where: { id }, data: courseData })
          : await tx.course.create({ data: courseData });
        await audit(tx, userId, "SAVE_COURSE", null, {
          courseId: c.id,
          before: before
            ? {
                title: before.title,
                description: before.description,
                instructor: before.instructor,
                location: before.location,
                capacity: before.capacity,
              }
            : null,
          after: courseData,
        });
        return { course: c };
      }
      case "archiveCourse": {
        const count = await tx.classSession.count({
          where: { courseId: input.id, cancelled: false, startAt: { gt: now } },
        });
        if (count) fail("Cancel future sessions before archiving this course.");
        await tx.course.update({
          where: { id: input.id },
          data: { archived: true },
        });
        await audit(tx, userId, "ARCHIVE_COURSE", null, { courseId: input.id });
        return { ok: true };
      }
      case "cancelSession": {
        const s = await tx.classSession.findUnique({
          where: { id: input.id },
          include: {
            bookings: {
              where: { cancelledAt: null },
              select: { id: true, userId: true },
              orderBy: { id: "asc" },
            },
          },
        });
        if (!s) throw new AppError(404, "Session not found.");
        const details = {
          sessionId: s.id,
          version: s.version,
          bookings: s.bookings,
        };
        const preview = confirmPreview(input, details);
        if (preview) return preview;
        await tx.classSession.update({
          where: { id: s.id },
          data: { cancelled: true, exception: true, version: { increment: 1 } },
        });
        await tx.booking.updateMany({
          where: { sessionId: s.id, cancelledAt: null },
          data: {
            cancelledAt: now,
            cancellationReason: "Session cancelled by school",
          },
        });
        await audit(tx, userId, "CANCEL_SESSION", null, details);
        return { ok: true };
      }
      case "editSession": {
        const s = await tx.classSession.findUnique({
          where: { id: input.id },
          include: {
            bookings: { where: { cancelledAt: null }, orderBy: { id: "asc" } },
          },
        });
        if (!s || s.cancelled || s.startAt <= now)
          fail("Only upcoming active sessions can be edited.");
        const startAt = instant(input.date, input.start),
          endAt = instant(input.date, input.end);
        if (startAt <= now || endAt <= startAt)
          fail("Choose a future session with a valid time range.");
        if (s.bookings.length > 1)
          fail(
            "This session has multiple active reservations and needs review.",
          );
        for (const b of s.bookings)
          if (await conflicts(tx, b.userId, startAt, endAt, s.id))
            fail("The new time overlaps an affected student’s booking.");
        const details = {
          sessionId: s.id,
          version: s.version,
          bookings: s.bookings.map((b) => b.id),
          before: {
            startAt: s.startAt.toISOString(),
            endAt: s.endAt.toISOString(),
            capacity: s.capacity,
            instructor: s.instructor,
            location: s.location,
          },
          after: {
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            capacity: 1,
            instructor: input.instructor,
            location: input.location,
          },
        };
        const preview = confirmPreview(input, details);
        if (preview) return preview;
        await tx.classSession.update({
          where: { id: s.id },
          data: {
            startAt,
            endAt,
            capacity: 1,
            instructor: input.instructor,
            location: input.location,
            exception: true,
            version: { increment: 1 },
          },
        });
        await audit(tx, userId, "EDIT_SESSION", null, details);
        return { ok: true };
      }
      case "schedule": {
        const course = await tx.course.findUnique({
          where: { id: input.courseId },
        });
        if (!course || course.archived) fail("Course is unavailable.");
        const rule = input.ruleId
          ? await tx.scheduleRule.findUnique({ where: { id: input.ruleId } })
          : null;
        if (input.ruleId && (!rule || rule.courseId !== course.id))
          fail("Schedule not found.");
        if (rule && !input.effectiveDate) fail("Choose an effective date.");
        const effective = instant(
          input.effectiveDate || input.startDate,
          "00:00",
        );
        let allGenerated: ReturnType<typeof occurrences>;
        try {
          allGenerated = occurrences(
            input.startDate,
            input.endDate,
            input.slots,
          ).filter((o) => o.startAt >= effective && o.startAt > now);
        } catch (error) {
          throw new AppError(400, (error as Error).message);
        }
        if (!allGenerated.length)
          fail("Choose a schedule containing future sessions.");
        const previous = rule
          ? await tx.classSession.findMany({
              where: {
                ruleId: rule.id,
                startAt: { gte: effective, gt: now },
                exception: false,
                cancelled: false,
              },
              include: {
                bookings: {
                  where: { cancelledAt: null },
                  orderBy: { id: "asc" },
                },
              },
              orderBy: { startAt: "asc" },
            })
          : [];
        const protectedSessions = rule
          ? await tx.classSession.findMany({
              where: {
                ruleId: rule.id,
                id: { notIn: previous.map((s) => s.id) },
              },
              select: {
                id: true,
                version: true,
                occurrenceKey: true,
                slotOrdinal: true,
              },
              orderBy: { id: "asc" },
            })
          : [];
        const keyUpdates: { id: string; key: string; slotOrdinal: number }[] =
          [];
        // An exception also owns the corresponding slot on its original date when
        // that slot's time is changed. Rank same-day slots to support multiple slots.
        for (const session of protectedSessions) {
          if (!session.occurrenceKey || !rule) continue;
          const parts = session.occurrenceKey.split(":");
          const day = parts[0],
            weekday = Number(parts[1]),
            oldTime = `${parts[2]}:${parts[3]}`;
          const oldSlots = (rule.slots as Slot[])
            .filter((s) => s.weekday === weekday)
            .sort((a, b) => a.start.localeCompare(b.start));
          const index =
            session.slotOrdinal ??
            oldSlots.findIndex((s) => s.start === oldTime);
          const replacement = input.slots
            .filter((s) => s.weekday === weekday)
            .sort((a, b) => a.start.localeCompare(b.start))[index];
          if (
            replacement &&
            instant(day, "23:59") >= effective &&
            instant(day, "23:59") > now
          )
            keyUpdates.push({
              id: session.id,
              key: `${day}:${weekday}:${replacement.start}`,
              slotOrdinal: index,
            });
        }
        const protectedKeys = new Set(
          protectedSessions
            .map(
              (s) =>
                keyUpdates.find((k) => k.id === s.id)?.key || s.occurrenceKey,
            )
            .filter(Boolean),
        );
        if (
          protectedKeys.size !==
          protectedSessions.filter((s) => s.occurrenceKey).length
        )
          fail(
            "This rule change would merge individual exceptions. Adjust the slots or edit sessions individually.",
          );
        const generated = allGenerated.filter((o) => !protectedKeys.has(o.key));
        // Pair occurrences in chronological order so retained sessions keep their booking identities.
        const changes = previous.map((s, i) => ({
          id: s.id,
          version: s.version,
          bookings: s.bookings.map((b) => b.id),
          from: s.startAt.toISOString(),
          to: generated[i]?.startAt.toISOString() || null,
        }));
        const details = {
          courseId: course.id,
          courseSnapshot: {
            title: course.title,
            instructor: course.instructor,
            location: course.location,
            capacity: 1,
          },
          ruleVersion: rule?.version || 0,
          startDate: input.startDate,
          endDate: input.endDate,
          effectiveDate: input.effectiveDate || input.startDate,
          slots: input.slots,
          protectedSessions,
          changes,
          created: Math.max(0, generated.length - previous.length),
        };
        const preview = confirmPreview(input, details);
        if (preview) return preview;
        const r = rule
          ? await tx.scheduleRule.update({
              where: { id: rule.id },
              data: {
                startDate: input.startDate,
                endDate: input.endDate,
                slots: input.slots,
                version: { increment: 1 },
              },
            })
          : await tx.scheduleRule.create({
              data: {
                courseId: course.id,
                startDate: input.startDate,
                endDate: input.endDate,
                slots: input.slots,
              },
            });
        // Clear old keys before assigning new keys (overlapping date ranges can swap them).
        await tx.classSession.updateMany({
          where: {
            id: {
              in: [
                ...previous.map((s) => s.id),
                ...keyUpdates.map((k) => k.id),
              ],
            },
          },
          data: { occurrenceKey: null },
        });
        for (const update of keyUpdates)
          await tx.classSession.update({
            where: { id: update.id },
            data: {
              occurrenceKey: update.key,
              slotOrdinal: update.slotOrdinal,
              version: { increment: 1 },
            },
          });
        for (let i = 0; i < Math.max(previous.length, generated.length); i++) {
          const s = previous[i],
            o = generated[i];
          if (s && !o) {
            await tx.classSession.update({
              where: { id: s.id },
              data: { cancelled: true, version: { increment: 1 } },
            });
            await tx.booking.updateMany({
              where: { sessionId: s.id, cancelledAt: null },
              data: {
                cancelledAt: now,
                cancellationReason: "Recurring schedule changed",
              },
            });
          } else if (o) {
            if (s) {
              if (s.bookings.length > 1)
                fail(
                  "A session has multiple active reservations and needs review.",
                );
              await tx.classSession.update({
                where: { id: s.id },
                data: {
                  startAt: o.startAt,
                  endAt: o.endAt,
                  occurrenceKey: o.key,
                  slotOrdinal: o.slotOrdinal,
                  instructor: course.instructor,
                  location: course.location,
                  capacity: 1,
                  version: { increment: 1 },
                },
              });
            } else
              await tx.classSession.create({
                data: {
                  courseId: course.id,
                  ruleId: r.id,
                  occurrenceKey: o.key,
                  slotOrdinal: o.slotOrdinal,
                  startAt: o.startAt,
                  endAt: o.endAt,
                  instructor: course.instructor,
                  location: course.location,
                  capacity: 1,
                },
              });
          }
        }
        // Check the final schedule, avoiding false conflicts between sessions being moved together.
        for (const s of previous)
          for (const b of s.bookings) {
            const current = await tx.classSession.findUniqueOrThrow({
              where: { id: s.id },
            });
            if (
              !current.cancelled &&
              (await conflicts(
                tx,
                b.userId,
                current.startAt,
                current.endAt,
                s.id,
              ))
            )
              fail("Schedule changes overlap an affected student’s booking.");
          }
        await audit(tx, userId, "PUBLISH_SCHEDULE", null, details);
        return { ok: true };
      }
    }
  });
}
export async function snapshot(userId: string, search: URLSearchParams) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const admin = user.role === "ADMIN" || user.role === "TTC_MASTER";
  const courseWhere: Prisma.CourseWhereInput = admin ? {} : { archived: false };
  const courses = await db.course.findMany({
    where: courseWhere,
    include: { rules: true },
    orderBy: { createdAt: "desc" },
  });
  const start = search.get("start"),
    end = search.get("end");
  const range =
    start && end
      ? { gte: instant(start, "00:00"), lt: instant(end, "00:00") }
      : {
          gte: new Date(Date.now() - 31 * 86400_000),
          lte: new Date(Date.now() + 93 * 86400_000),
        };
  const sessions = await db.classSession.findMany({
    where: { courseId: { in: courses.map((c) => c.id) }, startAt: range },
    include: {
      course: { select: { title: true } },
      bookings: {
        where: { cancelledAt: null },
        select: { id: true, userId: true },
      },
    },
    orderBy: { startAt: "asc" },
  });
  const bookings = await db.booking.findMany({
    where: {
      ...(admin ? { userId: search.get("student") || undefined } : { userId }),
      cancelledAt: null,
      session: { cancelled: false, endAt: { gt: new Date() } },
    },
    include: {
      session: {
        include: {
          course: { select: { title: true } },
          bookings: {
            where: { cancelledAt: null },
            select: { id: true, userId: true },
          },
        },
      },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const users = admin
    ? await db.user.findMany({
        where: { role: { in: ["STUDENT", "TTC_MASTER"] } },
        select: {
          id: true,
          name: true,
          role: true,
          email: true,
          active: true,
          archivedAt: true,
          credential: { select: { createdAt: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const page = Math.floor(
    Math.max(1, Math.min(10000, Number(search.get("page")) || 1)),
  );
  const subject = search.get("student");
  const q = (search.get("q") || "").slice(0, 100);
  const where: Prisma.AuditEventWhereInput = {
    ...(subject ? { OR: [{ subjectId: subject }, { actorId: subject }] } : {}),
    ...(q ? { action: { contains: q, mode: "insensitive" } } : {}),
  };
  const events = admin
    ? await db.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 30,
        take: 30,
      })
    : [];
  const auditCount = admin ? await db.auditEvent.count({ where }) : 0;
  return {
    user: { id: user.id, name: user.name, role: user.role },
    schoolName: process.env.SCHOOL_NAME || "Observe",
    courses,
    sessions: sessions.map((s) => ({
      ...s,
      bookings: admin
        ? s.bookings
        : s.bookings.filter((b) => b.userId === userId),
      bookedCount: s.bookings.length,
    })),
    bookings: bookings.map((b) => ({
      ...b,
      session: {
        ...b.session,
        bookedCount: b.session.bookings.length,
        bookings: admin
          ? b.session.bookings
          : b.session.bookings.filter((booking) => booking.userId === userId),
      },
    })),
    users,
    events,
    auditCount,
    page,
  };
}
export { bookingHistory } from "./booking-history";
