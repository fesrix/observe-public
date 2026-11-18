"use client";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import {
  ArrowUpRight,
  CalendarDays,
  Clock3,
  MapPin,
  Search,
  Users,
  X,
} from "lucide-react";
import { json } from "@/lib/api";
import type {
  Booking as WorkspaceBooking,
  HistoryBooking as Booking,
  BookingHistoryData,
  HistoryState,
  Student,
} from "@/lib/contracts";
import {
  dateKey,
  today,
  MONTHS,
  formatDate,
  formatTime,
  cancellationDeadline,
  canCancel,
  jalali,
} from "@/lib/calendar";
import { JalaliPicker } from "./jalali-picker";
import { Empty } from "./primitives";

const states: HistoryState[] = ["Upcoming", "Past", "Cancelled"];
function status(b: Booking, now: number) {
  if (b.cancelledAt || b.session.cancelled) return "Cancelled";
  if (new Date(b.session.endAt).getTime() <= now) return "Past";
  return new Date(b.session.startAt).getTime() <= now
    ? "In progress"
    : "Upcoming";
}
function startsIn(b: Booking, now: number) {
  const minutes = Math.ceil(
    (new Date(b.session.startAt).getTime() - now) / 60000,
  );
  if (minutes <= 0) return "In progress now";
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Starts in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `Starts in ${days} ${days === 1 ? "day" : "days"}${hours % 24 ? ` ${hours % 24}h` : ""}`;
}
function duration(b: Booking) {
  return `${Math.round((new Date(b.session.endAt).getTime() - new Date(b.session.startAt).getTime()) / 60000)} min`;
}
function CancellationState({
  booking: b,
  now,
  admin,
  readOnly = false,
}: {
  booking: Booking;
  now: number;
  admin: boolean;
  readOnly?: boolean;
}) {
  if (status(b, now) === "Cancelled")
    return (
      <span>
        {b.cancellationReason ||
          (b.session.cancelled
            ? "Class cancelled by the school"
            : "Observation cancelled")}
      </span>
    );
  if (status(b, now) === "Past")
    return <span>Session ended · attendance is not verified here</span>;
  if (readOnly) return <span>Read-only reservation record</span>;
  if (admin) return <span>Administrator cancellation available</span>;
  const deadline = cancellationDeadline(
    new Date(b.createdAt),
    new Date(b.session.startAt),
  ).getTime();
  const remaining = Math.ceil((deadline - now) / 1000);
  return remaining > 0 ? (
    <span className="observation-window">
      Cancellation open · {Math.floor(remaining / 60)}m{" "}
      {String(remaining % 60).padStart(2, "0")}s remaining
    </span>
  ) : (
    <span>Cancellation closed — contact the school.</span>
  );
}
export function BookingHistory({
  bookings,
  admin,
  readOnly = false,
  students = [],
  studentId = "",
  onStudentChange,
  busy,
  onCancel,
  onExplore,
  onViewCalendar,
}: {
  bookings: WorkspaceBooking[];
  admin: boolean;
  readOnly?: boolean;
  students?: Student[];
  studentId?: string;
  onStudentChange?: (id: string) => void;
  busy: boolean;
  onCancel: (id: string) => Promise<boolean>;
  onExplore: () => void;
  onViewCalendar: (date: string) => void;
}) {
  const [filter, setFilter] = useState<HistoryState>("Upcoming");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BookingHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState({ q: "", start: "", end: "" });
  const [applied, setApplied] = useState(draft);
  const [filterError, setFilterError] = useState("");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [confirm, setConfirm] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [success, setSuccess] = useState("");
  const [feedbackBooking, setFeedbackBooking] = useState<Booking | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [now, setNow] = useState(Date.now);
  const offset = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ state: filter, page: String(page) });
    if (admin && studentId) query.set("student", studentId);
    for (const [key, value] of Object.entries(applied))
      if (value) query.set(key, value);
    json("/api/bookings?" + query)
      .then((result: BookingHistoryData) => {
        if (!current) return;
        offset.current = Date.parse(result.serverNow) - Date.now();
        setNow(Date.parse(result.serverNow));
        setData(result);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filter, page, applied, retry, bookings, admin, studentId]);
  const filtered = !!(applied.q || applied.start || applied.end);
  const changeState = (value: HistoryState) => {
    setFilter(value);
    setPage(1);
  };
  const reset = () => {
    const empty = { q: "", start: "", end: "" };
    setDraft(empty);
    setApplied(empty);
    setPage(1);
    setFilterError("");
  };
  const canCancelBooking = (b: Booking) =>
    !readOnly &&
    status(b, now) !== "Cancelled" &&
    (admin ||
      canCancel(
        new Date(b.createdAt),
        new Date(b.session.startAt),
        new Date(now),
      ));
  const startCancel = (b: Booking) => {
    setSelected(null);
    setCancelError("");
    setConfirm(b);
  };
  const showCalendar = (b: Booking) => {
    setSelected(null);
    onViewCalendar(dateKey(today(new Date(b.session.startAt))));
  };
  const next = data?.next;
  const writeFeedback = (booking: Booking) => {
    setSelected(null);
    setFeedbackError("");
    setFeedbackText(booking.feedback?.body || "");
    setFeedbackBooking(booking);
  };
  const groups = new Map<string, Booking[]>();
  if (data)
    for (const b of data.bookings) {
      const key = formatDate(b.session.startAt);
      groups.set(key, [...(groups.get(key) || []), b]);
    }
  const effectivePage = data?.page || page;
  const close = () => {
    if (!busy && !cancelling && !savingFeedback) {
      setSelected(null);
      setConfirm(null);
      setCancelError("");
      setFeedbackBooking(null);
    }
  };
  return (
    <div className="observation-hub">
      <div className="observation-summary" aria-label="Observation totals">
        {states.map((v, i) => (
          <button
            key={v}
            className={`observation-stat ${filter === v ? "selected" : ""}`}
            aria-pressed={filter === v}
            onClick={() => changeState(v)}
          >
            <span className={`observation-stat-icon tone-${i}`}>
              <CalendarDays size={20} />
            </span>
            <span>
              <strong>{data ? data.counts[v] : "—"}</strong>
              <span>{v} observations</span>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      {next && (
        <section className="observation-next" aria-label="Next observation">
          <div className="observation-next-copy">
            <span className="eyebrow">
              {admin ? "NEXT RESERVATION" : "YOUR NEXT OBSERVATION"}
            </span>
            <h2>{next.session.course.title}</h2>
            <div className="observation-meta">
              <span>
                <CalendarDays size={16} />
                {formatDate(next.session.startAt)}
              </span>
              <span>
                <Clock3 size={16} />
                {formatTime(next.session.startAt)}–
                {formatTime(next.session.endAt)} · Tehran
              </span>
            </div>
            <div className="observation-meta">
              <span>
                <Users size={16} />
                {next.session.instructor}
              </span>
              <span>
                <MapPin size={16} />
                {next.session.location}
              </span>
              {admin && <span>{next.user.name}</span>}
            </div>
            <div className="observation-next-actions">
              <button className="primary" onClick={() => setSelected(next)}>
                View details <ArrowUpRight size={16} />
              </button>
              <button className="secondary" onClick={() => showCalendar(next)}>
                View on calendar
              </button>
            </div>
          </div>
          <div className="observation-next-time">
            <span className="observation-live-dot" />
            <strong>{startsIn(next, now)}</strong>
            <span>One reserved observer seat</span>
          </div>
        </section>
      )}
      {!next && data && !loading && !error && (
        <section className="observation-next observation-next-empty">
          <div>
            <span className="eyebrow">MAKE ROOM FOR YOUR NEXT STEP</span>
            <h2>
              {admin
                ? "No upcoming reservations."
                : "Your next observation is waiting."}
            </h2>
            <p>
              {admin
                ? "Review the timetable, past observations, and student feedback."
                : "Explore the academy timetable and reserve an observer seat."}
            </p>
          </div>
          <button className="primary" onClick={onExplore}>
            {admin ? "View timetable" : "Explore available sessions"}{" "}
            <ArrowUpRight size={16} />
          </button>
        </section>
      )}
      {!admin && data?.feedbackPrompt && !error && (
        <section
          className="observation-feedback-prompt"
          aria-label="Optional observation feedback"
        >
          <div>
            <span className="eyebrow">A MOMENT TO REFLECT</span>
            <h2>How was your observation?</h2>
            <p>
              {data.feedbackPrompt.session.course.title} ·{" "}
              {formatDate(data.feedbackPrompt.session.startAt)} ·{" "}
              {data.feedbackPrompt.session.instructor}
            </p>
            <small>
              Share a few thoughts about the session or teacher. Feedback is
              optional and visible only to you, school admins, and TTC masters.
            </small>
          </div>
          <button
            className="secondary"
            onClick={() => writeFeedback(data.feedbackPrompt!)}
          >
            Write feedback
          </button>
        </section>
      )}
      <section
        className="panel observation-panel"
        aria-label="Observation history"
      >
        <div className="section-head">
          <div>
            <h2>
              {admin ? "Observation records" : "Your observation history"}
            </h2>
            <p className="muted">
              Your reservations, all in one place. Times shown in Tehran.
            </p>
          </div>
          <div className="segmented" aria-label="Filter observation status">
            {states.map((v) => (
              <button
                key={v}
                aria-pressed={filter === v}
                className={filter === v ? "active" : ""}
                onClick={() => changeState(v)}
              >
                {v} <span>{data?.counts[v] ?? "—"}</span>
              </button>
            ))}
          </div>
        </div>
        <form
          className="observation-filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              draft.start &&
              draft.end &&
              jalali(draft.start).compare(jalali(draft.end)) > 0
            ) {
              setFilterError(
                "The end date must be on or after the start date.",
              );
              return;
            }
            setFilterError("");
            setPage(1);
            setApplied({ ...draft, q: draft.q.trim() });
          }}
        >
          {admin && (
            <label className="field observation-student-filter">
              <span>Student</span>
              <select
                aria-label="Filter observations by student"
                value={studentId}
                onChange={(e) => {
                  onStudentChange?.(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All students</option>
                {students.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.archivedAt ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field observation-search">
            <span>Find an observation</span>
            <div>
              <Search size={17} />
              <input
                aria-label="Search classes or teachers"
                placeholder="Search class or teacher…"
                maxLength={100}
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </div>
          </label>
          <JalaliPicker
            label="From date"
            placeholder="Any start date"
            value={draft.start}
            onChange={(v) => setDraft({ ...draft, start: v })}
          />
          <JalaliPicker
            label="To date"
            placeholder="Any end date"
            value={draft.end}
            onChange={(v) => setDraft({ ...draft, end: v })}
          />
          <button className="primary" type="submit">
            Apply filters
          </button>
          <button
            type="button"
            className="subtle observation-reset"
            onClick={reset}
          >
            Reset
          </button>
        </form>
        {filterError && (
          <p role="alert" className="observation-feedback">
            {filterError}
          </p>
        )}
        {success && (
          <p role="status" className="observation-feedback success">
            {success}
          </p>
        )}
        {error ? (
          <div role="alert" className="observation-error">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => setRetry((x) => x + 1)}
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div
            className="observation-skeletons"
            role="status"
            aria-label="Loading observations"
          >
            <span className="sr-only">Loading observations…</span>
            {[0, 1, 2].map((i) => (
              <div className="observation-skeleton" key={i} />
            ))}
          </div>
        ) : data?.bookings.length ? (
          <>
            <p className="observation-results" role="status">
              {data.total} {filter.toLowerCase()}{" "}
              {data.total === 1 ? "observation" : "observations"}
              {filtered ? " matching your filters" : ""}
              {filter === "Past"
                ? " · Session history, not verified attendance"
                : ""}
            </p>
            <div className="observation-groups">
              {Array.from(groups, ([date, items]) => (
                <section
                  className="observation-group"
                  key={date}
                  aria-label={date}
                >
                  <h3>{date}</h3>
                  {items.map((b) => {
                    const day = today(new Date(b.session.startAt));
                    const state = status(b, now);
                    return (
                      <article className="observation-card" key={b.id}>
                        <div
                          className={`observation-date state-${state.toLowerCase().replace(" ", "-")}`}
                          aria-hidden="true"
                        >
                          <strong>{day.day}</strong>
                          <span>{MONTHS[day.month - 1]}</span>
                          <small>{day.year}</small>
                        </div>
                        <div className="observation-card-main">
                          <div className="observation-card-title">
                            <h4>{b.session.course.title}</h4>
                            <span
                              className={`observation-badge state-${state.toLowerCase().replace(" ", "-")}`}
                            >
                              {state}
                            </span>
                          </div>
                          <div className="observation-meta">
                            <span>
                              <Clock3 size={15} />
                              {formatTime(b.session.startAt)}–
                              {formatTime(b.session.endAt)} · {duration(b)}
                            </span>
                            <span>
                              <Users size={15} />
                              {b.session.instructor}
                            </span>
                            <span>
                              <MapPin size={15} />
                              {b.session.location}
                            </span>
                            {admin && <span>Student: {b.user.name}</span>}
                          </div>
                          <p className="observation-cancellation">
                            <CancellationState
                              booking={b}
                              now={now}
                              admin={admin}
                              readOnly={readOnly}
                            />
                          </p>
                        </div>
                        <div className="observation-card-actions">
                          <button
                            className="secondary"
                            onClick={() => setSelected(b)}
                          >
                            View details
                          </button>
                          {!admin && state === "Past" && (
                            <button
                              className="observation-feedback-action"
                              onClick={() => writeFeedback(b)}
                            >
                              {b.feedback ? "Edit feedback" : "Write feedback"}
                            </button>
                          )}
                          {admin && b.feedback && (
                            <span className="observation-feedback-saved">
                              Feedback received
                            </span>
                          )}
                          {canCancelBooking(b) && (
                            <button
                              className="observation-cancel"
                              disabled={busy}
                              onClick={() => startCancel(b)}
                            >
                              Cancel observation
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className="observation-empty">
            <Empty
              title={
                filtered
                  ? "No matching observations"
                  : `No ${filter.toLowerCase()} observations`
              }
              text={
                filtered
                  ? "Try another class, teacher, or date range."
                  : filter === "Upcoming"
                    ? "Find a class to observe and take the next step in your TTC journey."
                    : filter === "Past"
                      ? "Your past class reservations will appear here after the sessions end."
                      : "Cancelled reservations will stay here so your history is always available."
              }
            />
            <button
              className="secondary"
              onClick={filtered ? reset : onExplore}
            >
              {filtered ? "Clear filters" : "Explore available sessions"}
            </button>
          </div>
        )}
        {!loading && !error && data && data.total > data.pageSize && (
          <div className="pagination">
            <button
              className="secondary"
              disabled={effectivePage === 1}
              onClick={() => setPage(effectivePage - 1)}
            >
              Previous
            </button>
            <span>
              Page {effectivePage} of {Math.ceil(data.total / data.pageSize)}
            </span>
            <button
              className="secondary"
              disabled={effectivePage * data.pageSize >= data.total}
              onClick={() => setPage(effectivePage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
      <ModalOverlay
        className={`react-aria-ModalOverlay ${confirm || feedbackBooking ? "observation-confirm-overlay" : "observation-drawer-overlay"}`}
        isOpen={!!(selected || confirm || feedbackBooking)}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        isDismissable={!busy && !cancelling && !savingFeedback}
        isKeyboardDismissDisabled={busy || cancelling || savingFeedback}
      >
        <Modal
          className={`react-aria-Modal ${confirm || feedbackBooking ? "observation-confirm" : "observation-drawer"}`}
        >
          <Dialog className="observation-dialog">
            {feedbackBooking ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingFeedback(true);
                  setFeedbackError("");
                  try {
                    await json("/api/commands", {
                      action: "saveObservationFeedback",
                      bookingId: feedbackBooking.id,
                      body: feedbackText.trim(),
                    });
                    setFeedbackBooking(null);
                    setSuccess(
                      "Your feedback has been saved. Thank you for sharing your experience.",
                    );
                    setRetry((x) => x + 1);
                  } catch (e) {
                    setFeedbackError((e as Error).message);
                  } finally {
                    setSavingFeedback(false);
                  }
                }}
              >
                <div className="observation-dialog-head">
                  <Heading slot="title">
                    {feedbackBooking.feedback
                      ? "Edit your feedback"
                      : "How was your observation?"}
                  </Heading>
                  <Button
                    aria-label="Close feedback"
                    className="observation-close"
                    isDisabled={savingFeedback}
                    onPress={close}
                  >
                    <X size={20} />
                  </Button>
                </div>
                <div className="observation-confirm-session">
                  <strong>{feedbackBooking.session.course.title}</strong>
                  <span>
                    {formatDate(feedbackBooking.session.startAt)} ·{" "}
                    {formatTime(feedbackBooking.session.startAt)}–
                    {formatTime(feedbackBooking.session.endAt)}
                  </span>
                  <span>Teacher: {feedbackBooking.session.instructor}</span>
                </div>
                <label className="field">
                  <span>Your thoughts about the session or teacher</span>
                  <textarea
                    aria-label="Your thoughts about the session or teacher"
                    rows={6}
                    maxLength={4000}
                    required
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="What did you notice about the lesson, teaching methods, or teacher? What would you take into your own classroom?"
                    disabled={savingFeedback}
                  />
                </label>
                <p className="observation-feedback-privacy">
                  Optional · Visible only to you, school admins, and TTC
                  masters. {feedbackText.length}/4000 characters.
                </p>
                {feedbackError && (
                  <p role="alert" className="alert error">
                    {feedbackError}
                  </p>
                )}
                <div className="observation-confirm-actions">
                  <Button
                    className="secondary"
                    onPress={close}
                    isDisabled={savingFeedback}
                  >
                    Not now
                  </Button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={savingFeedback || !feedbackText.trim()}
                  >
                    {savingFeedback ? "Saving…" : "Save feedback"}
                  </button>
                </div>
              </form>
            ) : confirm ? (
              <>
                <div className="observation-dialog-head">
                  <Heading slot="title">Cancel this observation?</Heading>
                  <Button
                    aria-label="Close cancellation confirmation"
                    className="observation-close"
                    isDisabled={busy || cancelling}
                    onPress={close}
                  >
                    <X size={20} />
                  </Button>
                </div>
                <p>You’ll release the observer seat for another TTC student.</p>
                <div className="observation-confirm-session">
                  <strong>{confirm.session.course.title}</strong>
                  <span>{formatDate(confirm.session.startAt)}</span>
                  <span>
                    {formatTime(confirm.session.startAt)}–
                    {formatTime(confirm.session.endAt)} · Tehran
                  </span>
                  <span>{confirm.session.instructor}</span>
                </div>
                <p className="observation-cancellation">
                  <CancellationState
                    booking={confirm}
                    now={now}
                    admin={admin}
                    readOnly={readOnly}
                  />
                </p>
                {cancelError && (
                  <p className="alert error" role="alert">
                    {cancelError}
                  </p>
                )}
                <div className="observation-confirm-actions">
                  <Button
                    className="secondary"
                    isDisabled={busy || cancelling}
                    onPress={close}
                  >
                    Keep reservation
                  </Button>
                  <Button
                    className="observation-danger"
                    isDisabled={
                      busy || cancelling || !canCancelBooking(confirm)
                    }
                    onPress={async () => {
                      setCancelling(true);
                      setCancelError("");
                      try {
                        if (!(await onCancel(confirm.id)))
                          throw new Error(
                            "Cancellation could not be confirmed. Refresh your history and try again.",
                          );
                        setConfirm(null);
                        setSuccess(
                          "Observation cancelled. The observer seat has been released.",
                        );
                        setRetry((x) => x + 1);
                      } catch (e) {
                        setCancelError((e as Error).message);
                      } finally {
                        setCancelling(false);
                      }
                    }}
                  >
                    {cancelling ? "Cancelling…" : "Confirm cancellation"}
                  </Button>
                </div>
              </>
            ) : selected ? (
              <>
                <div className="observation-dialog-head">
                  <span className="eyebrow">RESERVATION DETAILS</span>
                  <Button
                    aria-label="Close observation details"
                    className="observation-close"
                    onPress={close}
                  >
                    <X size={20} />
                  </Button>
                </div>
                <Heading slot="title">{selected.session.course.title}</Heading>
                <span
                  className={`observation-badge state-${status(selected, now).toLowerCase().replace(" ", "-")}`}
                >
                  {status(selected, now)}
                </span>
                <dl className="observation-detail-list">
                  <div>
                    <dt>Observation date</dt>
                    <dd>{formatDate(selected.session.startAt)}</dd>
                  </div>
                  <div>
                    <dt>Time · Tehran</dt>
                    <dd>
                      {formatTime(selected.session.startAt)}–
                      {formatTime(selected.session.endAt)} ·{" "}
                      {duration(selected)}
                    </dd>
                  </div>
                  <div>
                    <dt>Teacher</dt>
                    <dd>{selected.session.instructor}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{selected.session.location}</dd>
                  </div>
                  {admin && (
                    <div>
                      <dt>Student</dt>
                      <dd>{selected.user.name}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Booked on</dt>
                    <dd>
                      {formatDate(selected.createdAt)} at{" "}
                      {formatTime(selected.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Cancellation deadline</dt>
                    <dd>
                      {formatDate(
                        cancellationDeadline(
                          new Date(selected.createdAt),
                          new Date(selected.session.startAt),
                        ),
                      )}{" "}
                      at{" "}
                      {formatTime(
                        cancellationDeadline(
                          new Date(selected.createdAt),
                          new Date(selected.session.startAt),
                        ),
                      )}
                    </dd>
                  </div>
                  {selected.cancelledAt && (
                    <div>
                      <dt>Cancelled on</dt>
                      <dd>
                        {formatDate(selected.cancelledAt)} at{" "}
                        {formatTime(selected.cancelledAt)}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="observation-detail-note">
                  <CancellationState
                    booking={selected}
                    now={now}
                    admin={admin}
                    readOnly={readOnly}
                  />
                </div>
                {selected.feedback && (
                  <section className="observation-feedback-read">
                    <h3>{admin ? "Student feedback" : "Your feedback"}</h3>
                    <p>{selected.feedback.body}</p>
                    <small>
                      Updated {formatDate(selected.feedback.updatedAt)} at{" "}
                      {formatTime(selected.feedback.updatedAt)} · Tehran
                    </small>
                  </section>
                )}
                <div className="observation-detail-actions">
                  {!admin && status(selected, now) === "Past" && (
                    <button
                      className="secondary"
                      onClick={() => writeFeedback(selected)}
                    >
                      {selected.feedback ? "Edit feedback" : "Write feedback"}
                    </button>
                  )}
                  <button
                    className="primary"
                    onClick={() => showCalendar(selected)}
                  >
                    View on calendar <ArrowUpRight size={16} />
                  </button>
                  {canCancelBooking(selected) && (
                    <button
                      className="observation-cancel"
                      disabled={busy}
                      onClick={() => startCancel(selected)}
                    >
                      Cancel observation
                    </button>
                  )}
                </div>
              </>
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
