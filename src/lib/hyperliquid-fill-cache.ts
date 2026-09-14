import type { Db, MongoClient } from "mongodb";

import {
  aggregateFillsToOrders,
  fetchHyperliquidUserFillsByTime,
} from "@/lib/hyperliquid";
import type { HyperliquidFill, PortfolioAccount } from "@/lib/types";

const REFRESH_INTERVAL_MS = 60_000;
const OVERLAP_MS = 5 * 60_000;

// Raw fills have stable trade IDs. Time-aggregated fills can change at range
// boundaries, so they must never be used for persistent, incremental upserts.
export type StoredHyperliquidFill = Omit<
  HyperliquidFill,
  "id" | "accountId" | "accountLabel" | "time" | "timeKey"
> & { _id: string; wallet: string; fillId: string; time: Date };

type SyncState = { _id: string; syncedThrough: Date; refreshedAt: Date };

export interface FillHistoryStore {
  getSync(wallet: string): Promise<SyncState | null>;
  saveFills(fills: StoredHyperliquidFill[]): Promise<void>;
  saveSync(state: SyncState): Promise<void>;
  readFills(
    wallet: string,
    start: Date,
    end: Date,
    coins?: string[],
  ): Promise<StoredHyperliquidFill[]>;
}

export type FillHistoryQuery = {
  account: PortfolioAccount;
  startTime: number;
  endTime: number;
  coinAliases?: string[];
};

export class HyperliquidFillCache {
  constructor(
    private store: FillHistoryStore,
    private fetchFills = fetchHyperliquidUserFillsByTime,
    private now = Date.now,
    private inFlight = new Map<string, Promise<void>>(),
  ) {}

  async getOrders({
    account,
    startTime,
    endTime,
    coinAliases,
  }: FillHistoryQuery) {
    const wallet = account.address.toLowerCase();
    await this.ensureSynced(account, wallet, endTime);

    const stored = await this.store.readFills(
      wallet,
      new Date(startTime),
      new Date(endTime),
      coinAliases,
    );
    const fills = stored.map(
      ({ _id, wallet: storedWallet, fillId, time, ...fill }) => {
        // Account labels/IDs are presentation context, not the wallet's identity.
        void _id;
        void storedWallet;
        return {
          ...fill,
          id: `${account.id}:${fillId}`,
          accountId: account.id,
          accountLabel: account.label,
          time: time.getTime(),
          timeKey: time.toISOString(),
        };
      },
    );
    return aggregateFillsToOrders(fills);
  }

  private async ensureSynced(
    account: PortfolioAccount,
    wallet: string,
    endTime: number,
  ) {
    // Recheck after joining: a closed journal may have skipped refreshing, while
    // this caller needs the latest fills. Only one caller can start that refresh.
    for (;;) {
      const pending = this.inFlight.get(wallet);
      if (pending) {
        await pending;
        continue;
      }
      const request = this.sync(account, wallet, endTime).finally(() =>
        this.inFlight.delete(wallet),
      );
      this.inFlight.set(wallet, request);
      await request;
      return;
    }
  }

  private async sync(
    account: PortfolioAccount,
    wallet: string,
    requestedEnd: number,
  ) {
    const state = await this.store.getSync(wallet);
    const now = this.now();
    if (
      state &&
      (state.syncedThrough.getTime() >= requestedEnd ||
        now - state.refreshedAt.getTime() < REFRESH_INTERVAL_MS)
    )
      return;

    // Bootstrap through now even for a closed journal, so other date ranges and
    // Stats can reuse this same fetch. Later requests only fetch recent activity.
    const startTime = state
      ? Math.max(0, state.syncedThrough.getTime() - OVERLAP_MS)
      : 0;
    const fills = await this.fetchFills({
      account: { ...account, address: wallet },
      startTime,
      endTime: now,
      aggregateByTime: false,
    });
    const stored = fills.map((fill): StoredHyperliquidFill => {
      const { id, accountId, accountLabel, time, timeKey, ...values } = fill;
      void accountLabel;
      void timeKey;
      const fillId = id.slice(accountId.length + 1);
      if (!fillId || !Number.isFinite(time) || time < startTime || time > now) {
        throw new Error(
          "Hyperliquid returned an invalid fill; history was not marked as refreshed.",
        );
      }
      return {
        ...values,
        _id: `${wallet}:${fillId}`,
        wallet,
        fillId,
        time: new Date(time),
      };
    });
    await this.store.saveFills(stored);
    // Advance only after all pages and writes succeed. $max prevents an older
    // sync from moving the cursor backwards if another server also refreshes.
    await this.store.saveSync({
      _id: wallet,
      syncedThrough: new Date(now),
      refreshedAt: new Date(this.now()),
    });
  }
}

type CacheRuntime = {
  inFlight: Map<string, Promise<void>>;
  index?: Promise<unknown>;
};

function mongoStore(db: Db, runtime: CacheRuntime): FillHistoryStore {
  const fills = db.collection<StoredHyperliquidFill>("hyperliquidFills");
  const syncs = db.collection<SyncState>("hyperliquidFillSyncs");
  function ensureIndex() {
    runtime.index ??= fills
      .createIndex({ wallet: 1, time: 1 })
      .catch((error) => {
        runtime.index = undefined;
        throw error;
      });
    return runtime.index;
  }
  return {
    getSync: (wallet) => syncs.findOne({ _id: wallet }),
    async saveFills(documents) {
      await ensureIndex();
      if (!documents.length) return;
      await fills.bulkWrite(
        documents.map((fill) => ({
          updateOne: {
            filter: { _id: fill._id },
            update: { $set: fill },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },
    async saveSync(state) {
      await syncs.updateOne(
        { _id: state._id },
        {
          $max: {
            syncedThrough: state.syncedThrough,
            refreshedAt: state.refreshedAt,
          },
        },
        { upsert: true },
      );
    },
    async readFills(wallet, start, end, coins) {
      await ensureIndex();
      return fills
        .find({
          wallet,
          time: { $gte: start, $lte: end },
          ...(coins ? { coin: { $in: coins } } : {}),
        })
        .sort({ time: -1 })
        .toArray();
    },
  };
}

// Db handles can be recreated by getDb(). Share syncs across routes by Mongo
// client + database + wallet, and discard in-flight entries after completion.
const shared = globalThis as typeof globalThis & {
  portfolioFillCacheState?: WeakMap<MongoClient, Map<string, CacheRuntime>>;
};
const caches = (shared.portfolioFillCacheState ??= new WeakMap());

export function getHyperliquidFillCache(db: Db) {
  let databases = caches.get(db.client);
  if (!databases) {
    databases = new Map();
    caches.set(db.client, databases);
  }
  let runtime = databases.get(db.databaseName);
  if (!runtime) {
    runtime = { inFlight: new Map() };
    databases.set(db.databaseName, runtime);
  }
  // Retain coordination state, rather than class instances with stale function
  // references across development reloads.
  return new HyperliquidFillCache(
    mongoStore(db, runtime),
    fetchHyperliquidUserFillsByTime,
    Date.now,
    runtime.inFlight,
  );
}
