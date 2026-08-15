import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const timezone = process.env.PORTFOLIO_TIMEZONE || "America/Toronto";

if (!mongoUri) throw new Error("MONGODB_URI is not configured.");

const client = new MongoClient(mongoUri);

try {
  await client.connect();
  const databaseName = new URL(mongoUri).pathname.replace(/^\//, "") || "portfolio";
  const collection = client.db(databaseName).collection("journalTrades");
  const trades = await collection.find().toArray();
  const updates = [];
  let entryDatesConverted = 0;
  let startDatesConverted = 0;
  let endDatesConverted = 0;

  for (const trade of trades) {
    const set = {};

    if (typeof trade.startDate === "string") {
      set.startDate = parseLocalDate(trade.startDate, "start", timezone);
      startDatesConverted += 1;
    }
    if (typeof trade.endDate === "string") {
      set.endDate = parseLocalDate(trade.endDate, "end", timezone);
      endDatesConverted += 1;
    }

    const entries = (trade.entries ?? []).map((entry) => {
      if (typeof entry.date !== "string") return entry;
      entryDatesConverted += 1;
      return { ...entry, date: new Date(entry.createdAt) };
    });
    if (entries.some((entry, index) => entry !== trade.entries[index])) {
      set.entries = entries;
    }

    if (Object.keys(set).length) {
      updates.push({
        updateOne: {
          filter: { _id: trade._id },
          update: { $set: set },
        },
      });
    }
  }

  if (updates.length) await collection.bulkWrite(updates);

  console.log(
    JSON.stringify({
      tradesScanned: trades.length,
      tradesUpdated: updates.length,
      startDatesConverted,
      endDatesConverted,
      entryDatesConverted,
    }),
  );
} finally {
  await client.close();
}

function parseLocalDate(value, dateOnlyBoundary, timeZone) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return new Date(value);

  const [dateKey, suppliedTime] = value.split("T");
  const timeKey =
    suppliedTime || (dateOnlyBoundary === "start" ? "00:00" : "23:59:59.999");
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute, second = 0, millisecond = 0] = timeKey
    .split(/[:.]/)
    .map(Number);
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const zoned = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(zoned.year),
    Number(zoned.month) - 1,
    Number(zoned.day),
    Number(zoned.hour),
    Number(zoned.minute),
    Number(zoned.second),
    millisecond,
  );

  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}
