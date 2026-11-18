"use client";
import type { Data } from "@/lib/contracts";
import { formatDate, formatTime } from "@/lib/calendar";
export function ReviewChanges({
  details: d,
  data,
}: {
  details: any;
  data: Data;
}) {
  const label = (id: string) =>
    data.bookings.find((b) => b.id === id)?.user.name || "A booked student";
  const when = (value: string) =>
    `${formatDate(value)} at ${formatTime(value)}`;
  return (
    <div className="preview readable-preview">
      {d.message && <p>{d.message}</p>}
      {d.courseSnapshot && <h3>{d.courseSnapshot.title}</h3>}
      {typeof d.created === "number" && (
        <p>
          <strong>{d.created}</strong> new sessions will be published.
        </p>
      )}
      {!!d.protectedSessions?.length && (
        <p>
          {d.protectedSessions.length} past, cancelled, or individually edited
          sessions remain protected.
        </p>
      )}
      {d.changes?.map((c: any) => (
        <div className="review-row" key={c.id}>
          <strong>{when(c.from)}</strong>
          <p>{c.to ? `Moves to ${when(c.to)}` : "Session will be cancelled"}</p>
          <small>
            {c.bookings.length} active bookings
            {c.bookings.length ? `: ${c.bookings.map(label).join(", ")}` : ""}
          </small>
        </div>
      ))}
      {d.before && d.after && (
        <div className="review-row">
          <strong>{when(d.before.startAt)}</strong>
          <p>
            Moves to {when(d.after.startAt)} – {formatTime(d.after.endAt)}
          </p>
          <small>
            {d.after.instructor} · {d.after.location} · one observer seat
          </small>
          <p>{d.bookings.length} bookings keep their places.</p>
        </div>
      )}
      {d.cancelledBookings && (
        <>
          <p>{d.cancelledBookings.length} future bookings will be cancelled.</p>
          {d.cancelledBookings.map((b: any) => {
            const booking = data.bookings.find((x) => x.id === b.id);
            return (
              <div className="review-row" key={b.id}>
                <strong>{label(b.id)}</strong>
                <p>
                  {booking
                    ? `${booking.session.course.title} · ${when(booking.session.startAt)}`
                    : "Future session"}
                </p>
              </div>
            );
          })}
        </>
      )}
      {d.sessionId && !d.before && d.bookings && (
        <>
          <p>
            The session will be cancelled for {d.bookings.length} booked
            students.
          </p>
          {d.bookings.map((b: any) => (
            <div className="review-row" key={b.id}>
              {data.users.find((u) => u.id === b.userId)?.name || label(b.id)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
