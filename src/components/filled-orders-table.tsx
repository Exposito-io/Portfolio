import type { HyperliquidFilledOrder } from "@/lib/types";

export function FilledOrdersTable({
  orders,
  cumulativePnlByOrderId,
  showAccountAndAsset = false,
}: {
  orders: HyperliquidFilledOrder[];
  cumulativePnlByOrderId: Map<string, number>;
  showAccountAndAsset?: boolean;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Last fill</th>
            {showAccountAndAsset ? (
              <>
                <th>Account</th>
                <th>Asset</th>
              </>
            ) : null}
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
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <span className="font-medium">
                  {formatDateTime(order.lastTime)}
                </span>
                <span className="block text-xs text-[#737a76]">
                  {order.orderId ? `OID ${order.orderId}` : order.coin}
                </span>
              </td>
              {showAccountAndAsset ? (
                <>
                  <td>{order.accountLabel}</td>
                  <td>{order.coin}</td>
                </>
              ) : null}
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
              <td>{formatCurrency(order.averagePrice, 8)}</td>
              <td>{formatCurrency(order.notionalUsd)}</td>
              <td>
                {order.fee === null
                  ? "N/A"
                  : `${formatNumber(order.fee)} ${order.feeToken ?? ""}`}
              </td>
              <td
                className={
                  order.closedPnl && order.closedPnl < 0 ? "text-[#9b3d30]" : ""
                }
              >
                {order.closedPnl === null
                  ? "N/A"
                  : formatCurrency(order.closedPnl)}
              </td>
              <td
                className={getPnlClassName(
                  cumulativePnlByOrderId.get(order.id),
                )}
              >
                {cumulativePnlByOrderId.has(order.id)
                  ? formatCurrency(cumulativePnlByOrderId.get(order.id)!)
                  : "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(time: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
}

function formatCurrency(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
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
