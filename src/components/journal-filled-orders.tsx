"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";

import { JournalPnlBadge } from "@/components/journal-pnl-badge";
import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import { calculateCumulativeRealizedPnlByOrder } from "@/lib/journal-pnl";
import type { JournalTrade } from "@/lib/types";

export function JournalFilledOrders({
  trade,
  ordersState,
}: {
  trade: JournalTrade;
  ordersState: FilledOrdersState;
}) {
  const { data, error, loading } = ordersState;
  const cumulativePnlByOrderId = useMemo(
    () => calculateCumulativeRealizedPnlByOrder(data?.orders ?? []),
    [data?.orders],
  );

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="panel-heading">
          <h2>Filled orders</h2>
          <p>
            {trade.asset.label} from {trade.startDate}
            {trade.endDate ? ` to ${trade.endDate}` : " to now"}
          </p>
        </div>
        {loading ? (
          <RefreshCw className="animate-spin text-[#1f7a68]" size={20} />
        ) : (
          <JournalPnlBadge error={error} summary={data?.summary} />
        )}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {data?.sourceErrors.length ? (
        <div className="mt-3 grid gap-2">
          {data.sourceErrors.map((sourceError) => (
            <div
              className="alert alert-warning"
              key={`${sourceError.accountId}:${sourceError.message}`}
            >
              {sourceError.accountLabel}: {sourceError.message}
            </div>
          ))}
        </div>
      ) : null}

      {!loading && data && data.accountsCount === 0 ? (
        <div className="empty-state">
          <div>
            <h2>No Hyperliquid accounts configured</h2>
            <p>Add an enabled Hyperliquid account in Settings to show orders.</p>
          </div>
        </div>
      ) : null}

      {!loading && data && data.accountsCount > 0 && !data.orders.length ? (
        <div className="empty-state">
          <div>
            <h2>No filled orders</h2>
            <p>No filled orders matched this asset and date range.</p>
          </div>
        </div>
      ) : null}

      {data?.orders.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Last fill</th>
                <th>Side</th>
                <th>Direction</th>
                <th>Total size</th>
                <th>Avg price</th>
                <th>Notional</th>
                <th>Fee</th>
                <th>Closed PnL</th>
                <th>Total PnL</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="font-medium">
                      {formatDateTime(order.lastTime)}
                    </span>
                    <span className="block text-xs text-[#737a76]">
                      {order.orderId ? `OID ${order.orderId}` : order.coin}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        order.side === "Buy"
                          ? "tag tag-green"
                          : order.side === "Sell"
                            ? "tag tag-red"
                            : "tag"
                      }
                    >
                      {order.side}
                    </span>
                  </td>
                  <td>{order.direction || "N/A"}</td>
                  <td>{formatNumber(order.totalSize)}</td>
                  <td>{formatCurrency(order.averagePrice)}</td>
                  <td>{formatCurrency(order.notionalUsd)}</td>
                  <td>
                    {order.fee === null
                      ? "N/A"
                      : `${formatNumber(order.fee)} ${order.feeToken ?? ""}`}
                  </td>
                  <td
                    className={
                      order.closedPnl && order.closedPnl < 0
                        ? "text-[#9b3d30]"
                        : ""
                    }
                  >
                    {order.closedPnl === null
                      ? "N/A"
                      : formatCurrency(order.closedPnl)}
                  </td>
                  <td className={getPnlClassName(cumulativePnlByOrderId.get(order.id))}>
                    {formatCurrency(cumulativePnlByOrderId.get(order.id) ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function formatDateTime(time: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8,
  }).format(value);
}

function getPnlClassName(value: number | undefined) {
  if (value === undefined || value === 0) return "";
  return value > 0 ? "text-[#1f7a68]" : "text-[#9b3d30]";
}
