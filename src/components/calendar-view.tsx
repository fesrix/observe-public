"use client";
import { useEffect, useState } from "react";
import type { Session } from "@/lib/contracts";
import {
  dateKey,
  today,
  jalali,
  formatTime,
  DAYS,
  MONTHS,
} from "@/lib/calendar";
import { JalaliPicker } from "./jalali-picker";
import { Empty } from "./primitives";
export function CalendarView({
  anchor,
  view,
  sessions,
  userId,
  onSelect,
  onJump,
  readOnly = false,
}: {
  anchor: string;
  view: string;
  sessions: Session[];
  userId: string;
  onSelect: (s: Session) => void;
  onJump: (date: string) => void;
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState(anchor),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  useEffect(() => setSelected(anchor), [anchor]);
  const date = jalali(anchor),
    first = date.set({ day: 1 });
  const dayIndex = (d: ReturnType<typeof jalali>) =>
    (new Date(`${d.toString()}T12:00:00Z`).getUTCDay() + 1) % 7;
  const start =
    view === "Week"
      ? date.subtract({ days: dayIndex(date) })
      : first.subtract({ days: dayIndex(first) });
  const count =
    view === "Week"
      ? 7
      : Math.ceil(
          (dayIndex(first) + first.calendar.getDaysInMonth(first)) / 7,
        ) * 7;
  const cells = Array.from({ length: count }, (_, i) => start.add({ days: i }));
  const state = (s: Session) =>
    s.bookings.some((b) => b.userId === userId)
      ? "booked"
      : s.bookedCount > 0
        ? "reserved"
        : "available";
  const label = (s: Session) =>
    state(s) === "booked"
      ? "Your observation"
      : state(s) === "reserved"
        ? "Reserved"
        : "Available";
  const filtered = sessions.filter(
    (s) =>
      `${s.course.title} ${s.instructor}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter === "all" || state(s) === filter),
  );
  const onDay = (key: string) =>
    filtered.filter((s) => dateKey(today(new Date(s.startAt))) === key);
  const current = onDay(selected);
  const chip = (s: Session) => (
    <button
      key={s.id}
      className={`session-chip ${state(s)}`}
      onClick={() => onSelect(s)}
    >
      <span>
        {formatTime(s.startAt)}{" "}
        <span className="chip-capacity">{label(s)}</span>
      </span>
      <strong>{s.course.title}</strong>
    </button>
  );
  const card = (s: Session) => (
    <button
      key={s.id}
      className={`calendar-detail-card session-chip ${state(s)}`}
      onClick={() => onSelect(s)}
    >
      <span className="calendar-detail-top">
        <strong>{s.course.title}</strong>
        <span>{label(s)}</span>
      </span>
      <span>
        {formatTime(s.startAt)}–{formatTime(s.endAt)} · Tehran
      </span>
      <span>Teacher: {s.instructor}</span>
      <span>{s.location}</span>
    </button>
  );
  const agenda = filtered.filter(
    (s) =>
      dateKey(today(new Date(s.startAt))).slice(0, 7) === anchor.slice(0, 7),
  );
  return (
    <>
      <div className="calendar-filters">
        <label>
          Search class or teacher
          <input
            aria-label="Search calendar classes or teachers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search classes or teachers"
          />
        </label>
        <label>
          Availability
          <select
            aria-label="Filter calendar availability"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All sessions</option>
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            {!readOnly && <option value="booked">Your observations</option>}
          </select>
        </label>
        <JalaliPicker
          label="Jump to date"
          value={selected}
          onChange={(v) => {
            setSelected(v);
            onJump(v);
          }}
        />
        <button
          className="secondary"
          onClick={() => {
            setSearch("");
            setFilter("all");
          }}
        >
          Reset filters
        </button>
      </div>
      {view === "Month" ? (
        <div className="compact-calendar">
          <div className="compact-grid-wrap">
            <div className="weekdays">
              {DAYS.map((d) => (
                <span key={d}>{d.slice(0, 3)}</span>
              ))}
            </div>
            <div className="calendar-grid compact-grid">
              {cells.map((d) => {
                const key = dateKey(d),
                  items = onDay(key);
                return (
                  <button
                    key={key}
                    className={`compact-day ${d.month !== date.month ? "outside" : ""} ${selected === key ? "selected" : ""}`}
                    aria-pressed={selected === key}
                    aria-label={`${d.day} ${MONTHS[d.month - 1]} ${d.year}, ${items.length} sessions`}
                    onClick={() => setSelected(key)}
                  >
                    <span
                      className={`compact-day-head ${key === dateKey(today()) ? "is-today" : ""}`}
                    >
                      {d.day}
                      <small>
                        {items.length ? `${items.length} sessions` : ""}
                      </small>
                    </span>
                    <span className="compact-day-entries">
                      {items.slice(0, 3).map((s) => (
                        <span
                          className={`compact-entry ${state(s)}`}
                          key={s.id}
                        >
                          {formatTime(s.startAt)} {s.course.title}
                        </span>
                      ))}
                      {items.length > 3 && (
                        <span className="compact-more">
                          +{items.length - 3} more
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="calendar-day-list">
            <div className="calendar-day-heading">
              <span className="eyebrow">SELECTED DAY</span>
              <h3>
                {jalali(selected).day} {MONTHS[jalali(selected).month - 1]}{" "}
                {jalali(selected).year}
              </h3>
              <p>
                {current.length} {current.length === 1 ? "session" : "sessions"}{" "}
                · Tehran
              </p>
            </div>
            {current.length ? (
              <div className="calendar-day-cards">{current.map(card)}</div>
            ) : (
              <Empty
                title="No matching sessions"
                text="Choose another day or adjust your filters."
              />
            )}
          </aside>
        </div>
      ) : (
        <>
          <div
            className={`calendar-desktop ${view === "Agenda" ? "hidden" : ""}`}
          >
            <div className="weekdays">
              {DAYS.map((d) => (
                <span key={d}>{d.slice(0, 3)}</span>
              ))}
            </div>
            <div className="calendar-grid week-view">
              {cells.map((d) => (
                <div
                  className={`calendar-cell ${d.month !== date.month ? "outside" : ""}`}
                  key={dateKey(d)}
                >
                  <span
                    className={`day-number ${dateKey(d) === dateKey(today()) ? "is-today" : ""}`}
                  >
                    {d.day}
                  </span>
                  {onDay(dateKey(d)).map(chip)}
                </div>
              ))}
            </div>
          </div>
          <div className={`agenda ${view === "Agenda" ? "show" : ""}`}>
            {agenda.length ? (
              agenda.map((s) => (
                <div className="agenda-item" key={s.id}>
                  <div>
                    <strong>{today(new Date(s.startAt)).day}</strong>
                    <small>
                      {MONTHS[today(new Date(s.startAt)).month - 1]}
                    </small>
                  </div>
                  {card(s)}
                </div>
              ))
            ) : (
              <Empty
                title="No matching sessions"
                text="Try another period or adjust your filters."
              />
            )}
          </div>
        </>
      )}
    </>
  );
}


