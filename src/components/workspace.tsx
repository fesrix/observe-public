"use client";
import type { Course, Session, Student, Data, Command } from "@/lib/contracts";
import { json } from "@/lib/api";
import { Stat, Field, Empty } from "./primitives";
import { ReviewChanges } from "./review-changes";
import { CalendarView } from "./calendar-view";
import { BookingHistory } from "./booking-history";
import { Login } from "./login";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Users,
  History,
  LogOut,
  ArrowUpRight,
  Clock3,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  ShieldCheck,
  Menu,
  GraduationCap,
  Search,
} from "lucide-react";
import {
  DAYS,
  MONTHS,
  dateKey,
  today,
  jalali,
  instant,
  formatDate,
  formatTime,
  cancellationDeadline,
  canCancel,
} from "@/lib/calendar";
import { JalaliPicker } from "./jalali-picker";
const initialDate = () => dateKey(today());
export default function Workspace({ schoolName }: { schoolName: string }) {
  const latestRequest = useRef(0);
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Overview"),
    [anchor, setAnchor] = useState(initialDate),
    [view, setView] = useState("Week"),
    [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<
      null | "user" | "course" | "schedule" | "session" | "code" | "preview"
    >(null),
    [draft, setDraft] = useState<any>({}),
    [code, setCode] = useState(""),
    [pending, setPending] = useState<Command | null>(null),
    [preview, setPreview] = useState<any>(null);
  const [auditPage, setAuditPage] = useState(1),
    [studentFilter, setStudentFilter] = useState(""),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Session | null>(null);
  const date = jalali(anchor),
    monthStart = date.set({ day: 1 }),
    monthEnd = monthStart.add({ months: 1 });
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const a = jalali(anchor).set({ day: 1 });
      const p = new URLSearchParams({
        start: dateKey(a.subtract({ days: 7 })),
        end: dateKey(a.add({ months: 1, days: 7 })),
        page: String(auditPage),
        student: studentFilter,
        q: query,
      });
      const result = await json("/api/workspace?" + p);
      if (requestId === latestRequest.current) setData(result);
    } catch (e) {
      if (requestId !== latestRequest.current) return;
      if ((e as { status?: number }).status === 401) {
        setData(null);
        setModal(null);
        setCode("");
        setPending(null);
        setPreview(null);
        setSelected(null);
      } else setError((e as Error).message);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [anchor, auditPage, studentFilter, query]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (command: Command) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await json("/api/commands", command);
      if (result.preview) {
        setPending(command);
        setPreview(result);
        setModal("preview");
      } else if (result.code) {
        setCode(result.code);
        setModal("code");
        await refresh();
      } else {
        setModal(null);
        setSelected(null);
        setNotice("Changes saved successfully.");
        await refresh();
      }
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setModal(null);
    setCode("");
    setPreview(null);
    setPending(null);
  };
  if (loading)
    return (
      <div className="full-center">
        <div className="brand-mark">N</div>
        <p>Preparing your learning space…</p>
      </div>
    );
  if (!data)
    return (
      <Login
        schoolName={schoolName}
        onLogin={async () => {
          setTab("Overview");
          setStudentFilter("");
          setAuditPage(1);
          setQuery("");
          setError("");
          setNotice("");
          setMobile(false);
          await refresh();
        }}
      />
    );
  const admin = data.user.role === "ADMIN";
  const readOnly = data.user.role === "TTC_MASTER";
  const staff = admin || readOnly;
  const upcoming = data.bookings.filter(
    (b) =>
      !b.cancelledAt &&
      !b.session.cancelled &&
      new Date(b.session.startAt) > new Date(),
  );
  const next = [...upcoming].sort((a, b) =>
    a.session.startAt.localeCompare(b.session.startAt),
  )[0];
  const nav = staff
    ? ([
        ["Overview", LayoutDashboard],
        ["Calendar", CalendarDays],
        ["Students", Users],
        ...(admin ? [["TTC masters", ShieldCheck] as const] : []),
        ["Classes", BookOpen],
        ["Observations", GraduationCap],
        ["Activity", History],
      ] as const)
    : ([
        ["Overview", LayoutDashboard],
        ["Calendar", CalendarDays],
        ["Classes", BookOpen],
        ["My observations", GraduationCap],
      ] as const);
  const openUser = (u?: Student) => {
    setDraft(
      u
        ? { ...u }
        : {
            name: "",
            email: "",
            active: true,
            role: tab === "TTC masters" ? "TTC_MASTER" : "STUDENT",
          },
    );
    setModal("user");
  };
  const openCourse = (c?: Course) => {
    setDraft(
      c
        ? { ...c }
        : {
            title: "",
            description: "",
            instructor: "",
            location: "",
          },
    );
    setModal("course");
  };
  const openSchedule = (c: Course, rule?: Course["rules"][number]) => {
    setDraft({
      courseId: c.id,
      ruleId: rule?.id,
      startDate: rule?.startDate || initialDate(),
      endDate: rule?.endDate || dateKey(today().add({ months: 3 })),
      effectiveDate: initialDate(),
      slots: rule?.slots || [{ weekday: 1, start: "14:00", end: "15:00" }],
    });
    setModal("schedule");
  };
  const sessions = data.sessions.filter((s) => !s.cancelled);
  const todayKey = dateKey(today());
  const overviewSessions = sessions
    .filter((s) => dateKey(today(new Date(s.startAt))) === todayKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const accountRows = data.users.filter(
    (u) =>
      (!u.archivedAt || readOnly) &&
      u.role === (tab === "TTC masters" ? "TTC_MASTER" : "STUDENT") &&
      `${u.name} ${u.email || ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const change = (key: string, value: unknown) =>
    setDraft((d: any) => ({ ...d, [key]: value }));
  const calendar = (
    <section className="panel calendar-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">YOUR TIME TO GROW</p>
          <h2>
            {MONTHS[date.month - 1]} <span className="muted">{date.year}</span>
          </h2>
        </div>
        <div className="calendar-tools">
          <div className="segmented">
            {["Month", "Week", "Agenda"].map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="Previous period"
            onClick={() =>
              setAnchor(
                dateKey(
                  date.subtract(view === "Week" ? { weeks: 1 } : { months: 1 }),
                ),
              )
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button className="subtle" onClick={() => setAnchor(initialDate())}>
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Next period"
            onClick={() =>
              setAnchor(
                dateKey(
                  date.add(view === "Week" ? { weeks: 1 } : { months: 1 }),
                ),
              )
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-legend">
        <span>
          <i /> Available sessions
        </span>
        <span>
          <i className="amber-dot" /> Reserved
        </span>
        {!readOnly && (
          <span>
            <i className="navy-dot" /> Your observations
          </span>
        )}
        <span>All times in Tehran · GMT+3:30</span>
      </div>
      <CalendarView
        anchor={anchor}
        view={view}
        sessions={sessions}
        userId={data.user.id}
        onSelect={setSelected}
        onJump={setAnchor}
        readOnly={readOnly}
      />
    </section>
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="/" aria-label="School home">
          <span className="brand-mark">
            N<span>·</span>
          </span>
          <span>
            {data.schoolName}
            <small>MAKE ROOM FOR POSSIBILITY</small>
          </span>
        </a>
        <div className="workspace-label">
          {readOnly
            ? "TTC MASTER · READ ONLY"
            : staff
              ? "SCHOOL WORKSPACE"
              : "STUDENT WORKSPACE"}
        </div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              onClick={() => {
                setTab(label);
                setMobile(false);
                setError("");
              }}
            >
              <Icon size={19} />
              {label}
              {tab === label && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-orbit">✳</span>
          <h3>
            A little progress.
            <br />
            Every single day.
          </h3>
          <p>Your next chapter starts with showing up.</p>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">{data.user.name.slice(0, 1)}</span>
          <div>
            <strong>{data.user.name}</strong>
            <small>
              {readOnly
                ? "TTC Master · read only"
                : admin
                  ? "Administrator"
                  : "Student"}
            </small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await json("/api/auth/logout", {});
                latestRequest.current++;
                setData(null);
                setTab("Overview");
                setMobile(false);
                setNotice("");
                setSelected(null);
                close();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{tab}</strong>
          </div>
          <div className="topbar-right">
            <span className="live-dot" /> Asia/Tehran{" "}
            <span className="topbar-date">{formatDate(new Date())}</span>
          </div>
        </header>
        <div className="main-content">
          <div className="page-title">
            <div>
              <p className="eyebrow">
                {staff
                  ? "A THOUGHTFUL SCHOOL, WELL ORGANIZED"
                  : "EVERY SESSION IS A STEP FORWARD"}
              </p>
              <h1>
                {tab === "Overview"
                  ? `Good to see you, ${data.user.name.split(" ")[0]}.`
                  : tab}
              </h1>
              <p>
                {tab === "Overview"
                  ? staff
                    ? "Your school at a glance. Keep the learning moving."
                    : "Choose a class to observe and build your TTC teaching experience."
                  : "A clear view of everything you need, all in one place."}
              </p>
            </div>
            {admin && (
              <button
                className="primary"
                onClick={() =>
                  tab === "Students" || tab === "TTC masters"
                    ? openUser()
                    : tab === "Classes"
                      ? openCourse()
                      : setTab("Classes")
                }
              >
                <Plus size={17} />
                {tab === "Students"
                  ? "Add student"
                  : tab === "TTC masters"
                    ? "Add TTC master"
                    : tab === "Classes"
                      ? "Create class"
                      : "Manage classes"}
              </button>
            )}
          </div>
          {readOnly && (
            <div className="read-only-notice">
              <ShieldCheck size={18} />
              <span>
                TTC Master · Read-only access to student activity, reservations,
                and feedback.
              </span>
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {tab === "Overview" && (
            <>
              <div className="stats">
                <Stat
                  label={staff ? "Active TTC students" : "Available classes"}
                  value={
                    staff
                      ? data.users
                          .filter((u) => u.active && !u.archivedAt)
                          .filter((u) => u.role === "STUDENT").length
                      : data.courses.length
                  }
                  text={
                    staff
                      ? "A community of curious minds"
                      : "Every published class is available to you"
                  }
                  icon={<Users size={21} />}
                />
                <Stat
                  label={staff ? "Sessions this month" : "Upcoming sessions"}
                  value={
                    staff
                      ? sessions.filter((s) => new Date(s.startAt) > new Date())
                          .length
                      : upcoming.length
                  }
                  text={
                    staff
                      ? "Room for meaningful progress"
                      : "Your next steps are on the calendar"
                  }
                  icon={<CalendarDays size={21} />}
                />
                <Stat
                  label={staff ? "Active bookings" : "Your access"}
                  value={
                    staff
                      ? data.bookings.filter((b) => !b.cancelledAt).length
                      : "Unlimited"
                  }
                  text={
                    staff
                      ? "Learning, one session at a time"
                      : "Reserve one observer seat per session"
                  }
                  icon={<ShieldCheck size={21} />}
                />
              </div>
              <div className="overview-grid">
                <div className="feature-card">
                  <div>
                    <span className="pill">
                      {staff ? "THE BIG PICTURE" : "YOUR LEARNING JOURNEY"}
                    </span>
                    <h2>
                      {staff
                        ? "Great learning starts\nwith a little structure."
                        : "Complete your TTC\nclass observations."}
                    </h2>
                    <p>
                      {staff
                        ? readOnly
                          ? "Review student reservations, class activity, and feedback in one read-only workspace."
                          : "Create a schedule that works for your students. We’ll take care of keeping it organized."
                        : "Find your next session and keep your momentum going. Your future self will thank you."}
                    </p>
                    <button onClick={() => setTab("Calendar")}>
                      Explore the calendar <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <div className="orbit-art" aria-hidden="true">
                    <span>Aa</span>
                    <span>A</span>
                    <span>Hi</span>
                    <div>
                      <BookOpen size={36} />
                    </div>
                  </div>
                </div>
                <div className="panel next-card">
                  <p className="eyebrow">
                    {staff ? "COMING UP NEXT" : "YOUR NEXT SESSION"}
                  </p>
                  {(
                    staff
                      ? sessions.find((s) => new Date(s.startAt) > new Date())
                      : next?.session
                  ) ? (
                    (() => {
                      const s = staff
                        ? sessions.find(
                            (s) => new Date(s.startAt) > new Date(),
                          )!
                        : next!.session;
                      return (
                        <>
                          <span className="course-tag">{s.course.title}</span>
                          <h3>
                            Make time for
                            <br />
                            your next chapter.
                          </h3>
                          <p>
                            <CalendarDays size={16} />
                            {formatDate(s.startAt)}
                          </p>
                          <p>
                            <Clock3 size={16} />
                            {formatTime(s.startAt)} – {formatTime(s.endAt)}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setSelected(s)}
                          >
                            View session <ArrowUpRight size={16} />
                          </button>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <h3>
                        Your next chapter
                        <br />
                        is waiting.
                      </h3>
                      <p>Book a session to see it here.</p>
                      <button
                        className="text-button"
                        onClick={() => setTab("Calendar")}
                      >
                        Find a session <ArrowUpRight size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <section
                className="panel overview-timeline"
                aria-label={
                  staff ? "Today's academy sessions" : "Your available sessions today"
                }
              >
                <div className="section-head">
                  <div>
                    <p className="eyebrow">
                      {staff ? "TODAY AT THE ACADEMY" : "TODAY'S OPPORTUNITIES"}
                    </p>
                    <h2>{formatDate(new Date())}</h2>
                  </div>
                  <button className="secondary" onClick={() => setTab("Calendar")}>
                    Open calendar <ArrowUpRight size={16} />
                  </button>
                </div>
                {overviewSessions.length ? (
                  <div className="overview-timeline-list">
                    {overviewSessions.slice(0, 8).map((s) => {
                      const own = s.bookings.some((b) => b.userId === data.user.id);
                      const reserved = s.bookedCount > 0;
                      return (
                        <button
                          key={s.id}
                          className={`overview-session ${
                            own ? "booked" : reserved ? "reserved" : "available"
                          }`}
                          onClick={() => setSelected(s)}
                        >
                          <span className="overview-session-time">
                            {formatTime(s.startAt)}
                            <small>{formatTime(s.endAt)}</small>
                          </span>
                          <span className="overview-session-main">
                            <strong>{s.course.title}</strong>
                            <span>
                              {s.instructor} · {s.location}
                            </span>
                          </span>
                          <span className="overview-session-status">
                            {own
                              ? "Your observation"
                              : reserved
                                ? staff
                                  ? `Reserved · ${
                                      data.users.find(
                                        (u) => u.id === s.bookings[0]?.userId,
                                      )?.name || "Observer"
                                    }`
                                  : "Reserved"
                                : "Available"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Empty
                    title="No sessions today"
                    text={
                      staff
                        ? "The academy has no published sessions today."
                        : "Check the calendar for the next available observation."
                    }
                  />
                )}
              </section>
              {calendar}
            </>
          )}
          {tab === "Calendar" && calendar}
          {tab === "Classes" && (
            <div className="course-grid">
              {data.courses
                .filter((c) => !c.archived)
                .map((c, i) => (
                  <article className="panel course-card" key={c.id}>
                    <div className={`course-cover cover-${i % 3}`}>
                      <BookOpen size={35} />
                      <span>CLASS OBSERVATION</span>
                    </div>
                    <div className="course-body">
                      <span className="eyebrow">ACADEMY CLASS</span>
                      <h2>{c.title}</h2>
                      <p>
                        {c.description ||
                          "Book one observer place in a real academy class."}
                      </p>
                      <p>
                        <Users size={16} />
                        {c.instructor}
                      </p>
                      <p>
                        <MapPin size={16} />
                        {c.location} · one observer per session
                      </p>
                      {admin ? (
                        <div className="button-row">
                          <button
                            className="secondary"
                            onClick={() => openCourse(c)}
                          >
                            Edit
                          </button>
                          <button
                            className="primary"
                            onClick={() => openSchedule(c)}
                          >
                            Publish schedule
                          </button>
                          {c.rules.map((r, j) => (
                            <button
                              className="subtle"
                              key={r.id}
                              onClick={() => openSchedule(c, r)}
                            >
                              Edit rule {j + 1}
                            </button>
                          ))}
                          <button
                            className="danger-link"
                            onClick={() =>
                              run({ action: "archiveCourse", id: c.id })
                            }
                          >
                            Archive
                          </button>
                        </div>
                      ) : (
                        <button
                          className="secondary"
                          onClick={() => setTab("Calendar")}
                        >
                          {readOnly ? "View timetable" : "Find a session"}{" "}
                          <ArrowUpRight size={16} />
                        </button>
                      )}
                      {readOnly && (
                        <div className="master-schedule-summary">
                          {c.rules.map((r) => (
                            <div key={r.id}>
                              <strong>
                                {formatDate(instant(r.startDate, "12:00"))} –{" "}
                                {formatDate(instant(r.endDate, "12:00"))}
                              </strong>
                              {r.slots.map((slot, i) => (
                                <span key={i}>
                                  {DAYS[slot.weekday]} · {slot.start}–{slot.end}{" "}
                                  · Tehran
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              {!data.courses.length && (
                <Empty
                  title="No classes published yet"
                  text={
                    staff
                      ? "Create a class and publish its schedule to get started."
                      : "The academy has not published any classes yet."
                  }
                />
              )}
            </div>
          )}
          {(tab === "Students" || tab === "TTC masters") && (
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>
                    {tab === "TTC masters"
                      ? "TTC master accounts"
                      : "TTC student accounts"}
                  </h2>
                  <p className="muted">
                    {tab === "TTC masters"
                      ? "Read-only access to students, observations, feedback, and activity."
                      : readOnly
                        ? "Review TTC student accounts and observation history."
                        : "Manage TTC student access and account details."}
                  </p>
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label={
                      tab === "TTC masters"
                        ? "Search TTC masters"
                        : "Search students"
                    }
                    placeholder="Find a student…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        {tab === "TTC masters" ? "TTC master" : "Student"}
                      </th>
                      <th>Access</th>
                      <th>{readOnly ? "Review" : "Manage"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountRows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong>
                          <small>{u.email || "No email provided"}</small>
                        </td>
                        <td>
                          <span
                            className={`status ${u.active && u.credential ? "" : "inactive"}`}
                          >
                            {u.archivedAt
                              ? "Archived"
                              : !u.active
                                ? "Inactive"
                                : u.credential
                                  ? "Access enabled"
                                  : "Code revoked"}
                          </span>
                        </td>
                        <td>
                          <div className="button-row">
                            {admin && (
                              <button
                                className="subtle"
                                onClick={() => openUser(u)}
                              >
                                Edit
                              </button>
                            )}
                            <button
                              className="subtle"
                              onClick={() => {
                                setStudentFilter(u.id);
                                setTab("Activity");
                              }}
                            >
                              History
                            </button>
                            <button
                              className="subtle"
                              onClick={() => {
                                setStudentFilter(u.id);
                                setTab("Observations");
                              }}
                            >
                              Observations
                            </button>
                            {admin && (
                              <>
                                <button
                                  className="subtle"
                                  onClick={() => {
                                    setPending({
                                      action: "rotateCode",
                                      id: u.id,
                                    });
                                    setPreview({
                                      details: {
                                        message:
                                          "Replace the access code and sign this student out on all devices.",
                                      },
                                    });
                                    setModal("preview");
                                  }}
                                >
                                  New code
                                </button>
                                <button
                                  className="danger-link"
                                  onClick={() => {
                                    setPending({
                                      action: "revokeCode",
                                      id: u.id,
                                    });
                                    setPreview({
                                      details: {
                                        message:
                                          "Revoke access and sign this student out on all devices.",
                                      },
                                    });
                                    setModal("preview");
                                  }}
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!accountRows.length && (
                <Empty
                  title="No matching accounts"
                  text={
                    readOnly
                      ? "Try another name or email address."
                      : "Add an account to create a private access code."
                  }
                />
              )}
            </section>
          )}
          {(tab === "Observations" || tab === "My observations") && (
            <BookingHistory
              bookings={data.bookings}
              admin={staff}
              readOnly={readOnly}
              students={data.users.filter((u) => u.role === "STUDENT")}
              studentId={studentFilter}
              onStudentChange={setStudentFilter}
              busy={busy}
              onCancel={async (id) => {
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  await json("/api/commands", { action: "cancelBooking", id });
                  await refresh();
                  return true;
                } finally {
                  setBusy(false);
                }
              }}
              onExplore={() => {
                setTab("Calendar");
                setAnchor(initialDate());
              }}
              onViewCalendar={(date) => {
                setTab("Calendar");
                setAnchor(date);
                setView("Week");
              }}
            />
          )}
          {tab === "Activity" && (
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>A clear record of every step</h2>
                  <p className="muted">
                    {data.auditCount} recorded events · Tehran timestamps
                  </p>
                </div>
                <div className="button-row">
                  <select
                    aria-label="Filter by student"
                    value={studentFilter}
                    onChange={(e) => {
                      setStudentFilter(e.target.value);
                      setAuditPage(1);
                    }}
                  >
                    <option value="">All students</option>
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Search activity"
                    placeholder="Search actions…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setAuditPage(1);
                    }}
                  />
                </div>
              </div>
              <div className="activity-list">
                {data.events.map((e) => (
                  <article key={e.id}>
                    <span className="activity-icon">
                      <History size={17} />
                    </span>
                    <div>
                      <strong>
                        {e.action.replaceAll("_", " ").toLowerCase()}
                      </strong>
                      <p>
                        {data.users.find((u) => u.id === e.subjectId)?.name ||
                          "School workspace"}{" "}
                        · {e.outcome}
                      </p>
                      <details>
                        <summary>View details</summary>
                        <pre>{JSON.stringify(e.details, null, 2)}</pre>
                        <small>Actor: {e.actorId || "Unauthenticated"}</small>
                      </details>
                    </div>
                    <time>
                      {formatDate(e.createdAt)}
                      <small>{formatTime(e.createdAt)}</small>
                    </time>
                  </article>
                ))}
              </div>
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>Page {auditPage}</span>
                <button
                  className="secondary"
                  disabled={auditPage * 30 >= data.auditCount}
                  onClick={() => setAuditPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              {data.schoolName} <span>·</span> A little progress, every day.
            </span>
            <span>Jalali calendar · Tehran time</span>
          </footer>
        </div>
      </main>
      <ModalOverlay
        isOpen={!!modal || !!selected}
        onOpenChange={(open) => {
          if (!open) {
            close();
            setSelected(null);
          }
        }}
        isDismissable={!busy}
      >
        <Modal>
          <Dialog
            aria-label={
              selected
                ? "Session details"
                : modal === "code"
                  ? "Private access code"
                  : "Manage school"
            }
          >
            <div className="modal-head">
              <Heading slot="title">
                {selected
                  ? "Your next opportunity"
                  : modal === "user"
                    ? draft.id
                      ? draft.role === "TTC_MASTER"
                        ? "Edit TTC master"
                        : "Edit student"
                      : draft.role === "TTC_MASTER"
                        ? "New TTC master"
                        : "Welcome a new student"
                    : modal === "course"
                      ? draft.id
                        ? "Edit class"
                        : "Create an academy class"
                      : modal === "schedule"
                        ? "Build a learning rhythm"
                        : modal === "session"
                          ? "Edit this session"
                          : modal === "preview"
                            ? "Review before confirming"
                            : "Private access code"}
              </Heading>
              <Button
                className="icon-button"
                aria-label="Close dialog"
                isDisabled={busy}
                onPress={() => {
                  close();
                  setSelected(null);
                }}
              >
                ×
              </Button>
            </div>
            {error && (
              <p role="alert" className="alert error">
                {error}
              </p>
            )}
            {selected && (
              <div className="session-detail">
                <span className="course-tag">{selected.course.title}</span>
                <h2>{formatDate(selected.startAt)}</h2>
                <p>
                  <Clock3 size={18} />
                  {formatTime(selected.startAt)} – {formatTime(selected.endAt)}{" "}
                  · Tehran
                </p>
                <p>
                  <MapPin size={18} />
                  {selected.location}
                </p>
                <p>
                  <Users size={18} />
                  Teacher: {selected.instructor}
                </p>
                <p>
                  {selected.cancelled
                    ? "Cancelled"
                    : (selected.bookedCount ?? selected.bookings?.length ?? 0) >
                        0
                      ? "Observer seat reserved"
                      : "One observer seat available"}
                </p>
                {staff && !!selected.bookings?.length && (
                  <p>
                    Observer:{" "}
                    {selected.bookings
                      .map(
                        (b) =>
                          data.users.find((u) => u.id === b.userId)?.name ||
                          "Student",
                      )
                      .join(", ")}
                  </p>
                )}
                {admin ? (
                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={() => {
                        setDraft({
                          id: selected.id,
                          date: dateKey(today(new Date(selected.startAt))),
                          start: formatTime(selected.startAt),
                          end: formatTime(selected.endAt),
                          instructor: selected.instructor,
                          location: selected.location,
                        });
                        setSelected(null);
                        setModal("session");
                      }}
                    >
                      Edit session
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || selected.cancelled}
                      onClick={() => {
                        const id = selected.id;
                        setSelected(null);
                        run({ action: "cancelSession", id, preview: true });
                      }}
                    >
                      Cancel session
                    </button>
                  </div>
                ) : !readOnly ? (
                  <button
                    className="primary wide"
                    disabled={
                      busy ||
                      selected.cancelled ||
                      new Date(selected.startAt) <= new Date() ||
                      !!selected.bookings?.some(
                        (b) => b.userId === data.user.id,
                      ) ||
                      selected.bookedCount >= 1
                    }
                    onClick={() =>
                      run({
                        action: "book",
                        sessionId: selected.id,
                        requestKey: crypto.randomUUID(),
                      })
                    }
                  >
                    {selected.bookings?.some((b) => b.userId === data.user.id)
                      ? "You’re booked in"
                      : selected.bookedCount >= 1
                        ? "Observer seat reserved"
                        : "Book this observation"}
                    <ArrowUpRight size={17} />
                  </button>
                ) : (
                  <p className="observation-read-only">
                    Read-only access · Review the timetable and observer
                    reservations.
                  </p>
                )}
                <p className="helper">
                  Student cancellations close 30 minutes after booking or at
                  class start, whichever comes first.
                </p>
              </div>
            )}
            {modal === "code" && (
              <div>
                <p>
                  Copy this private code and send it directly to the account
                  holder. It will not be shown again.
                </p>
                <div className="secret-code">{code}</div>
                <button
                  className="primary wide"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(code);
                      setNotice("Access code copied.");
                    } catch {
                      setError("Copy the code manually from the field above.");
                    }
                  }}
                >
                  Copy private code
                </button>
                <p className="helper">
                  This code does not expire. Replacing or revoking it signs the
                  account holder out everywhere.
                </p>
              </div>
            )}
            {modal === "preview" && (
              <div>
                <p>
                  Review the affected records. Changes are committed together
                  only after confirmation.
                </p>
                <ReviewChanges details={preview.details} data={data} />
                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={() =>
                    pending &&
                    run({
                      ...pending,
                      preview: false,
                      fingerprint: preview.fingerprint,
                    })
                  }
                >
                  {busy ? "Saving…" : "Confirm changes"}
                </button>
              </div>
            )}
            {(modal === "user" ||
              modal === "course" ||
              modal === "session" ||
              modal === "schedule") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (modal === "user")
                    run({
                      action: draft.id ? "updateUser" : "createUser",
                      id: draft.id,
                      name: draft.name,
                      email: draft.email || "",
                      active: draft.active,
                      ...(!draft.id ? { role: draft.role || "STUDENT" } : {}),
                    });
                  if (modal === "course")
                    run({
                      action: "saveCourse",
                      id: draft.id,
                      title: draft.title,
                      description: draft.description,
                      instructor: draft.instructor,
                      location: draft.location,
                    });
                  if (modal === "session")
                    run({ action: "editSession", ...draft, preview: true });
                  if (modal === "schedule")
                    run({ action: "schedule", ...draft, preview: true });
                }}
              >
                {modal === "user" && (
                  <>
                    <Field
                      label="Full name"
                      value={draft.name}
                      onChange={(v) => change("name", v)}
                      required
                    />
                    <Field
                      label="Email (optional)"
                      type="email"
                      value={draft.email || ""}
                      onChange={(v) => change("email", v)}
                    />
                    {draft.id && (
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(e) => change("active", e.target.checked)}
                        />{" "}
                        Account active
                      </label>
                    )}
                  </>
                )}
                {modal === "course" && (
                  <>
                    <Field
                      label="Class level and name"
                      value={draft.title}
                      onChange={(v) => change("title", v)}
                      required
                    />
                    <label className="field">
                      <span>Class notes (optional)</span>
                      <textarea
                        value={draft.description}
                        onChange={(e) => change("description", e.target.value)}
                      />
                    </label>
                  </>
                )}
                {(modal === "course" || modal === "session") && (
                  <>
                    <Field
                      label="Instructor"
                      value={draft.instructor}
                      onChange={(v) => change("instructor", v)}
                      required
                    />
                    <div className="form-grid">
                      <Field
                        label="Classroom / location"
                        value={draft.location}
                        onChange={(v) => change("location", v)}
                        required
                      />
                    </div>
                  </>
                )}
                {modal === "session" && (
                  <>
                    <JalaliPicker
                      label="Session date"
                      value={draft.date}
                      onChange={(v) => change("date", v)}
                    />
                    <div className="form-grid">
                      <Field
                        label="Start time"
                        type="time"
                        value={draft.start}
                        onChange={(v) => change("start", v)}
                        required
                      />
                      <Field
                        label="End time"
                        type="time"
                        value={draft.end}
                        onChange={(v) => change("end", v)}
                        required
                      />
                    </div>
                  </>
                )}
                {modal === "schedule" && (
                  <>
                    <p className="helper">
                      Choose a Jalali date range and the weekdays and times when
                      this academy class meets. One TTC observer may book each
                      occurrence. All times are in Tehran.
                    </p>
                    <div className="form-grid">
                      <JalaliPicker
                        label="Starts"
                        value={draft.startDate}
                        onChange={(v) => change("startDate", v)}
                      />
                      <JalaliPicker
                        label="Ends"
                        value={draft.endDate}
                        onChange={(v) => change("endDate", v)}
                      />
                    </div>
                    {draft.ruleId && (
                      <JalaliPicker
                        label="Apply changes from"
                        value={draft.effectiveDate}
                        onChange={(v) => change("effectiveDate", v)}
                      />
                    )}
                    <p className="helper">
                      Rule edits pair future sessions chronologically, retaining
                      bookings. Extra old sessions are cancelled. Individual
                      exceptions stay unchanged. Review the affected list before
                      saving.
                    </p>
                    <div className="slot-list">
                      {draft.slots.map((s: any, i: number) => (
                        <div className="slot-row" key={i}>
                          <select
                            aria-label={`Weekday ${i + 1}`}
                            value={s.weekday}
                            onChange={(e) =>
                              change(
                                "slots",
                                draft.slots.map((x: any, j: number) =>
                                  i === j
                                    ? { ...x, weekday: Number(e.target.value) }
                                    : x,
                                ),
                              )
                            }
                          >
                            {DAYS.map((d, k) => (
                              <option key={d} value={k}>
                                {d}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={`Start time ${i + 1}`}
                            type="time"
                            required
                            value={s.start}
                            onChange={(e) =>
                              change(
                                "slots",
                                draft.slots.map((x: any, j: number) =>
                                  i === j ? { ...x, start: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <input
                            aria-label={`End time ${i + 1}`}
                            type="time"
                            required
                            value={s.end}
                            onChange={(e) =>
                              change(
                                "slots",
                                draft.slots.map((x: any, j: number) =>
                                  i === j ? { ...x, end: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove slot ${i + 1}`}
                            onClick={() =>
                              change(
                                "slots",
                                draft.slots.filter(
                                  (_: any, j: number) => i !== j,
                                ),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        change("slots", [
                          ...draft.slots,
                          { weekday: 3, start: "19:00", end: "21:00" },
                        ])
                      }
                    >
                      <Plus size={15} /> Add weekly slot
                    </button>
                  </>
                )}
                <div className="modal-actions">
                  {modal === "user" && draft.id && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => {
                        setPending({ action: "archiveUser", id: draft.id });
                        setPreview({
                          details: {
                            message:
                              "Archive this student, revoke their code, and cancel all future bookings. History is retained.",
                          },
                        });
                        setModal("preview");
                      }}
                    >
                      Archive account
                    </button>
                  )}
                  <button className="primary" disabled={busy}>
                    {busy
                      ? "Working…"
                      : modal === "schedule" || modal === "session"
                        ? "Preview changes"
                        : "Save changes"}
                  </button>
                </div>
              </form>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
