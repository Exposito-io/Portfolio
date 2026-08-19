import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidFilledOrder,
  JournalTradePnlSummary,
} from "@/lib/types";

export function calculateJournalTradePnlSummary(
  orders: HyperliquidFilledOrder[],
  unrealizedPnlUsd: number | null = null,
  positionValueUsd: number | null = 0,
  isFinished = unrealizedPnlUsd === null,
  entryPriceUsd: number | null = null,
): JournalTradePnlSummary {
  const closedPnlOrders = orders.filter((order) => order.closedPnl !== null);
  const realizedPnlUsd = closedPnlOrders.length
    ? roundCurrency(
        closedPnlOrders.reduce((sum, order) => sum + (order.closedPnl ?? 0), 0),
      )
    : null;
  const pnlUsd = isFinished
    ? realizedPnlUsd
    : realizedPnlUsd === null && unrealizedPnlUsd === null
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
    entryPriceUsd,
    positionValueUsd: positionValueUsd ?? 0,
    orderCount: orders.length,
    fillCount: orders.reduce((sum, order) => sum + order.fillCount, 0),
    notionalUsd,
  };
}

export function calculateCumulativeRealizedPnlByOrder(
  orders: HyperliquidFilledOrder[],
) {
  const cumulativePnlByOrderId = new Map<string, number>();
  let cumulativePnlUsd = 0;

  const chronologicalOrders = [...orders].sort(
    (left, right) =>
      left.lastTime - right.lastTime ||
      left.firstTime - right.firstTime ||
      left.id.localeCompare(right.id),
  );

  for (const order of chronologicalOrders) {
    cumulativePnlUsd += order.closedPnl ?? 0;
    cumulativePnlByOrderId.set(order.id, roundCurrency(cumulativePnlUsd));
  }

  return cumulativePnlByOrderId;
}
