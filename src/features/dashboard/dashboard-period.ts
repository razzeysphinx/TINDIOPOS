import type { ReportFilter } from "@/features/reports/reporting";

export const dashboardPeriodKeys = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
  "previous_month",
  "custom",
] as const;

export type DashboardPeriodKey = (typeof dashboardPeriodKeys)[number];
export type DashboardComparisonKey = "previous" | "none";

export type DashboardSearchParams = {
  compare?: string | string[];
  end?: string | string[];
  period?: string | string[];
  start?: string | string[];
  store?: string | string[];
};

export type DashboardPeriod = {
  comparison: DashboardComparisonKey;
  comparisonFilter: ReportFilter | null;
  comparisonLabel: string | null;
  filter: ReportFilter;
  period: DashboardPeriodKey;
  periodLabel: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function firstString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function isDate(value: string | undefined): value is string {
  if (!value || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthBounds(date: string, offset: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const first = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset + 1, 0));
  return { startDate: first.toISOString().slice(0, 10), endDate: last.toISOString().slice(0, 10) };
}

function periodLength(startDate: string, endDate: string) {
  return Math.round(
    (new Date(`${endDate}T00:00:00.000Z`).valueOf() -
      new Date(`${startDate}T00:00:00.000Z`).valueOf()) /
      86_400_000,
  ) + 1;
}

export function resolveDashboardPeriod(
  searchParams: DashboardSearchParams,
  timezone: string,
  storeId: string | null,
): DashboardPeriod {
  const today = dateInTimezone(timezone);
  const requestedPeriod = firstString(searchParams.period);
  const period = dashboardPeriodKeys.includes(requestedPeriod as DashboardPeriodKey)
    ? requestedPeriod as DashboardPeriodKey
    : "today";
  const requestedComparison = firstString(searchParams.compare);
  const comparison: DashboardComparisonKey = requestedComparison === "none" ? "none" : "previous";

  let startDate = today;
  let endDate = today;
  let periodLabel = "Today";

  if (period === "yesterday") {
    startDate = addDays(today, -1);
    endDate = startDate;
    periodLabel = "Yesterday";
  } else if (period === "last_7_days") {
    startDate = addDays(today, -6);
    periodLabel = "Last 7 days";
  } else if (period === "last_30_days") {
    startDate = addDays(today, -29);
    periodLabel = "Last 30 days";
  } else if (period === "this_month") {
    startDate = monthBounds(today, 0).startDate;
    periodLabel = "This month";
  } else if (period === "previous_month") {
    ({ startDate, endDate } = monthBounds(today, -1));
    periodLabel = "Previous month";
  } else if (period === "custom") {
    const requestedStart = firstString(searchParams.start);
    const requestedEnd = firstString(searchParams.end);
    if (
      isDate(requestedStart)
      && isDate(requestedEnd)
      && requestedEnd >= requestedStart
      && periodLength(requestedStart, requestedEnd) <= 366
    ) {
      startDate = requestedStart;
      endDate = requestedEnd;
      periodLabel = "Custom period";
    } else {
      periodLabel = "Today";
    }
  }

  const filter = { startDate, endDate, storeId };
  if (comparison === "none") {
    return { comparison, comparisonFilter: null, comparisonLabel: null, filter, period, periodLabel };
  }

  const days = periodLength(startDate, endDate);
  const comparisonEnd = addDays(startDate, -1);
  const comparisonStart = addDays(comparisonEnd, -(days - 1));
  const comparisonLabel = period === "today"
    ? "yesterday"
    : period === "last_7_days"
      ? "previous 7 days"
      : period === "last_30_days"
        ? "previous 30 days"
        : "previous period";

  return {
    comparison,
    comparisonFilter: { startDate: comparisonStart, endDate: comparisonEnd, storeId },
    comparisonLabel,
    filter,
    period,
    periodLabel,
  };
}

export function dashboardQueryString(
  period: Pick<DashboardPeriod, "comparison" | "filter" | "period">,
  storeId: string | null,
) {
  const query = new URLSearchParams({ compare: period.comparison, period: period.period });
  if (storeId) query.set("store", storeId);
  if (period.period === "custom") {
    query.set("start", period.filter.startDate);
    query.set("end", period.filter.endDate);
  }
  return query.toString();
}
