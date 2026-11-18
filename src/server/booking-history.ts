import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { date } from "./validation";
import { instant, jalali, ZONE } from "@/lib/calendar";
import { toZoned } from "@internationalized/date";

export const bookingHistoryQuery = z
  .object({
    state: z
      .enum(["Upcoming", "Past", "Completed", "Cancelled"])
      .default("Upcoming"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    q: z.string().trim().max(100).default(""),
    student: z.union([z.uuid(), z.literal("")]).optional(),
    start: date.optional(),
    end: date.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.start &&
      value.end &&
      jalali(value.start).compare(jalali(value.end)) > 0
    )
      ctx.addIssue({
        code: "custom",
        message: "The end date must be on or after the start date.",
        path: ["end"],
      });
  });

export async function bookingHistory(userId: string, search: URLSearchParams) {
  const query = bookingHistoryQuery.parse(Object.fromEntries(search));
  const state = query.state === "Completed" ? "Past" : query.state;
  const now = new Date();
  // Keep totals, the next session and the page consistent during concurrent bookings.
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const staff = user.role === "ADMIN" || user.role === "TTC_MASTER";
      const scope: Prisma.BookingWhereInput = staff
        ? query.student
          ? { userId: query.student }
          : {}
        : { userId };
      const states: Record<
        "Upcoming" | "Past" | "Cancelled",
        Prisma.BookingWhereInput
      > = {
        Upcoming: {
          cancelledAt: null,
          session: { cancelled: false, endAt: { gt: now } },
        },
        Past: {
          cancelledAt: null,
          session: { cancelled: false, endAt: { lte: now } },
        },
        Cancelled: {
          OR: [
            { cancelledAt: { not: null } },
            { session: { cancelled: true } },
          ],
        },
      };
      const sessionFilter: Prisma.ClassSessionWhereInput = {
        ...(query.q
          ? {
              OR: [
                {
                  course: { title: { contains: query.q, mode: "insensitive" } },
                },
                { instructor: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(query.start || query.end
          ? {
              startAt: {
                ...(query.start ? { gte: instant(query.start, "00:00") } : {}),
                ...(query.end
                  ? {
                      lt: toZoned(
                        jalali(query.end).add({ days: 1 }),
                        ZONE,
                      ).toDate(),
                    }
                  : {}),
              },
            }
          : {}),
      };
      const where: Prisma.BookingWhereInput = {
        AND: [scope, states[state], { session: sessionFilter }],
      };
      const include = {
        session: { include: { course: { select: { title: true } } } },
        user: { select: { name: true } },
        feedback: { select: { body: true, createdAt: true, updatedAt: true } },
      } as const;
      // A transaction uses one connection; run its queries sequentially.
      const upcoming = await tx.booking.count({
        where: { AND: [scope, states.Upcoming] },
      });
      const past = await tx.booking.count({
        where: { AND: [scope, states.Past] },
      });
      const cancelled = await tx.booking.count({
        where: { AND: [scope, states.Cancelled] },
      });
      const next = await tx.booking.findFirst({
        where: { AND: [scope, states.Upcoming] },
        include,
        orderBy: [{ session: { startAt: "asc" } }, { id: "asc" }],
      });
      const total = await tx.booking.count({ where });
      const feedbackPrompt = staff
        ? null
        : await tx.booking.findFirst({
            where: { AND: [scope, states.Past, { feedback: { is: null } }] },
            include,
            orderBy: [{ session: { startAt: "desc" } }, { id: "asc" }],
          });
      const pages = Math.max(1, Math.ceil(total / 30));
      const page = Math.min(query.page, pages);
      const bookings = await tx.booking.findMany({
        where,
        include,
        orderBy: [
          { session: { startAt: state === "Upcoming" ? "asc" : "desc" } },
          { id: "asc" },
        ],
        skip: (page - 1) * 30,
        take: 30,
      });
      return {
        bookings,
        total,
        page,
        pageSize: 30,
        counts: { Upcoming: upcoming, Past: past, Cancelled: cancelled },
        next,
        feedbackPrompt,
        serverNow: now,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
