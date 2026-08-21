import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidFilledOrder,
  JournalTradeDirection,
  JournalTradePnlSummary,
} from "@/lib/types";

export function calculateJournalTradeEntryPrice(
  orders: HyperliquidFilledOrder[],
  direction: JournalTradeDirection | null,
) {
  const openingDirection = direction ? `open ${direction}` : "open ";
  const openingOrders = orders.filter((order) =>
    order.direction
      .split(",")
      .some((orderDirection) =>
        orderDirection.trim().toLocaleLowerCase().startsWith(openingDirection),
      ),
  );
  const entryOrders = openingOrders.length
    ? openingOrders
    : direction
      ? orders.filter(
          (order) => order.side === (direction === "long" ? "Buy" : "Sell"),
        )
      : [];

  let weightedPrice = 0;
  let totalSize = 0;

  for (const order of entryOrders) {
    if (
      !Number.isFinite(order.averagePrice) ||
      !Number.isFinite(order.totalSize) ||
      order.totalSize <= 0
    ) {
      continue;
    }

    weightedPrice += order.averagePrice * order.totalSize;
    totalSize += order.totalSize;
  }

  return totalSize > 0 ? weightedPrice / totalSize : null;
}

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
