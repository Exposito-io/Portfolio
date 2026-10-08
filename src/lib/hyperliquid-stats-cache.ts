import { createHash } from "node:crypto";

import type { Collection, Db, Document } from "mongodb";

import { roundCurrency } from "@/lib/portfolio-calculations";
import type { StatsPnlPoint } from "@/lib/stats";
import type { HyperliquidFilledOrder, PortfolioAccount } from "@/lib/types";

type SyncState = { _id: string; syncedThrough: Date; refreshedAt: Date };

type StoredStatsSummary = {
  _id: string;
  calculationVersion: number;
  sourceVersions: Array<{ wallet: string; syncedThrough: Date }>;
  points: Array<{ time: Date; pnlUsd: number }>;
  totalPnlUsd: number | null;
  orderCount: number;
  historyStartTime: Date | null;
  refreshedAt: Date;
};

export type StatsHistoryQuery = {
  accounts: PortfolioAccount[];
  page: number;
  pageSize: number;
  includeOrders: boolean;
};

export type StatsHistoryResult = {
  orders: HyperliquidFilledOrder[];
  orderCount: number;
  points: StatsPnlPoint[];
  totalPnlUsd: number | null;
  cumulativePnlByOrderId: Record<string, number>;
  historyStartTime: number | null;
};

type SummaryAggregate = {
  metadata?: Array<{ orderCount: number; historyStartTime: Date | null }>;
  points?: Array<{ time: Date; pnlUsd: number }>;
};

type AggregateOrder = {
  wallet: string;
  orderKey: string;
  coin: string;
  side: HyperliquidFilledOrder["side"];
  directions: string[];
  totalSize: number;
  averagePrice: number;
  notionalUsd: number;
  fee: number | null;
  feeTokens: string[];
  closedPnl: number | null;
  realizedPnlBasisUsd: number | null;
  firstTime: Date;
  lastTime: Date;
  orderId: number | null;
  fillCount: number;
  cumulativePnlUsd: number;
  pnlCount: number;
};

const CALCULATION_VERSION = 2;

export class HyperliquidStatsCache {
  private fills: Collection<Document>;
  private syncs: Collection<SyncState>;
  private summaries: Collection<StoredStatsSummary>;
  private summaryRefreshes = new Map<string, Promise<StoredStatsSummary>>();

  constructor(private db: Db) {
    this.fills = db.collection("hyperliquid_fills_v1");
    this.syncs = db.collection<SyncState>("hyperliquid_fill_syncs_v1");
    this.summaries = db.collection<StoredStatsSummary>("hyperliquid_stats_v1");
  }

  async getStats({
    accounts,
    page,
    pageSize,
    includeOrders,
  }: StatsHistoryQuery): Promise<StatsHistoryResult> {
    if (!accounts.length) return emptyStats();

    const accountByWallet = new Map(
      accounts.map((account) => [account.address.toLowerCase(), account]),
    );
    const sourceVersions = await this.getSourceVersions([
      ...accountByWallet.keys(),
    ]);
    const summary = await this.getSummary(sourceVersions);
    const aggregateOrders = includeOrders
      ? await this.getOrderPage(sourceVersions, page, pageSize)
      : [];
    const cumulativePnlByOrderId: Record<string, number> = {};
    const orders = aggregateOrders.map((order) => {
      const account = accountByWallet.get(order.wallet)!;
      const id = `${account.id}:${order.orderKey}:${order.coin}:${order.side}`;
      if (order.pnlCount > 0) {
        cumulativePnlByOrderId[id] = roundCurrency(order.cumulativePnlUsd);
      }
      return toFilledOrder(order, account, id);
    });

    return {
      orders,
      orderCount: summary.orderCount,
      points: summary.points.map((point) => ({
        time: point.time.getTime(),
        pnlUsd: point.pnlUsd,
      })),
      totalPnlUsd: summary.totalPnlUsd,
      cumulativePnlByOrderId,
      historyStartTime: summary.historyStartTime?.getTime() ?? null,
    };
  }

  private async getSourceVersions(wallets: string[]) {
    const states = await this.syncs
      .find({ _id: { $in: wallets } })
      .project<SyncState>({ _id: 1, syncedThrough: 1, refreshedAt: 1 })
      .toArray();
    const byWallet = new Map(states.map((state) => [state._id, state]));
    return wallets
      .sort()
      .map((wallet) => ({
        wallet,
        syncedThrough: byWallet.get(wallet)?.syncedThrough ?? new Date(0),
      }));
  }

  private async getSummary(
    sourceVersions: StoredStatsSummary["sourceVersions"],
  ): Promise<StoredStatsSummary> {
    const key = summaryKey(sourceVersions.map((version) => version.wallet));
    const cached = await this.summaries.findOne({ _id: key });
    if (
      cached?.calculationVersion === CALCULATION_VERSION &&
      sameVersions(cached.sourceVersions, sourceVersions)
    )
      return cached;

    const inFlightKey = `${this.db.databaseName}:${key}:${versionKey(sourceVersions)}`;
    const pending = this.summaryRefreshes.get(inFlightKey);
    if (pending) return pending;

    const refresh = this.buildSummary(key, sourceVersions).finally(() => {
      this.summaryRefreshes.delete(inFlightKey);
    });
    this.summaryRefreshes.set(inFlightKey, refresh);
    return refresh;
  }

  private async buildSummary(
    key: string,
    sourceVersions: StoredStatsSummary["sourceVersions"],
  ): Promise<StoredStatsSummary> {
    const [aggregate = {}] = await this.fills
      .aggregate<SummaryAggregate>(
        [
          matchSourceVersions(sourceVersions),
          ...groupOrders(),
          {
            $facet: {
              metadata: [
                {
                  $group: {
                    _id: null,
                    orderCount: { $sum: 1 },
                    historyStartTime: { $min: "$firstTime" },
                  },
                },
                { $project: { _id: 0, orderCount: 1, historyStartTime: 1 } },
              ],
              points: [
                ...addCumulativePnl(),
                { $match: { pnlCount: { $gt: 0 } } },
                {
                  $group: {
                    _id: "$lastTime",
                    pnlUsd: { $last: "$cumulativePnlUsd" },
                  },
                },
                { $sort: { _id: 1 } },
                {
                  $project: {
                    _id: 0,
                    time: "$_id",
                    pnlUsd: { $toDouble: { $round: ["$pnlUsd", 2] } },
                  },
                },
              ],
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();
    const metadata = aggregate.metadata?.[0];
    const points = aggregate.points ?? [];
    const summary: StoredStatsSummary = {
      _id: key,
      calculationVersion: CALCULATION_VERSION,
      sourceVersions,
      points,
      totalPnlUsd: points.length ? points[points.length - 1].pnlUsd : null,
      orderCount: metadata?.orderCount ?? 0,
      historyStartTime: metadata?.historyStartTime ?? null,
      refreshedAt: new Date(),
    };
    await this.summaries.replaceOne({ _id: key }, summary, { upsert: true });
    return summary;
  }

  private async getOrderPage(
    sourceVersions: StoredStatsSummary["sourceVersions"],
    page: number,
    pageSize: number,
  ) {
    return this.fills
      .aggregate<AggregateOrder>(
        [
          matchSourceVersions(sourceVersions),
          ...groupOrders(),
          ...addCumulativePnl(),
          { $sort: { lastTime: -1, firstTime: -1, sortId: -1 } },
          { $skip: page * pageSize },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              wallet: "$_id.wallet",
              orderKey: "$_id.orderKey",
              coin: "$_id.coin",
              side: "$_id.side",
              directions: 1,
              totalSize: 1,
              averagePrice: 1,
              notionalUsd: 1,
              fee: 1,
              feeTokens: 1,
              closedPnl: 1,
              realizedPnlBasisUsd: 1,
              firstTime: 1,
              lastTime: 1,
              orderId: 1,
              fillCount: 1,
              cumulativePnlUsd: { $toDouble: "$cumulativePnlUsd" },
              pnlCount: 1,
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();
  }
}

function matchSourceVersions(
  sourceVersions: StoredStatsSummary["sourceVersions"],
): Document {
  return {
    $match: {
      $or: sourceVersions.map(({ wallet, syncedThrough }) => ({
        wallet,
        time: { $gte: new Date(0), $lte: syncedThrough },
      })),
    },
  };
}

function groupOrders(): Document[] {
  return [
    {
      $group: {
        _id: {
          wallet: "$wallet",
          orderKey: {
            $cond: [
              { $ne: ["$orderId", null] },
              { $toString: "$orderId" },
              "$fillId",
            ],
          },
          coin: "$coin",
          side: "$side",
        },
        directions: { $addToSet: "$direction" },
        totalSize: { $sum: "$size" },
        notionalUsdSum: {
          $sum: {
            $multiply: [{ $toDecimal: "$price" }, { $toDecimal: "$size" }],
          },
        },
        feeSum: { $sum: { $toDecimal: { $ifNull: ["$fee", 0] } } },
        feeCount: { $sum: { $cond: [{ $ne: ["$fee", null] }, 1, 0] } },
        feeTokens: { $addToSet: "$feeToken" },
        closedPnlSum: {
          $sum: { $toDecimal: { $ifNull: ["$closedPnl", 0] } },
        },
        closedPnlCount: {
          $sum: { $cond: [{ $ne: ["$closedPnl", null] }, 1, 0] },
        },
        realizedPnlBasisUsdSum: {
          $sum: {
            $toDecimal: { $ifNull: ["$realizedPnlBasisUsd", 0] },
          },
        },
        realizedPnlBasisUsdCount: {
          $sum: {
            $cond: [{ $ne: ["$realizedPnlBasisUsd", null] }, 1, 0],
          },
        },
        firstTime: { $min: "$time" },
        lastTime: { $max: "$time" },
        orderId: { $first: "$orderId" },
        fillCount: { $sum: 1 },
      },
    },
    {
      $set: {
        sortId: {
          $concat: [
            "$_id.wallet",
            ":",
            "$_id.orderKey",
            ":",
            "$_id.coin",
            ":",
            "$_id.side",
          ],
        },
        notionalUsd: {
          $toDouble: { $round: ["$notionalUsdSum", 2] },
        },
        averagePrice: {
          $cond: [
            { $eq: ["$totalSize", 0] },
            0,
            {
              $toDouble: {
                $divide: ["$notionalUsdSum", { $toDecimal: "$totalSize" }],
              },
            },
          ],
        },
        fee: {
          $cond: [
            { $gt: ["$feeCount", 0] },
            { $toDouble: { $round: ["$feeSum", 2] } },
            null,
          ],
        },
        closedPnlDecimal: {
          $cond: [
            { $gt: ["$closedPnlCount", 0] },
            { $round: ["$closedPnlSum", 2] },
            { $toDecimal: 0 },
          ],
        },
        closedPnl: {
          $cond: [
            { $gt: ["$closedPnlCount", 0] },
            { $toDouble: { $round: ["$closedPnlSum", 2] } },
            null,
          ],
        },
        realizedPnlBasisUsd: {
          $cond: [
            { $gt: ["$realizedPnlBasisUsdCount", 0] },
            { $toDouble: { $round: ["$realizedPnlBasisUsdSum", 2] } },
            null,
          ],
        },
      },
    },
  ];
}

function addCumulativePnl(): Document[] {
  return [
    {
      $setWindowFields: {
        sortBy: { lastTime: 1, firstTime: 1, sortId: 1 },
        output: {
          cumulativePnlUsd: {
            $sum: "$closedPnlDecimal",
            window: { documents: ["unbounded", "current"] },
          },
          pnlCount: {
            $sum: { $cond: [{ $ne: ["$closedPnl", null] }, 1, 0] },
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
  ];
}

function toFilledOrder(
  order: AggregateOrder,
  account: PortfolioAccount,
  id: string,
): HyperliquidFilledOrder {
  const feeTokens = order.feeTokens.filter(
    (token): token is string => typeof token === "string" && token.length > 0,
  );
  return {
    id,
    accountId: account.id,
    accountLabel: account.label,
    coin: order.coin,
    side: order.side,
    direction: order.directions.filter(Boolean).join(", "),
    averagePrice: order.averagePrice,
    totalSize: order.totalSize,
    notionalUsd: roundCurrency(order.notionalUsd),
    fee: order.fee === null ? null : roundCurrency(order.fee),
    feeToken: feeTokens.length === 1 ? feeTokens[0] : "Multiple",
    closedPnl: order.closedPnl === null ? null : roundCurrency(order.closedPnl),
    realizedPnlBasisUsd:
      order.realizedPnlBasisUsd === null
        ? null
        : roundCurrency(order.realizedPnlBasisUsd),
    firstTime: order.firstTime.getTime(),
    lastTime: order.lastTime.getTime(),
    orderId: order.orderId,
    fillCount: order.fillCount,
  };
}

function summaryKey(wallets: string[]) {
  return createHash("sha256").update([...wallets].sort().join("\n")).digest("hex");
}

function versionKey(versions: StoredStatsSummary["sourceVersions"]) {
  return versions
    .map(({ wallet, syncedThrough }) => `${wallet}:${syncedThrough.getTime()}`)
    .join("|");
}

function sameVersions(
  left: StoredStatsSummary["sourceVersions"],
  right: StoredStatsSummary["sourceVersions"],
) {
  return versionKey(left) === versionKey(right);
}

function emptyStats(): StatsHistoryResult {
  return {
    orders: [],
    orderCount: 0,
    points: [],
    totalPnlUsd: null,
    cumulativePnlByOrderId: {},
    historyStartTime: null,
  };
}

const statsCaches = new WeakMap<Db["client"], Map<string, HyperliquidStatsCache>>();

export function getHyperliquidStatsCache(db: Db) {
  let databases = statsCaches.get(db.client);
  if (!databases) {
    databases = new Map();
    statsCaches.set(db.client, databases);
  }
  let cache = databases.get(db.databaseName);
  if (!cache) {
    cache = new HyperliquidStatsCache(db);
    databases.set(db.databaseName, cache);
  }
  return cache;
}
