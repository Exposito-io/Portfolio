import { calculateCumulativeRealizedPnlByOrder } from "@/lib/journal-pnl";
import type { HyperliquidFilledOrder, SourceError } from "@/lib/types";

export type StatsResponse = {
  orders: HyperliquidFilledOrder[];
  orderCount: number;
  page: number;
  pageSize: number;
  points: StatsPnlPoint[];
  totalPnlUsd: number | null;
  cumulativePnlByOrderId: Record<string, number>;
  historyStartTime: number | null;
  accountsCount: number;
  sourceErrors: SourceError[];
  endTime: number;
};

export type StatsPnlPoint = { time: number; pnlUsd: number };

export function buildStatsPnl(orders: HyperliquidFilledOrder[]) {
  // Match the journal: sum reported closed PnL, booking each order at its last fill.
  const cumulativePnlByOrderId = calculateCumulativeRealizedPnlByOrder(orders);
  const chronologicalOrders = [...orders].sort(
    (a, b) =>
      a.lastTime - b.lastTime ||
      a.firstTime - b.firstTime ||
      a.id.localeCompare(b.id),
  );
  const pointsByTime = new Map<number, { time: number; pnlUsd: number }>();
  let totalPnlUsd: number | null = null;
  for (const order of chronologicalOrders) {
    if (order.closedPnl !== null || totalPnlUsd !== null) {
      totalPnlUsd = cumulativePnlByOrderId.get(order.id)!;
      pointsByTime.set(order.lastTime, {
        time: order.lastTime,
        pnlUsd: totalPnlUsd,
      });
    } else {
      cumulativePnlByOrderId.delete(order.id);
    }
  }
  return {
    cumulativePnlByOrderId,
    points: [...pointsByTime.values()],
    totalPnlUsd,
  };
}
