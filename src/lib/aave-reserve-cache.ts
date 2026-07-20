import { ObjectId, type Collection, type Db } from "mongodb";

import type { AaveReserveHint } from "@/lib/types";

type AaveReserveCacheDocument = {
  _id: ObjectId;
  accountId: string;
  address: string;
  reserves: AaveReserveHint[];
  refreshedAt: Date;
};

const RESERVE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function collection(db: Db): Collection<AaveReserveCacheDocument> {
  return db.collection<AaveReserveCacheDocument>("aaveReserveCaches");
}

export async function getAaveReserveHints(
  db: Db,
  accountId: string,
  address: string,
) {
  const cache = await collection(db).findOne({ accountId, address });
  if (!cache) return null;

  const ageMs = Date.now() - cache.refreshedAt.getTime();
  if (ageMs > RESERVE_CACHE_MAX_AGE_MS) {
    return null;
  }

  return cache.reserves;
}

export async function saveAaveReserveHints(
  db: Db,
  accountId: string,
  address: string,
  reserves: AaveReserveHint[],
) {
  await collection(db).updateOne(
    { accountId, address },
    {
      $set: {
        accountId,
        address,
        reserves,
        refreshedAt: new Date(),
      },
    },
    { upsert: true },
  );
}
