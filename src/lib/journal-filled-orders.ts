import type { Db } from "mongodb";

import { listAccounts } from "@/lib/accounts";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getZonedJournalDateMs } from "@/lib/date";
import {
  fetchHyperliquidOpenPositionSummary,
  getHyperliquidCoinAliases,
} from "@/lib/hyperliquid";
import { getHyperliquidFillCache } from "@/lib/hyperliquid-fill-cache";
import { getHyperliquidSnapshotTime } from "@/lib/hyperliquid-info";
import {
  calculateJournalTradeClosingPrice,
  calculateJournalTradeEntryPrice,
  calculateJournalTradePnlSummary,
} from "@/lib/journal-pnl";
import type {
  HyperliquidFilledOrder,
  JournalTrade,
  JournalTradePnlSummary,
  SourceError,
} from "@/lib/types";

export type JournalFilledOrdersResult = {
  orders: HyperliquidFilledOrder[];
  summary: JournalTradePnlSummary;
  sourceErrors: SourceError[];
  netFundingUsd: number | null;
  accountsCount: number;
  startTime: number;
  endTime: number;
  timezone: string;
};

export async function getJournalTradeFilledOrders(
  db: Db,
  trade: JournalTrade,
): Promise<JournalFilledOrdersResult> {
  if (trade.kind === "idea") {
    throw new Error("Trade ideas do not have filled orders or PnL.");
  }
  const accounts = (await listAccounts(db, true)).filter(
    (account) => account.source === "hyperliquid",
  );
  const startTime = getZonedJournalDateMs(trade.startDate, PORTFOLIO_TIMEZONE, "start");
  const endTime = trade.endDate
    ? getZonedJournalDateMs(trade.endDate, PORTFOLIO_TIMEZONE, "end")
    : getHyperliquidSnapshotTime();
  const coinAliases = getHyperliquidCoinAliases(trade.asset);
  const orders: HyperliquidFilledOrder[] = [];
  const sourceErrors: SourceError[] = [];
  let unrealizedPnlUsd: number | null = null;
  let netFundingUsd: number | null = null;
  let entryPriceWeightedSize = 0;
  let positionSize = 0;
  let positionValueUsd = 0;
  let positionCostBasisUsd = 0;

  for (const account of accounts) {
    try {
      orders.push(...(await getHyperliquidFillCache(db).getOrders({
        account, startTime, endTime, coinAliases,
      })));
    } catch (error) {
      sourceErrors.push({
        source: account.source, accountId: account.id, accountLabel: account.label,
        message: error instanceof Error ? error.message : "Unable to load orders.",
      });
    }
    if (!trade.endDate) {
      try {
        const openPosition = await fetchHyperliquidOpenPositionSummary({ account, asset: trade.asset, coinAliases });
        if (openPosition) {
          unrealizedPnlUsd = (unrealizedPnlUsd ?? 0) + openPosition.unrealizedPnlUsd;
          if (openPosition.netFundingUsd !== null) netFundingUsd = (netFundingUsd ?? 0) + openPosition.netFundingUsd;
          if (openPosition.entryPriceUsd !== null) {
            entryPriceWeightedSize += openPosition.entryPriceUsd * openPosition.positionSize;
            positionSize += openPosition.positionSize;
          }
          positionValueUsd += openPosition.positionValueUsd;
          positionCostBasisUsd += openPosition.positionCostBasisUsd;
        }
      } catch (error) {
        sourceErrors.push({
          source: account.source, accountId: account.id, accountLabel: account.label,
          message: error instanceof Error ? error.message : "Unable to load open position PnL.",
        });
      }
    }
  }

  return {
    orders: orders.sort((left, right) => right.lastTime - left.lastTime),
    summary: calculateJournalTradePnlSummary(
      orders, unrealizedPnlUsd, positionValueUsd, trade.endDate !== null,
      positionSize > 0 ? entryPriceWeightedSize / positionSize : calculateJournalTradeEntryPrice(orders, trade.direction),
      positionSize > 0 ? null : calculateJournalTradeClosingPrice(orders, trade.direction),
      positionCostBasisUsd,
    ),
    sourceErrors,
    netFundingUsd,
    accountsCount: accounts.length,
    startTime,
    endTime,
    timezone: PORTFOLIO_TIMEZONE,
  };
}
