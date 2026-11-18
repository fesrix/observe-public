-- Add feedback without modifying any existing booking or school record.
CREATE TABLE "BookingFeedback" (
    "bookingId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "BookingFeedback_pkey" PRIMARY KEY ("bookingId"),
    CONSTRAINT "BookingFeedback_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 4000),
    CONSTRAINT "BookingFeedback_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
