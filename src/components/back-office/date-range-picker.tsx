"use client";

import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type DateRangeValue = {
  end: string;
  start: string;
};

type DateRangePickerProps = {
  className?: string;
  disabled?: boolean;
  endDate?: string;
  endName?: string;
  id: string;
  onCommit: (range: DateRangeValue) => void;
  startDate?: string;
  startName?: string;
  timezone?: string;
};

type RangePreset = {
  id: "today" | "yesterday" | "this-week" | "last-week" | "this-month" | "last-month" | "last-7-days" | "last-30-days";
  label: string;
};

const rangePresets: readonly RangePreset[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-7-days", label: "Last 7 days" },
  { id: "last-30-days", label: "Last 30 days" },
];

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value: string | undefined): value is string {
  if (!value || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
}

function parseDateOnly(value: string | undefined) {
  if (!isDateOnly(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function beginningOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = result.getDay() === 0 ? 6 : result.getDay() - 1;
  result.setDate(result.getDate() - offset);
  return result;
}

function monthBounds(date: Date, offset = 0): DateRangeValue {
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return { start: toDateOnly(first), end: toDateOnly(last) };
}

function currentDateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return parseDateOnly(`${values.get("year")}-${values.get("month")}-${values.get("day")}`) ?? new Date();
}

function presetRange(preset: RangePreset["id"], today: Date): DateRangeValue {
  if (preset === "today") {
    const value = toDateOnly(today);
    return { start: value, end: value };
  }
  if (preset === "yesterday") {
    const value = toDateOnly(addDays(today, -1));
    return { start: value, end: value };
  }
  if (preset === "this-week") {
    const start = beginningOfWeek(today);
    return { start: toDateOnly(start), end: toDateOnly(addDays(start, 6)) };
  }
  if (preset === "last-week") {
    const start = addDays(beginningOfWeek(today), -7);
    return { start: toDateOnly(start), end: toDateOnly(addDays(start, 6)) };
  }
  if (preset === "this-month") return monthBounds(today);
  if (preset === "last-month") return monthBounds(today, -1);
  if (preset === "last-7-days") return { start: toDateOnly(addDays(today, -6)), end: toDateOnly(today) };
  return { start: toDateOnly(addDays(today, -29)), end: toDateOnly(today) };
}

function rangeLabel(range: DateRangeValue, today: Date) {
  if (!range.start || !range.end) return "All dates";
  const matchingPreset = rangePresets.find((preset) => {
    const candidate = presetRange(preset.id, today);
    return candidate.start === range.start && candidate.end === range.end;
  });
  if (matchingPreset) return matchingPreset.label;

  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);
  if (!start || !end) return "Custom range";
  const formatter = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function rangeFromValues(start: string | undefined, end: string | undefined): DateRangeValue {
  return { start: isDateOnly(start) ? start : "", end: isDateOnly(end) ? end : "" };
}

export function DateRangePicker({
  className,
  disabled = false,
  endDate,
  endName,
  id,
  onCommit,
  startDate,
  startName,
  timezone = "UTC",
}: DateRangePickerProps) {
  const propRange = rangeFromValues(startDate, endDate);
  const [currentRange, setCurrentRange] = useState(propRange);
  const [draftRange, setDraftRange] = useState(propRange);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseDateOnly(propRange.start) ?? currentDateInTimezone(timezone));
  const today = useMemo(() => currentDateInTimezone(timezone), [timezone]);

  const displayLabel = rangeLabel(currentRange, today);
  const calendarDays = useMemo(() => monthDays(month), [month]);
  const monthLabel = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(month);

  const commit = (range: DateRangeValue) => {
    setCurrentRange(range);
    setDraftRange(range);
    onCommit(range);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const nextDraft = currentRange;
      setDraftRange(nextDraft);
      setMonth(parseDateOnly(nextDraft.start) ?? today);
    }
    setOpen(nextOpen);
  };

  const selectDate = (value: string) => {
    if (!draftRange.start || draftRange.end) {
      setDraftRange({ start: value, end: "" });
      return;
    }

    setDraftRange(value < draftRange.start
      ? { start: value, end: draftRange.start }
      : { start: draftRange.start, end: value });
  };

  const applyPreset = (preset: RangePreset["id"]) => {
    const range = presetRange(preset, today);
    commit(range);
    setOpen(false);
  };

  const clearRange = () => {
    const range = { start: "", end: "" };
    commit(range);
    setOpen(false);
  };

  const commitCustomRange = () => {
    if (!draftRange.start || !draftRange.end) return;
    commit(draftRange);
    setOpen(false);
  };

  return (
    <div className={cn("grid min-w-0 gap-1.5 lg:min-w-48 lg:flex-none", className)}>
      <Label htmlFor={id}>Date range</Label>
      {startName ? <input name={startName} type="hidden" value={currentRange.start} /> : null}
      {endName ? <input name={endName} type="hidden" value={currentRange.end} /> : null}
      <Popover.Root onOpenChange={handleOpenChange} open={open}>
        <Popover.Trigger
          aria-label={`Date range: ${displayLabel}`}
          className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between font-normal sm:w-auto sm:min-w-52")}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span className="flex min-w-0 items-center gap-2"><CalendarDays aria-hidden="true" /><span className="truncate">{displayLabel}</span></span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="start" collisionPadding={12} side="bottom" sideOffset={8}>
            <Popover.Popup
              aria-label="Choose a date range"
              className="z-50 max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-xl border bg-popover p-3 shadow-xl outline-none motion-reduce:transition-none data-ending-style:opacity-0 data-ending-style:scale-95 sm:p-4"
            >
              <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <div className="grid content-start gap-1 border-b pb-3 sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0">
                  <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quick ranges</p>
                  {rangePresets.map((preset) => {
                    const selected = (() => {
                      const range = presetRange(preset.id, today);
                      return currentRange.start === range.start && currentRange.end === range.end;
                    })();
                    return (
                      <Button
                        className="justify-start"
                        key={preset.id}
                        onClick={() => applyPreset(preset.id)}
                        type="button"
                        variant={selected ? "secondary" : "ghost"}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                  <p className="mt-2 px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Custom</p>
                  <Button className="justify-start" onClick={() => setDraftRange({ start: "", end: "" })} type="button" variant="ghost">Custom</Button>
                  <p className="px-2 text-xs leading-5 text-muted-foreground">Choose a start date, then an end date. Results update only when you select Done.</p>
                </div>

                <div className="min-w-0">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Button aria-label="Previous month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} size="icon-sm" type="button" variant="ghost"><ChevronLeft aria-hidden="true" /></Button>
                    <p aria-live="polite" className="font-medium">{monthLabel}</p>
                    <Button aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} size="icon-sm" type="button" variant="ghost"><ChevronRight aria-hidden="true" /></Button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                    {weekdayLabels.map((label) => <span className="py-1 font-medium" key={label}>{label}</span>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel}>
                    {calendarDays.map((date) => {
                      const value = toDateOnly(date);
                      const inCurrentMonth = date.getMonth() === month.getMonth();
                      const isStart = value === draftRange.start;
                      const isEnd = value === draftRange.end;
                      const inRange = Boolean(draftRange.start && draftRange.end && value >= draftRange.start && value <= draftRange.end);
                      const isToday = value === toDateOnly(today);
                      const dateLabel = new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(date);
                      return (
                        <div key={value} role="gridcell">
                          <button
                            aria-label={`${dateLabel}${isStart ? ", range start" : isEnd ? ", range end" : ""}`}
                            aria-pressed={isStart || isEnd}
                            className={cn(
                              "h-9 w-full rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                              !inCurrentMonth && "text-muted-foreground/60",
                              inRange && "bg-secondary",
                              (isStart || isEnd) && "bg-primary font-semibold text-primary-foreground hover:bg-primary/85",
                              !isStart && !isEnd && "hover:bg-muted",
                              isToday && !isStart && !isEnd && "ring-1 ring-primary/45",
                            )}
                            onClick={() => selectDate(value)}
                            type="button"
                          >
                            {date.getDate()}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <Button onClick={clearRange} type="button" variant="ghost">Clear range</Button>
                    <div className="flex items-center gap-2">
                      <Popover.Close className={buttonVariants({ variant: "outline" })}>Cancel</Popover.Close>
                      <Button disabled={!draftRange.start || !draftRange.end} onClick={commitCustomRange} type="button">Done</Button>
                    </div>
                  </div>
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
