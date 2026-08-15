export function getDateKey(date = new Date(), timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getYearFromDateKey(dateKey: string) {
  return Number(dateKey.slice(0, 4));
}

export function isValidDateKey(dateKey: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

export function getTimeKey(date = new Date(), timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

export function isValidTimeKey(timeKey: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeKey);
  return Boolean(
    match && Number(match[1]) >= 0 && Number(match[1]) < 24 && Number(match[2]) < 60,
  );
}

export function getDateTimeKey(date = new Date(), timezone: string) {
  return `${getDateKey(date, timezone)}T${getTimeKey(date, timezone)}`;
}

export function isValidDateTimeKey(value: string) {
  if (isValidDateKey(value)) return true;
  const [dateKey, timeKey, remainder] = value.split("T");
  return !remainder && isValidDateKey(dateKey) && isValidTimeKey(timeKey);
}

export function getJournalDateKey(value: string) {
  return value.slice(0, 10);
}

export function formatJournalDateTimeKey(value: string) {
  const [date, time] = value.split("T");
  if (!time) return date;
  const [hour, minute] = time.split(":").map(Number);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
  return `${date} · ${timeLabel}`;
}

export function getZonedJournalDateMs(
  value: string,
  timezone: string,
  dateOnlyBoundary: "start" | "end",
) {
  const [dateKey, timeKey] = value.split("T");
  if (timeKey) return getZonedDateTimeMs(dateKey, timeKey, timezone);
  return dateOnlyBoundary === "start"
    ? getZonedDateStartMs(dateKey, timezone)
    : getZonedDateEndMs(dateKey, timezone);
}

export function getZonedDateTimeMs(
  dateKey: string,
  timeKey: string,
  timezone: string,
) {
  const [hour, minute] = timeKey.split(":").map(Number);
  return calculateZonedDateTimeMs(dateKey, timezone, hour, minute, 0, 0);
}

export function getZonedDateStartMs(dateKey: string, timezone: string) {
  return calculateZonedDateTimeMs(dateKey, timezone, 0, 0, 0, 0);
}

export function getZonedDateEndMs(dateKey: string, timezone: string) {
  return calculateZonedDateTimeMs(dateKey, timezone, 23, 59, 59, 999);
}

function calculateZonedDateTimeMs(
  dateKey: string,
  timezone: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
    millisecond,
  );

  return utcGuess - (zonedAsUtc - utcGuess);
}
