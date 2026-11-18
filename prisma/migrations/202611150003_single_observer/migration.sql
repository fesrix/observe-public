-- Historical multi-seat reservations are retained, but only the earliest active
-- booking per session keeps the observer seat. Each automatically cancelled
-- reservation receives an append-only audit event.
WITH ranked AS (
  SELECT
    booking."id",
    booking."userId",
    booking."sessionId",
    ROW_NUMBER() OVER (
      PARTITION BY booking."sessionId"
      ORDER BY booking."createdAt" ASC, booking."id" ASC
    ) AS position
  FROM "Booking" AS booking
  JOIN "ClassSession" AS session ON session."id" = booking."sessionId"
  WHERE booking."cancelledAt" IS NULL
    AND session."startAt" > now()
), cancelled AS (
  UPDATE "Booking" AS booking
  SET
    "cancelledAt" = GREATEST(now(), booking."createdAt"),
    "cancellationReason" = 'Observer seat limit changed to one'
  FROM ranked
  WHERE booking."id" = ranked."id"
    AND ranked.position > 1
  RETURNING booking."id", booking."userId", booking."sessionId"
)
INSERT INTO "AuditEvent" ("id", "actorId", "subjectId", "action", "outcome", "details", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  "userId",
  'MIGRATE_SINGLE_OBSERVER_SEAT',
  'SUCCESS',
  jsonb_build_object('bookingId', "id", 'sessionId', "sessionId"),
  now()
FROM cancelled;

UPDATE "Course" SET "capacity" = 1 WHERE "capacity" <> 1;
UPDATE "ClassSession" SET "capacity" = 1 WHERE "capacity" <> 1;
ALTER TABLE "Course" ALTER COLUMN "capacity" SET DEFAULT 1;

ALTER TABLE "Course" DROP CONSTRAINT "Course_positive_capacity";
ALTER TABLE "ClassSession" DROP CONSTRAINT "Session_positive_capacity";
ALTER TABLE "Course" ADD CONSTRAINT "Course_single_observer_seat" CHECK ("capacity" = 1);
ALTER TABLE "ClassSession" ADD CONSTRAINT "Session_single_observer_seat" CHECK ("capacity" = 1);
