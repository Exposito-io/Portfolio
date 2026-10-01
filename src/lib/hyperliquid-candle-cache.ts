import { randomUUID } from "node:crypto";

import type { Collection, Db, MongoClient } from "mongodb";

import {
  fetchHyperliquidCandlesByTime,
  type HyperliquidCandleInterval,
} from "@/lib/hyperliquid";
import type { HyperliquidCandle } from "@/lib/types";

const CANDLES_COLLECTION = "hyperliquid_candles_v1";
const COVERAGE_COLLECTION = "hyperliquid_candle_coverage_v1";
const LEASES_COLLECTION = "hyperliquid_candle_refresh_leases_v1";
const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 120 * DAY_MS;
const LIVE_REFRESH_MS = 60_000;
const LEASE_MS = 30_000;
const LEASE_WAIT_MS = 5_000;
const LEASE_POLL_MS = 100;

type CandleDocument = {
  _id: string;
  schemaVersion: 1;
  coin: string;
  interval: HyperliquidCandleInterval;
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  updatedAt: Date;
  expiresAt: Date;
};

type CoverageDocument = {
  _id: string;
  schemaVersion: 1;
  coin: string;
  interval: HyperliquidCandleInterval;
  coveredFrom: Date;
  coveredThrough: Date;
  refreshedAt: Date;
  expiresAt: Date;
};

type LeaseDocument = {
  _id: string;
  owner: string;
  expiresAt: Date;
};

type CandleRange = { startTime: number; endTime: number };

export interface HyperliquidCandleStore {
  ensureIndexes(): Promise<void>;
  getCoverage(key: string): Promise<CoverageDocument | null>;
  readCandles(
    coin: string,
    interval: HyperliquidCandleInterval,
    start: Date,
    end: Date,
  ): Promise<CandleDocument[]>;
  saveCandles(candles: CandleDocument[]): Promise<void>;
  saveCoverage(document: CoverageDocument): Promise<void>;
  acquireLease(key: string, owner: string, now: Date, expiresAt: Date): Promise<boolean>;
  releaseLease(key: string, owner: string): Promise<void>;
}

export class HyperliquidCandleCache {
  constructor(
    private store: HyperliquidCandleStore,
    private fetchCandles = fetchHyperliquidCandlesByTime,
    private now = Date.now,
    private inFlight = new Map<string, Promise<void>>(),
  ) {}

  async getCandles({
    coin,
    interval,
    days,
  }: {
    coin: string;
    interval: HyperliquidCandleInterval;
    days: number;
  }): Promise<HyperliquidCandle[]> {
    await this.store.ensureIndexes();
    const now = this.now();
    const requestedStart = now - days * DAY_MS;
    const retentionStart = now - RETENTION_MS;
    const persistentStart = Math.max(requestedStart, retentionStart);
    const key = seriesKey(coin, interval);

    let uncachedHistory: HyperliquidCandle[] = [];
    if (requestedStart < persistentStart) {
      uncachedHistory = await this.fetchCandles({
        coin,
        interval,
        startTime: requestedStart,
        endTime: persistentStart - 1,
      });
    }

    try {
      await this.ensureRange(key, coin, interval, persistentStart, now);
    } catch (error) {
      const coverage = await this.store.getCoverage(key);
      const hasCompleteStaleRange =
        coverage && coverage.coveredFrom.getTime() <= persistentStart;
      if (!hasCompleteStaleRange) throw error;
      console.warn(
        `Serving stale Hyperliquid candles for ${coin} after refresh failed.`,
        error,
      );
    }
    const stored = await this.store.readCandles(
      coin,
      interval,
      new Date(persistentStart),
      new Date(now),
    );

    return mergeCandles([
      ...uncachedHistory,
      ...stored.map(serializeCandle),
    ]);
  }

  private async ensureRange(
    key: string,
    coin: string,
    interval: HyperliquidCandleInterval,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    const current = this.inFlight.get(key);
    if (current) {
      await current;
      return this.ensureRange(key, coin, interval, startTime, endTime);
    }

    const request = this.refreshRange(key, coin, interval, startTime, endTime)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    await request;
  }

  private async refreshRange(
    key: string,
    coin: string,
    interval: HyperliquidCandleInterval,
    startTime: number,
    endTime: number,
  ) {
    let coverage = await this.store.getCoverage(key);
    if (!missingRanges(coverage, interval, startTime, endTime, this.now()).length) {
      return;
    }

    const owner = randomUUID();
    const waitStarted = this.now();
    for (;;) {
      const now = this.now();
      if (
        await this.store.acquireLease(
          key,
          owner,
          new Date(now),
          new Date(now + LEASE_MS),
        )
      ) {
        break;
      }

      if (now - waitStarted >= LEASE_WAIT_MS) {
        throw new Error(`Timed out waiting for candle refresh lease for ${coin}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
      coverage = await this.store.getCoverage(key);
      if (!missingRanges(coverage, interval, startTime, endTime, this.now()).length) {
        return;
      }
    }

    try {
      coverage = await this.store.getCoverage(key);
      const ranges = missingRanges(
        coverage,
        interval,
        startTime,
        endTime,
        this.now(),
      );
      if (!ranges.length) return;

      let coveredFrom = coverage?.coveredFrom.getTime() ?? Number.POSITIVE_INFINITY;
      let coveredThrough = coverage?.coveredThrough.getTime() ?? 0;
      for (const range of ranges) {
        const candles = await this.fetchCandles({ coin, interval, ...range });
        await this.store.saveCandles(
          candles.map((candle) => toCandleDocument(coin, interval, candle, this.now())),
        );
        coveredFrom = Math.min(coveredFrom, range.startTime);
        coveredThrough = Math.max(coveredThrough, range.endTime);
      }

      const refreshedAt = new Date(this.now());
      await this.store.saveCoverage({
        _id: key,
        schemaVersion: SCHEMA_VERSION,
        coin,
        interval,
        coveredFrom: new Date(Math.max(coveredFrom, this.now() - RETENTION_MS)),
        coveredThrough: new Date(coveredThrough),
        refreshedAt,
        expiresAt: new Date(refreshedAt.getTime() + RETENTION_MS),
      });
    } finally {
      await this.store.releaseLease(key, owner);
    }
  }
}

function missingRanges(
  coverage: CoverageDocument | null,
  interval: HyperliquidCandleInterval,
  startTime: number,
  endTime: number,
  now: number,
): CandleRange[] {
  if (!coverage) return [{ startTime, endTime }];

  const intervalMs = intervalToMs(interval);
  const effectiveFrom = Math.max(
    coverage.coveredFrom.getTime(),
    now - RETENTION_MS,
  );
  const coveredThrough = coverage.coveredThrough.getTime();
  const ranges: CandleRange[] = [];

  if (startTime < effectiveFrom) {
    ranges.push({ startTime, endTime: Math.min(endTime, effectiveFrom - 1) });
  }

  const needsLiveRefresh = now - coverage.refreshedAt.getTime() >= LIVE_REFRESH_MS;
  const hasUncoveredClosedInterval = endTime - coveredThrough >= intervalMs;
  if (hasUncoveredClosedInterval || needsLiveRefresh) {
    const overlapStart = Math.max(
      startTime,
      coveredThrough - 2 * intervalMs,
    );
    ranges.push({ startTime: overlapStart, endTime });
  }

  return mergeRanges(ranges.filter((range) => range.startTime <= range.endTime));
}

function mergeRanges(ranges: CandleRange[]) {
  const sorted = [...ranges].sort((left, right) => left.startTime - right.startTime);
  const merged: CandleRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startTime > previous.endTime + 1) {
      merged.push({ ...range });
    } else {
      previous.endTime = Math.max(previous.endTime, range.endTime);
    }
  }
  return merged;
}

function intervalToMs(interval: HyperliquidCandleInterval) {
  const match = /^(\d+)(m|h|d|w|M)$/.exec(interval);
  if (!match) throw new Error(`Unsupported candle interval: ${interval}`);
  const units: Record<string, number> = {
    m: 60_000,
    h: 60 * 60_000,
    d: DAY_MS,
    w: 7 * DAY_MS,
    M: 28 * DAY_MS,
  };
  return Number(match[1]) * units[match[2]];
}

function seriesKey(coin: string, interval: HyperliquidCandleInterval) {
  return `${coin}:${interval}`;
}

function candleId(coin: string, interval: HyperliquidCandleInterval, time: number) {
  return `${coin}:${interval}:${time}`;
}

function toCandleDocument(
  coin: string,
  interval: HyperliquidCandleInterval,
  candle: HyperliquidCandle,
  updatedAtMs: number,
): CandleDocument {
  const openTime = new Date(candle.time);
  return {
    _id: candleId(coin, interval, candle.time),
    schemaVersion: SCHEMA_VERSION,
    coin,
    interval,
    openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    updatedAt: new Date(updatedAtMs),
    expiresAt: new Date(candle.time + RETENTION_MS),
  };
}

function serializeCandle(candle: CandleDocument): HyperliquidCandle {
  const time = candle.openTime.getTime();
  return {
    time,
    timeKey: candle.openTime.toISOString().slice(0, 10),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function mergeCandles(candles: HyperliquidCandle[]) {
  return Array.from(
    new Map(candles.map((candle) => [candle.time, candle])).values(),
  ).sort((left, right) => left.time - right.time);
}

type CacheRuntime = {
  index?: Promise<void>;
  inFlight: Map<string, Promise<void>>;
};

function mongoStore(db: Db, runtime: CacheRuntime): HyperliquidCandleStore {
  const candles = db.collection<CandleDocument>(CANDLES_COLLECTION);
  const coverage = db.collection<CoverageDocument>(COVERAGE_COLLECTION);
  const leases = db.collection<LeaseDocument>(LEASES_COLLECTION);

  return {
    ensureIndexes() {
      runtime.index ??= ensureIndexes(candles, coverage, leases).catch((error) => {
        runtime.index = undefined;
        throw error;
      });
      return runtime.index;
    },
    getCoverage: (key) => coverage.findOne({ _id: key }),
    readCandles: (coin, interval, start, end) =>
      candles
        .find({ coin, interval, openTime: { $gte: start, $lte: end } })
        .sort({ openTime: 1 })
        .toArray(),
    async saveCandles(documents) {
      if (!documents.length) return;
      await candles.bulkWrite(
        documents.map((document) => ({
          replaceOne: {
            filter: { _id: document._id },
            replacement: document,
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },
    async saveCoverage(document) {
      await coverage.replaceOne({ _id: document._id }, document, { upsert: true });
    },
    async acquireLease(key, owner, now, expiresAt) {
      try {
        const result = await leases.findOneAndUpdate(
          {
            _id: key,
            $or: [{ expiresAt: { $lte: now } }, { owner }],
          },
          { $set: { owner, expiresAt } },
          { upsert: true, returnDocument: "after" },
        );
        return result?.owner === owner;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },
    async releaseLease(key, owner) {
      await leases.deleteOne({ _id: key, owner });
    },
  };
}

async function ensureIndexes(
  candles: Collection<CandleDocument>,
  coverage: Collection<CoverageDocument>,
  leases: Collection<LeaseDocument>,
) {
  await Promise.all([
    candles.createIndex(
      { coin: 1, interval: 1, openTime: 1 },
      { unique: true, name: "unique_hyperliquid_candle" },
    ),
    candles.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "expire_hyperliquid_candles" },
    ),
    coverage.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "expire_hyperliquid_candle_coverage" },
    ),
    leases.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "expire_hyperliquid_candle_leases" },
    ),
  ]);
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000,
  );
}

const shared = globalThis as typeof globalThis & {
  portfolioCandleCacheState?: WeakMap<MongoClient, Map<string, CacheRuntime>>;
};
const runtimes = (shared.portfolioCandleCacheState ??= new WeakMap());

export function getHyperliquidCandleCache(db: Db) {
  let databases = runtimes.get(db.client);
  if (!databases) {
    databases = new Map();
    runtimes.set(db.client, databases);
  }
  let runtime = databases.get(db.databaseName);
  if (!runtime) {
    runtime = { inFlight: new Map() };
    databases.set(db.databaseName, runtime);
  }
  return new HyperliquidCandleCache(
    mongoStore(db, runtime),
    fetchHyperliquidCandlesByTime,
    Date.now,
    runtime.inFlight,
  );
}
