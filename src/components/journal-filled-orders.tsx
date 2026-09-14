"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";

import { FilledOrdersTable } from "@/components/filled-orders-table";
import { JournalPnlBadge } from "@/components/journal-pnl-badge";
import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import { calculateCumulativeRealizedPnlByOrder } from "@/lib/journal-pnl";
import { formatJournalDateTimeKey } from "@/lib/date";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
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
            {trade.asset.label} from{" "}
            {formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE)}
            {trade.endDate
              ? ` to ${formatJournalDateTimeKey(trade.endDate, PORTFOLIO_TIMEZONE)}`
              : " to now"}
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
            <p>
              Add an enabled Hyperliquid account in Settings to show orders.
            </p>
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
        <FilledOrdersTable
          orders={data.orders}
          cumulativePnlByOrderId={cumulativePnlByOrderId}
        />
      ) : null}
    </section>
  );
}
