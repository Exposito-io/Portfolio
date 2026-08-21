import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/accounts";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getZonedJournalDateMs } from "@/lib/date";
import {
  fetchHyperliquidFilledOrdersByTime,
  fetchHyperliquidOpenPositionSummary,
  getHyperliquidCoinAliases,
} from "@/lib/hyperliquid";
import { getTrade } from "@/lib/journal";
import {
  calculateJournalTradeClosingPrice,
  calculateJournalTradeEntryPrice,
  calculateJournalTradePnlSummary,
} from "@/lib/journal-pnl";
import { getDb } from "@/lib/mongodb";
import type { HyperliquidFilledOrder, SourceError } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const trade = await getTrade(db, id);

    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    if (trade.kind === "idea") {
      return NextResponse.json(
        { error: "Trade ideas do not have filled orders or PnL." },
        { status: 400 },
      );
    }

    const accounts = (await listAccounts(db, true)).filter(
      (account) => account.source === "hyperliquid",
    );
    const startTime = getZonedJournalDateMs(
      trade.startDate,
      PORTFOLIO_TIMEZONE,
      "start",
    );
    const endTime = trade.endDate
      ? getZonedJournalDateMs(trade.endDate, PORTFOLIO_TIMEZONE, "end")
      : Date.now();
    const coinAliases = getHyperliquidCoinAliases(trade.asset);
    const orders: HyperliquidFilledOrder[] = [];
    const sourceErrors: SourceError[] = [];
    let unrealizedPnlUsd: number | null = null;
    let entryPriceWeightedSize = 0;
    let positionSize = 0;
    let positionValueUsd = 0;

    for (const account of accounts) {
      try {
        orders.push(
          ...(await fetchHyperliquidFilledOrdersByTime({
            account,
            startTime,
            endTime,
            coinAliases,
          })),
        );
      } catch (error) {
        sourceErrors.push({
          source: account.source,
          accountId: account.id,
          accountLabel: account.label,
          message:
            error instanceof Error ? error.message : "Unable to load orders.",
        });
      }

      if (!trade.endDate) {
        try {
          const openPosition = await fetchHyperliquidOpenPositionSummary({
            account,
            asset: trade.asset,
            coinAliases,
          });
          if (openPosition) {
            unrealizedPnlUsd =
              (unrealizedPnlUsd ?? 0) + openPosition.unrealizedPnlUsd;
            if (openPosition.entryPriceUsd !== null) {
              entryPriceWeightedSize +=
                openPosition.entryPriceUsd * openPosition.positionSize;
              positionSize += openPosition.positionSize;
            }
            positionValueUsd += openPosition.positionValueUsd;
          }
        } catch (error) {
          sourceErrors.push({
            source: account.source,
            accountId: account.id,
            accountLabel: account.label,
            message:
              error instanceof Error
                ? error.message
                : "Unable to load open position PnL.",
          });
        }
      }
    }

    return NextResponse.json({
      orders: orders.sort((a, b) => b.lastTime - a.lastTime),
      summary: calculateJournalTradePnlSummary(
        orders,
        unrealizedPnlUsd,
        positionValueUsd,
        trade.endDate !== null,
        positionSize > 0
          ? entryPriceWeightedSize / positionSize
          : calculateJournalTradeEntryPrice(orders, trade.direction),
        positionSize > 0
          ? null
          : calculateJournalTradeClosingPrice(orders, trade.direction),
      ),
      sourceErrors,
      accountsCount: accounts.length,
      startTime,
      endTime,
      timezone: PORTFOLIO_TIMEZONE,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
