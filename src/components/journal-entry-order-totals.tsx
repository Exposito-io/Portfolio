import type { HyperliquidFilledOrder } from "@/lib/types";

export type EntryOrderTotals = {
  buyUsd: number;
  sellUsd: number;
  buyCount: number;
  sellCount: number;
};

export function EntryOrderTotalsView({
  loading,
  totals,
}: {
  loading: boolean;
  totals?: EntryOrderTotals;
}) {
  if (loading) {
    return <div className="entry-order-totals-loading">Loading daily fills</div>;
  }

  const buyUsd = totals?.buyUsd ?? 0;
  const sellUsd = totals?.sellUsd ?? 0;
  const buyCount = totals?.buyCount ?? 0;
  const sellCount = totals?.sellCount ?? 0;

  if (!buyCount && !sellCount) {
    return null;
  }

  return (
    <div className="entry-order-totals" aria-label="Daily filled order totals">
      {buyCount ? (
        <div className="entry-order-total entry-order-total-buy">
          <span>Buy · {formatOrderCount(buyCount)}</span>
          <strong>{formatCurrency(buyUsd)}</strong>
        </div>
      ) : null}
      {sellCount ? (
        <div className="entry-order-total entry-order-total-sell">
          <span>Sell · {formatOrderCount(sellCount)}</span>
          <strong>{formatCurrency(sellUsd)}</strong>
        </div>
      ) : null}
    </div>
  );
}

export function groupOrdersByDate(
  orders: HyperliquidFilledOrder[],
  timezone: string,
) {
  const totalsByDate = new Map<string, EntryOrderTotals>();

  for (const order of orders) {
    const dateKey = formatDateKey(order.lastTime, timezone);
    const totals = totalsByDate.get(dateKey) ?? {
      buyUsd: 0,
      sellUsd: 0,
      buyCount: 0,
      sellCount: 0,
    };

    if (order.side === "Buy") {
      totals.buyUsd += order.notionalUsd;
      totals.buyCount += 1;
    } else if (order.side === "Sell") {
      totals.sellUsd += order.notionalUsd;
      totals.sellCount += 1;
    }

    totalsByDate.set(dateKey, totals);
  }

  for (const totals of totalsByDate.values()) {
    totals.buyUsd = roundCurrency(totals.buyUsd);
    totals.sellUsd = roundCurrency(totals.sellUsd);
  }

  return totalsByDate;
}

function formatDateKey(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatOrderCount(count: number) {
  return `${count} ${count === 1 ? "order" : "orders"}`;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
