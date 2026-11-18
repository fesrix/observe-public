import { z } from "zod";
import { jalali } from "@/lib/calendar";
const id = z.string().uuid();
export const date = z.string().refine((value) => {
  try {
    jalali(value);
    return true;
  } catch {
    return false;
  }
}, "Enter a valid Jalali date as YYYY-MM-DD.");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid 24-hour time.");
export const slot = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export const commands = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveObservationFeedback"),
    bookingId: id,
    body: z.string().trim().min(1, "Write a comment before saving.").max(4000),
  }),
  z.object({
    action: z.literal("createUser"),
    role: z.enum(["STUDENT", "TTC_MASTER"]).optional(),
    name: z.string().trim().min(2).max(100),
    email: z.union([z.email(), z.literal("")]).optional(),
  }),
  z.object({
    action: z.literal("updateUser"),
    id,
    name: z.string().trim().min(2).max(100),
    email: z.union([z.email(), z.literal("")]).optional(),
    active: z.boolean(),
  }),
  z.object({ action: z.literal("archiveUser"), id }),
  z.object({ action: z.literal("rotateCode"), id }),
  z.object({ action: z.literal("revokeCode"), id }),
  z.object({
    action: z.literal("saveCourse"),
    id: id.optional(),
    title: z.string().trim().min(2).max(120),
    description: z.string().max(2000),
    instructor: z.string().trim().min(1).max(100),
    location: z.string().trim().min(1).max(100),
  }),
  z.object({ action: z.literal("archiveCourse"), id }),
  z.object({
    action: z.literal("schedule"),
    courseId: id,
    ruleId: id.optional(),
    effectiveDate: date.optional(),
    startDate: date,
    endDate: date,
    slots: z.array(slot).min(1).max(21),
    preview: z.boolean(),
    fingerprint: z.string().optional(),
  }),
  z.object({
    action: z.literal("editSession"),
    id,
    date,
    start: time,
    end: time,
    instructor: z.string().min(1).max(100),
    location: z.string().min(1).max(100),
    preview: z.boolean(),
    fingerprint: z.string().optional(),
  }),
  z.object({
    action: z.literal("cancelSession"),
    id,
    preview: z.boolean(),
    fingerprint: z.string().optional(),
  }),
  z.object({
    action: z.literal("book"),
    sessionId: id,
    requestKey: z.string().uuid(),
  }),
  z.object({ action: z.literal("cancelBooking"), id }),
]);
export type Command = z.infer<typeof commands>;
