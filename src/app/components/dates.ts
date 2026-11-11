// Date labels for the screen, in the user's own time zone.

const DAY = 86_400_000;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function todayHere(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "11 Nov", or "11 Nov 2025" in another year. */
export function shortDay(day: string, today = todayHere()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Date(at(day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** The sidebar heading for a chat's day: Today, Yesterday, a weekday this past week, or a date. */
export function groupLabel(day: string, today = todayHere()): string {
  const back = Math.round((at(today) - at(day)) / DAY);
  if (back <= 0) return "Today";
  if (back === 1) return "Yesterday";
  if (back < 7) return new Date(at(day)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return shortDay(day, today);
}
