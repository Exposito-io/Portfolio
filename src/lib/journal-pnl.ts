import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidFilledOrder,
  JournalTradeDirection,
  JournalTradePnlSummary,
} from "@/lib/types";

const ANNUAL_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export function calculateAnnualizedPnlPercent(
  pnlPercent: number | null,
  startTime: number,
  endTime: number,
) {
  const durationMs = endTime - startTime;

  if (
    pnlPercent === null ||
    !Number.isFinite(pnlPercent) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }

  return pnlPercent * (ANNUAL_DURATION_MS / durationMs);
}

export function calculateJournalTradeEntryPrice(
  orders: HyperliquidFilledOrder[],
  direction: JournalTradeDirection | null,
) {
  return calculateJournalTradeOrderPrice(orders, direction, "open");
}

export function calculateJournalTradeClosingPrice(
  orders: HyperliquidFilledOrder[],
  direction: JournalTradeDirection | null,
) {
  return calculateJournalTradeOrderPrice(orders, direction, "close");
}

function calculateJournalTradeOrderPrice(
  orders: HyperliquidFilledOrder[],
  direction: JournalTradeDirection | null,
  orderKind: "open" | "close",
) {
  const expectedDirection = direction ? `${orderKind} ${direction}` : `${orderKind} `;
  const matchingOrders = orders.filter((order) =>
    order.direction
      .split(",")
      .some((orderDirection) =>
        orderDirection.trim().toLocaleLowerCase().startsWith(expectedDirection),
      ),
  );
  const pricedOrders = matchingOrders.length
    ? matchingOrders
    : direction
      ? orders.filter(
          (order) =>
            order.side ===
            (direction === "long"
              ? orderKind === "open"
                ? "Buy"
                : "Sell"
              : orderKind === "open"
                ? "Sell"
                : "Buy"),
        )
      : [];

  let weightedPrice = 0;
  let totalSize = 0;

  for (const order of pricedOrders) {
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
  closingPriceUsd: number | null = null,
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
    closingPriceUsd,
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
