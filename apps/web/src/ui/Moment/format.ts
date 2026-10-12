const DAY_PARTS = { day: "numeric", month: "short", year: "numeric" } as const;
const TIME_PARTS = {
  ...DAY_PARTS,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
} as const;

const zoned = (parts: Intl.DateTimeFormatOptions, zone: "local" | "utc") =>
  new Intl.DateTimeFormat("en-GB", zone === "utc" ? { ...parts, timeZone: "UTC" } : parts);

const FORMATS = {
  absolute: { local: zoned(TIME_PARTS, "local"), utc: zoned(TIME_PARTS, "utc") },
  day: { local: zoned(DAY_PARTS, "local"), utc: zoned(DAY_PARTS, "utc") },
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "11 Oct 2026, 14:05 BST" in the viewer's zone, or the same instant in UTC for the server. */
export function formatAbsolute(at: Date, zone: "local" | "utc"): string {
  return FORMATS.absolute[zone].format(at).replace(",", "");
}

/** "11 Oct 2026" in the viewer's zone, or the same instant in UTC for the server. */
export function formatDay(at: Date, zone: "local" | "utc"): string {
  return FORMATS.day[zone].format(at);
}

/**
 * How long ago, for a list: "just now", "5 minutes ago", "yesterday", "3 days ago", then the date
 * from a week out. A time in the future reads as the date; a list shows only the past.
 */
export function formatRelative(at: Date, now: Date): string {
  const age = now.getTime() - at.getTime();
  if (age < 0) return formatDay(at, "local");
  if (age < MINUTE) return "just now";
  if (age < HOUR) return RELATIVE.format(-Math.floor(age / MINUTE), "minute");
  if (age < DAY) return RELATIVE.format(-Math.floor(age / HOUR), "hour");
  if (age < 7 * DAY) return RELATIVE.format(-Math.floor(age / DAY), "day");
  return formatDay(at, "local");
}
