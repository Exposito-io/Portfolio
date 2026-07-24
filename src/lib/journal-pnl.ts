import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidFilledOrder,
  JournalTradePnlSummary,
} from "@/lib/types";

export function calculateJournalTradePnlSummary(
  orders: HyperliquidFilledOrder[],
  unrealizedPnlUsd: number | null = null,
): JournalTradePnlSummary {
  const closedPnlOrders = orders.filter((order) => order.closedPnl !== null);
  const realizedPnlUsd = closedPnlOrders.length
    ? roundCurrency(
        closedPnlOrders.reduce((sum, order) => sum + (order.closedPnl ?? 0), 0),
      )
    : null;
  const pnlUsd =
    realizedPnlUsd === null && unrealizedPnlUsd === null
      ? null
      : roundCurrency((realizedPnlUsd ?? 0) + (unrealizedPnlUsd ?? 0));
  const notionalUsd = roundCurrency(
    orders.reduce((sum, order) => sum + order.notionalUsd, 0),
  );
  const pnlPercent =
    pnlUsd === null || notionalUsd === 0 || !Number.isFinite(notionalUsd)
      ? null
      : Math.round((pnlUsd / notionalUsd) * 10000) / 100;

  return {
    pnlUsd,
    pnlPercent,
    realizedPnlUsd,
    unrealizedPnlUsd,
    orderCount: orders.length,
    fillCount: orders.reduce((sum, order) => sum + order.fillCount, 0),
    notionalUsd,
  };
}
