import { ObjectId, type Collection, type Db } from "mongodb";

import { getYearFromDateKey } from "@/lib/date";
import type { PortfolioSnapshot } from "@/lib/types";

type SnapshotDocument = Omit<PortfolioSnapshot, "id"> & {
  _id: ObjectId;
};

function collection(db: Db): Collection<SnapshotDocument> {
  return db.collection<SnapshotDocument>("portfolioSnapshots");
}

function serializeSnapshot(snapshot: SnapshotDocument): PortfolioSnapshot {
  return {
    id: snapshot._id.toString(),
    dateKey: snapshot.dateKey,
    timezone: snapshot.timezone,
    capturedAt: snapshot.capturedAt,
    totals: snapshot.totals,
    sourceSummaries: snapshot.sourceSummaries,
    positions: snapshot.positions,
    sourceErrors: snapshot.sourceErrors ?? [],
  };
}

export async function upsertDailySnapshot(
  db: Db,
  snapshot: PortfolioSnapshot,
) {
  await collection(db).updateOne(
    { dateKey: snapshot.dateKey },
    {
      $set: {
        dateKey: snapshot.dateKey,
        timezone: snapshot.timezone,
        capturedAt: snapshot.capturedAt,
        totals: snapshot.totals,
        sourceSummaries: snapshot.sourceSummaries,
        positions: snapshot.positions,
        sourceErrors: snapshot.sourceErrors,
      },
    },
    { upsert: true },
  );

  return findSnapshotByDate(db, snapshot.dateKey);
}

export async function findSnapshotByDate(db: Db, dateKey: string) {
  const snapshot = await collection(db).findOne({ dateKey });
  return snapshot ? serializeSnapshot(snapshot) : null;
}

export async function findSnapshotOnOrBefore(db: Db, dateKey: string) {
  const snapshot = await collection(db)
    .find({ dateKey: { $lte: dateKey } })
    .sort({ dateKey: -1 })
    .limit(1)
    .next();

  return snapshot ? serializeSnapshot(snapshot) : null;
}

export async function findEarliestSnapshotInYear(db: Db, dateKey: string) {
  const year = getYearFromDateKey(dateKey);
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const snapshot = await collection(db)
    .find({ dateKey: { $gte: start, $lte: end } })
    .sort({ dateKey: 1 })
    .limit(1)
    .next();

  return snapshot ? serializeSnapshot(snapshot) : null;
}
