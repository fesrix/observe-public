"use client";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Dialog,
  DialogTrigger,
  Heading,
  I18nProvider,
  Popover,
} from "react-aria-components";
import { PersianCalendar } from "@internationalized/date";
import { dateKey, jalali, MONTHS, today } from "@/lib/calendar";
export function JalaliPicker({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const date = value ? jalali(value) : today();
  return (
    <div className="field">
      <span>{label}</span>
      <I18nProvider locale="en-GB-u-ca-persian-nu-latn">
        <DialogTrigger>
          <Button
            className="date-trigger"
            aria-label={`${label}: ${!value && placeholder ? placeholder : `${date.day} ${MONTHS[date.month - 1]} ${date.year}`}`}
          >
            {!value && placeholder
              ? placeholder
              : `${date.day} ${MONTHS[date.month - 1]} ${date.year}`}
            <span>▦</span>
          </Button>
          <Popover className="date-popover">
            <Dialog aria-label={label}>
              <Calendar
                aria-label={label}
                value={date}
                onChange={(d) => onChange(dateKey(d))}
                createCalendar={() => new PersianCalendar()}
                firstDayOfWeek="sat"
              >
                <header>
                  <Button slot="previous" aria-label="Previous month">
                    ←
                  </Button>
                  <Heading />
                  <Button slot="next" aria-label="Next month">
                    →
                  </Button>
                </header>
                <CalendarGrid>
                  <CalendarGridHeader>
                    {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
                  </CalendarGridHeader>
                  <CalendarGridBody>
                    {(d) => <CalendarCell date={d} />}
                  </CalendarGridBody>
                </CalendarGrid>
              </Calendar>
            </Dialog>
          </Popover>
        </DialogTrigger>
      </I18nProvider>
    </div>
  );
}
