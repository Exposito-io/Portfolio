import type { HyperliquidFilledOrder } from "@/lib/types";

export type EntryOrderTotals = {
  buyUsd: number;
  sellUsd: number;
  buyCount: number;
  sellCount: number;
  buyPositionPercent: number | null;
  sellPositionPercent: number | null;
  pnlUsd: number | null;
};

type EntryOrderTotalsAccumulator = EntryOrderTotals & {
  buySize: number;
  sellSize: number;
  maxPositionSize: number;
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
  const pnlUsd = totals?.pnlUsd ?? null;
  const showPnl =
    sellCount > 0 || (pnlUsd !== null && Math.abs(pnlUsd) > 0);

  if (!buyCount && !sellCount) {
    return null;
  }

  return (
    <div className="entry-order-totals" aria-label="Daily filled order totals">
      {buyCount ? (
        <div className="entry-order-total entry-order-total-with-percent entry-order-total-buy">
          <div>
            <span>Buy · {formatOrderCount(buyCount)}</span>
            <strong>{formatCurrency(buyUsd)}</strong>
          </div>
          <div className="entry-order-total-position-percent">
            <span>Of position</span>
            <b>{formatPositionPercent(totals?.buyPositionPercent ?? null)}</b>
          </div>
        </div>
      ) : null}
      {sellCount ? (
        <div className="entry-order-total entry-order-total-with-percent entry-order-total-sell">
          <div>
            <span>Sell · {formatOrderCount(sellCount)}</span>
            <strong>{formatCurrency(sellUsd)}</strong>
          </div>
          <div className="entry-order-total-position-percent">
            <span>Of position</span>
            <b>{formatPositionPercent(totals?.sellPositionPercent ?? null)}</b>
          </div>
        </div>
      ) : null}
      {showPnl ? (
        <div
          className={`entry-order-total entry-order-total-pnl ${getPnlClassName(pnlUsd)}`}
        >
          <span>Transactions PnL</span>
          <strong>
            {pnlUsd === null ? "N/A" : formatSignedCurrency(pnlUsd)}
          </strong>
        </div>
      ) : null}
    </div>
  );
}

export function groupOrdersByDate(
  orders: HyperliquidFilledOrder[],
  timezone: string,
) {
  const totalsByDate = new Map<string, EntryOrderTotalsAccumulator>();
  let positionSize = 0;

  const chronologicalOrders = [...orders].sort(
    (left, right) =>
      left.lastTime - right.lastTime ||
      left.firstTime - right.firstTime ||
      left.id.localeCompare(right.id),
  );

  for (const order of chronologicalOrders) {
    if (order.side !== "Buy" && order.side !== "Sell") continue;

    const dateKey = formatDateKey(order.lastTime, timezone);
    const totals = totalsByDate.get(dateKey) ?? {
      buyUsd: 0,
      sellUsd: 0,
      buyCount: 0,
      sellCount: 0,
      buyPositionPercent: null,
      sellPositionPercent: null,
      pnlUsd: null,
      buySize: 0,
      sellSize: 0,
      maxPositionSize: Math.abs(positionSize),
    };

    if (order.side === "Buy") {
      totals.buyUsd += order.notionalUsd;
      totals.buyCount += 1;
      totals.buySize += order.totalSize;
      positionSize += order.totalSize;
    } else {
      totals.sellUsd += order.notionalUsd;
      totals.sellCount += 1;
      totals.sellSize += order.totalSize;
      positionSize -= order.totalSize;
    }

    totals.maxPositionSize = Math.max(
      totals.maxPositionSize,
      Math.abs(positionSize),
    );

    if (order.closedPnl !== null && Number.isFinite(order.closedPnl)) {
      totals.pnlUsd = (totals.pnlUsd ?? 0) + order.closedPnl;
    }

    totalsByDate.set(dateKey, totals);
  }

  for (const totals of totalsByDate.values()) {
    totals.buyUsd = roundCurrency(totals.buyUsd);
    totals.sellUsd = roundCurrency(totals.sellUsd);
    totals.buyPositionPercent = calculatePositionPercent(
      totals.buySize,
      totals.maxPositionSize,
    );
    totals.sellPositionPercent = calculatePositionPercent(
      totals.sellSize,
      totals.maxPositionSize,
    );
    totals.pnlUsd = totals.pnlUsd === null ? null : roundCurrency(totals.pnlUsd);
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

function formatSignedCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    signDisplay: "exceptZero",
    style: "currency",
  }).format(value);
}

function formatPositionPercent(value: number | null) {
  if (value === null) return "N/A";

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatOrderCount(count: number) {
  return `${count} ${count === 1 ? "order" : "orders"}`;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function calculatePositionPercent(size: number, maxPositionSize: number) {
  if (
    !Number.isFinite(size) ||
    !Number.isFinite(maxPositionSize) ||
    maxPositionSize <= 0
  ) {
    return null;
  }

  return Math.round((size / maxPositionSize) * 10_000) / 100;
}

function getPnlClassName(pnlUsd: number | null) {
  if (pnlUsd === null || pnlUsd === 0) return "";
  return pnlUsd > 0
    ? "entry-order-total-pnl-positive"
    : "entry-order-total-pnl-negative";
}
