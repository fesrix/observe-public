CREATE UNIQUE INDEX "Booking_active_student_session" ON "Booking" ("userId", "sessionId") WHERE "cancelledAt" IS NULL;
ALTER TABLE "Course" ADD CONSTRAINT "Course_positive_capacity" CHECK ("capacity" > 0);
ALTER TABLE "ClassSession" ADD CONSTRAINT "Session_positive_capacity" CHECK ("capacity" > 0);
ALTER TABLE "ClassSession" ADD CONSTRAINT "Session_valid_range" CHECK ("endAt" > "startAt");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancellation_order" CHECK ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt");
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
