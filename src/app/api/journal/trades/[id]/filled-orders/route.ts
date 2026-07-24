import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/accounts";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getZonedDateEndMs, getZonedDateStartMs } from "@/lib/date";
import {
  fetchHyperliquidFilledOrdersByTime,
  fetchHyperliquidOpenPositionSummary,
  getHyperliquidCoinAliases,
} from "@/lib/hyperliquid";
import { getTrade } from "@/lib/journal";
import { calculateJournalTradePnlSummary } from "@/lib/journal-pnl";
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

    const accounts = (await listAccounts(db, true)).filter(
      (account) => account.source === "hyperliquid",
    );
    const startTime = getZonedDateStartMs(trade.startDate, PORTFOLIO_TIMEZONE);
    const endTime = trade.endDate
      ? getZonedDateEndMs(trade.endDate, PORTFOLIO_TIMEZONE)
      : Date.now();
    const coinAliases = getHyperliquidCoinAliases(trade.asset);
    const orders: HyperliquidFilledOrder[] = [];
    const sourceErrors: SourceError[] = [];
    let unrealizedPnlUsd: number | null = null;
    let positionValueUsd: number | null = null;

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
            positionValueUsd =
              (positionValueUsd ?? 0) + openPosition.positionValueUsd;
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
