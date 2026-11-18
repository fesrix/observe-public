export type Course = {
  id: string;
  title: string;
  description: string;
  instructor: string;
  location: string;
  capacity: number;
  archived: boolean;
  rules: {
    id: string;
    startDate: string;
    endDate: string;
    slots: { weekday: number; start: string; end: string }[];
  }[];
};
export type Session = {
  id: string;
  courseId: string;
  startAt: string;
  endAt: string;
  instructor: string;
  location: string;
  capacity: number;
  cancelled: boolean;
  exception: boolean;
  bookedCount: number;
  course: { title: string };
  bookings: { id: string; userId: string }[];
};
export type Booking = {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  user: { name: string };
  session: Session;
};
export type HistoryState = "Upcoming" | "Past" | "Cancelled";
export type HistoryBooking = Omit<Booking, "session"> & {
  session: Omit<Session, "bookedCount" | "bookings">;
  feedback: { body: string; createdAt: string; updatedAt: string } | null;
};
export type BookingHistoryData = {
  bookings: HistoryBooking[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<HistoryState, number>;
  next: HistoryBooking | null;
  feedbackPrompt: HistoryBooking | null;
  serverNow: string;
};
export type Student = {
  id: string;
  name: string;
  role: "STUDENT" | "TTC_MASTER";
  email: string | null;
  active: boolean;
  archivedAt: string | null;
  credential: { createdAt: string } | null;
};
export type Data = {
  user: { id: string; name: string; role: "ADMIN" | "STUDENT" | "TTC_MASTER" };
  schoolName: string;
  courses: Course[];
  sessions: Session[];
  bookings: Booking[];
  users: Student[];
  events: {
    id: string;
    actorId: string;
    subjectId: string;
    action: string;
    outcome: string;
    createdAt: string;
    details: unknown;
  }[];
  auditCount: number;
  page: number;
};
export type Command = Record<string, unknown>;
