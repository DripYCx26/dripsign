const ABSOLUTE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

const ABSOLUTE_UTC = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
  timeZoneName: "short",
});

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "11 Oct 2026, 14:05 BST" in the viewer's zone, or the same instant in UTC for the server. */
export function formatAbsolute(at: Date, zone: "local" | "utc"): string {
  return (zone === "utc" ? ABSOLUTE_UTC : ABSOLUTE).format(at).replace(",", "");
}

/**
 * How long ago, for a list: "just now", "5 minutes ago", "yesterday", "3 days ago", then the date
 * from a week out. A time in the future reads as the date; a list shows only the past.
 */
export function formatRelative(at: Date, now: Date): string {
  const age = now.getTime() - at.getTime();
  if (age < 0) return DATE.format(at);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return RELATIVE.format(-Math.floor(age / MINUTE), "minute");
  if (age < DAY) return RELATIVE.format(-Math.floor(age / HOUR), "hour");
  if (age < 7 * DAY) return RELATIVE.format(-Math.floor(age / DAY), "day");
  return DATE.format(at);
}
