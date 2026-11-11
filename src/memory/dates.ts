// Turns date words in a message ("last Tuesday", "3 November") into real
// calendar days, in the user's time zone.
//
// This is plain code on purpose: a model guessing dates is the easiest way to
// recall the wrong chat. When a phrase is ambiguous, every likely reading is
// kept, best guess first, and recall lets the topic decide. When a reading
// needs an assumption (a date in the future), a note says so, so the agent can
// tell the user what it assumed.

import type { IsoDate } from "./types.ts";

export type DatePhrase = {
  /** The words in the message, as written. */
  text: string;
  /** Calendar days they may mean, best guess first. */
  days: IsoDate[];
  /** An assumption the agent should tell the user about. */
  note?: string;
};

export type DateResolution = {
  today: IsoDate;
  phrases: DatePhrase[];
  /** Every day from every phrase, without repeats, in the order found. */
  days: IsoDate[];
};

const DAY_MS = 86_400_000;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// ---------- Calendar helpers (all in UTC, on whole days) ----------

/** Today's date for the user, in their time zone. */
export function todayIn(timeZone: string, now: Date): IsoDate {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const toTime = (day: IsoDate) => Date.parse(`${day}T00:00:00Z`);
const fromTime = (time: number): IsoDate => new Date(time).toISOString().slice(0, 10);

export function addDays(day: IsoDate, count: number): IsoDate {
  return fromTime(toTime(day) + count * DAY_MS);
}

const weekdayOf = (day: IsoDate) => new Date(toTime(day)).getUTCDay();

function daysBetween(first: IsoDate, last: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** A real calendar day, or null for dates like 31 February. */
function makeDay(year: number, month: number, day: number): IsoDate | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? fromTime(date.getTime()) : null;
}

/** The most recent day with this weekday, strictly before today. */
function lastWeekday(today: IsoDate, weekday: number): IsoDate {
  const back = (weekdayOf(today) - weekday + 7) % 7 || 7;
  return addDays(today, -back);
}

/** Monday of the week that contains this day. Weeks start on Monday. */
function mondayOf(day: IsoDate): IsoDate {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

function readable(day: IsoDate): string {
  return new Date(toTime(day)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------- Rules ----------

type Rule = {
  pattern: RegExp;
  read: (match: RegExpExecArray, today: IsoDate) => Omit<DatePhrase, "text"> | null;
};

const monthNames = Object.keys(MONTHS).join("|");
const weekdayNames = WEEKDAYS.join("|");
const ordinal = "(?:st|nd|rd|th)?";

/** A day and month with no year: this year, or last year if still to come. */
function dayOfMonth(today: IsoDate, month: number, day: number, year?: number): Omit<DatePhrase, "text"> | null {
  if (year !== undefined) {
    const exact = makeDay(year, month, day);
    if (!exact) return null;
    return exact > today ? { days: [exact], note: `${readable(exact)} is in the future.` } : { days: [exact] };
  }
  const thisYear = Number(today.slice(0, 4));
  const candidate = makeDay(thisYear, month, day);
  if (!candidate) return null;
  if (candidate <= today) return { days: [candidate] };
  const lastYear = makeDay(thisYear - 1, month, day);
  if (!lastYear) return null;
  return {
    days: [lastYear],
    note: `${readable(candidate)} has not happened yet, so this means ${readable(lastYear)}.`,
  };
}

// Order matters: longer, more specific phrases come first, and the words they
// use are not matched again by a later rule.
const RULES: Rule[] = [
  {
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    read: (m, today) => dayOfMonth(today, Number(m[2]), Number(m[3]), Number(m[1])),
  },
  {
    pattern: new RegExp(`\\b(\\d{1,2})${ordinal}(?:\\s+of)?\\s+(${monthNames})\\.?(?:,?\\s+(\\d{4}))?\\b`, "gi"),
    read: (m, today) =>
      dayOfMonth(today, MONTHS[(m[2] ?? "").toLowerCase()] ?? 0, Number(m[1]), m[3] ? Number(m[3]) : undefined),
  },
  {
    pattern: new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})${ordinal}(?:,?\\s+(\\d{4}))?\\b`, "gi"),
    read: (m, today) =>
      dayOfMonth(today, MONTHS[(m[1] ?? "").toLowerCase()] ?? 0, Number(m[2]), m[3] ? Number(m[3]) : undefined),
  },
  { pattern: /\bday before yesterday\b/gi, read: (_m, today) => ({ days: [addDays(today, -2)] }) },
  { pattern: /\byesterday\b/gi, read: (_m, today) => ({ days: [addDays(today, -1)] }) },
  {
    pattern: /\b(?:earlier today|today|this morning|this afternoon|this evening|tonight)\b/gi,
    read: (_m, today) => ({ days: [today] }),
  },
  {
    pattern: /\b(?:past|last) (?:7|seven) days\b|\bpast week\b/gi,
    read: (_m, today) => ({ days: daysBetween(addDays(today, -7), addDays(today, -1)) }),
  },
  {
    pattern: /\blast week\b/gi,
    read: (_m, today) => {
      const first = addDays(mondayOf(today), -7);
      const last = addDays(first, 6);
      return { days: daysBetween(first, last), note: `Last week means ${readable(first)} to ${readable(last)}.` };
    },
  },
  { pattern: /\bthis week\b/gi, read: (_m, today) => ({ days: daysBetween(mondayOf(today), today) }) },
  {
    pattern: /\blast month\b/gi,
    read: (_m, today) => {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const first = month === 1 ? makeDay(year - 1, 12, 1) : makeDay(year, month - 1, 1);
      const last = addDays(`${today.slice(0, 7)}-01`, -1);
      return first ? { days: daysBetween(first, last) } : null;
    },
  },
  { pattern: /\bthis month\b/gi, read: (_m, today) => ({ days: daysBetween(`${today.slice(0, 7)}-01`, today) }) },
  {
    pattern: /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks) ago\b/gi,
    read: (m, today) => {
      const word = (m[1] ?? "").toLowerCase();
      const count = SMALL_NUMBERS[word] ?? Number(word);
      if (!Number.isFinite(count) || count < 1) return null;
      if ((m[2] ?? "").toLowerCase().startsWith("day")) return { days: [addDays(today, -count)] };
      // "A week ago" is loose: the exact day first, then a day either side.
      const center = addDays(today, -7 * count);
      return { days: [center, addDays(center, -1), addDays(center, 1)] };
    },
  },
  {
    pattern: new RegExp(`\\bthis (${weekdayNames})\\b`, "gi"),
    read: (m, today) => {
      const weekday = WEEKDAYS.indexOf((m[1] ?? "").toLowerCase());
      const day = addDays(mondayOf(today), (weekday + 6) % 7);
      return day > today ? { days: [day], note: `${readable(day)} is in the future.` } : { days: [day] };
    },
  },
  {
    // "last Tuesday", "on Tuesday", "Tuesday": English is ambiguous between the
    // most recent one and the one a week before, so keep both.
    pattern: new RegExp(`\\b(?:(?:last|on|past)\\s+)?(${weekdayNames})\\b`, "gi"),
    read: (m, today) => {
      const weekday = WEEKDAYS.indexOf((m[1] ?? "").toLowerCase());
      const recent = lastWeekday(today, weekday);
      return { days: [recent, addDays(recent, -7)] };
    },
  },
];

export function resolveDates(message: string, options: { now: Date; timeZone: string }): DateResolution {
  const today = todayIn(options.timeZone, options.now);
  const found: { index: number; end: number; phrase: DatePhrase }[] = [];

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(message); match; match = rule.pattern.exec(message)) {
      const index = match.index;
      const end = index + match[0].length;
      const overlaps = found.some((f) => index < f.end && end > f.index);
      if (overlaps) continue;
      const reading = rule.read(match, today);
      if (reading && reading.days.length > 0) found.push({ index, end, phrase: { text: match[0], ...reading } });
    }
  }

  found.sort((a, b) => a.index - b.index);
  const phrases = found.map((f) => f.phrase);
  const days = [...new Set(phrases.flatMap((p) => p.days))];
  return { today, phrases, days };
}

/** The message with every date phrase cut out, so its words are not read as topic. */
export function withoutDatePhrases(message: string, resolution: DateResolution): string {
  return resolution.phrases.reduce((text, phrase) => text.replace(phrase.text, " "), message);
}
