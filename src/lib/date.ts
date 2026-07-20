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

export function getZonedDateStartMs(dateKey: string, timezone: string) {
  return getZonedDateTimeMs(dateKey, timezone, 0, 0, 0, 0);
}

export function getZonedDateEndMs(dateKey: string, timezone: string) {
  return getZonedDateTimeMs(dateKey, timezone, 23, 59, 59, 999);
}

function getZonedDateTimeMs(
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
