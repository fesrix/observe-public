import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jalali,
  dateKey,
  today,
  instant,
  occurrences,
  canCancel,
  cancellationDeadline,
} from "../src/lib/calendar";
test("Jalali validation rejects overflow and respects leap years", () => {
  assert.equal(dateKey(jalali("1399-12-30")), "1399-12-30");
  assert.throws(() => jalali("1400-12-30"));
  assert.throws(() => jalali("1404-07-31"));
  assert.throws(() => jalali("2026-11-15"));
  assert.throws(() => jalali("1404-1-01"));
  assert.equal(dateKey(jalali("1399-12-30").add({ days: 1 })), "1400-01-01");
});
test("Tehran midnight and date round trip ignore process timezone", () => {
  const date = instant("1404-01-01", "00:00");
  assert.equal(date.toISOString(), "2025-03-20T20:30:00.000Z");
  assert.equal(dateKey(today(date)), "1404-01-01");
  assert.equal(dateKey(today(new Date(date.getTime() - 1))), "1403-12-30");
});
test("Cancellation is strictly before both boundaries", () => {
  const created = new Date("2026-11-15T10:00:00Z"),
    start = new Date("2026-11-15T12:00:00Z");
  assert.equal(
    canCancel(created, start, new Date("2026-11-15T10:29:59.999Z")),
    true,
  );
  assert.equal(
    canCancel(created, start, new Date("2026-11-15T10:30:00Z")),
    false,
  );
  assert.equal(
    cancellationDeadline(
      created,
      new Date("2026-11-15T10:10:00Z"),
    ).toISOString(),
    "2026-11-15T10:10:00.000Z",
  );
});
test("Irregular slots generate correct weekdays and Tehran wall-clock times", () => {
  const rows = occurrences("1404-01-02", "1404-01-08", [
    { weekday: 1, start: "14:00", end: "16:00" },
    { weekday: 3, start: "19:00", end: "21:00" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].startAt.getUTCDay(), 0);
  assert.equal(rows[1].startAt.getUTCDay(), 2);
  assert.equal(rows[0].startAt.toISOString(), "2025-03-23T10:30:00.000Z");
  assert.equal(rows[1].startAt.toISOString(), "2025-03-25T15:30:00.000Z");
});
test("Recurrence rejects overlapping slots, reversed times, and excessive ranges", () => {
  assert.throws(() =>
    occurrences("1404-01-02", "1404-01-08", [
      { weekday: 1, start: "16:00", end: "14:00" },
    ]),
  );
  assert.throws(() =>
    occurrences("1404-01-02", "1404-01-08", [
      { weekday: 1, start: "14:00", end: "16:00" },
      { weekday: 1, start: "15:00", end: "17:00" },
    ]),
  );
  assert.throws(() =>
    occurrences("1404-01-01", "1407-01-01", [
      { weekday: 1, start: "14:00", end: "16:00" },
    ]),
  );
});
