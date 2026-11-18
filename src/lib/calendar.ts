import {
  CalendarDate,
  PersianCalendar,
  GregorianCalendar,
  toCalendarDate,
  toCalendar,
  toZoned,
  CalendarDateTime,
  fromDate,
} from "@internationalized/date";
export const ZONE = "Asia/Tehran";
export const MONTHS = [
  "Farvardin",
  "Ordibehesht",
  "Khordad",
  "Tir",
  "Mordad",
  "Shahrivar",
  "Mehr",
  "Aban",
  "Azar",
  "Dey",
  "Bahman",
  "Esfand",
];
export const DAYS = [
  "Saturday",
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];
export function jalali(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error("Enter a Jalali date as YYYY-MM-DD.");
  const [y, mo, d] = m.slice(1).map(Number);
  const result = new CalendarDate(new PersianCalendar(), y, mo, d);
  if (
    result.year !== y ||
    result.month !== mo ||
    result.day !== d ||
    y < 1300 ||
    y > 1600
  )
    throw new Error("Invalid Jalali date.");
  return result;
}
export function dateKey(d: CalendarDate) {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
export function today(now = new Date()) {
  return toCalendarDate(toCalendar(fromDate(now, ZONE), new PersianCalendar()));
}
export function instant(date: string, time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid time.");
  const d = toCalendar(jalali(date), new GregorianCalendar());
  const [h, m] = time.split(":").map(Number);
  return toZoned(
    new CalendarDateTime(d.calendar, d.year, d.month, d.day, h, m),
    ZONE,
    "reject",
  ).toDate();
}
export function formatDate(value: string | Date) {
  const d = today(new Date(value));
  return `${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
}
export function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function cancellationDeadline(created: Date, start: Date) {
  return new Date(Math.min(created.getTime() + 30 * 60_000, start.getTime()));
}
export function canCancel(created: Date, start: Date, now = new Date()) {
  return now < cancellationDeadline(created, start);
}
export type Slot = { weekday: number; start: string; end: string };
export function occurrences(start: string, end: string, slots: Slot[]) {
  let date = jalali(start);
  const last = jalali(end);
  if (date.compare(last) > 0 || last.compare(date.add({ years: 2 })) > 0)
    throw new Error("Schedule must span between one day and two years.");
  const result: {
    key: string;
    slotOrdinal: number;
    startAt: Date;
    endAt: Date;
  }[] = [];
  while (date.compare(last) <= 0) {
    const key = dateKey(date);
    const weekday = (instant(key, "12:00").getUTCDay() + 1) % 7;
    // Tehran noon is always on the same Gregorian weekday as UTC noon.
    for (const [slotOrdinal, slot] of slots
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.start.localeCompare(b.start))
      .entries()) {
      const startAt = instant(key, slot.start),
        endAt = instant(key, slot.end);
      if (endAt <= startAt)
        throw new Error("Session end must follow start on the same day.");
      result.push({
        key: `${key}:${slot.weekday}:${slot.start}`,
        slotOrdinal,
        startAt,
        endAt,
      });
    }
    date = date.add({ days: 1 });
  }
  if (!result.length) throw new Error("The schedule contains no sessions.");
  result.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (let i = 1; i < result.length; i++)
    if (result[i].startAt < result[i - 1].endAt)
      throw new Error("Schedule slots overlap.");
  return result;
}
