"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FilledOrdersTable } from "@/components/filled-orders-table";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { buildStatsPnl, type StatsResponse } from "@/lib/stats";

const StatsPnlChart = dynamic(
  () =>
    import("@/components/stats-pnl-chart").then(
      (module) => module.StatsPnlChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center" role="status">
        Loading chart…
      </div>
    ),
  },
);
const PAGE_SIZE = 50;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function StatsPanel() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/stats", {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Unable to load stats.");
        if (!controller.signal.aborted) {
          setData(payload);
          setPage(0);
        }
      } catch (loadError) {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load stats.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshNonce]);

  const { points, totalPnlUsd, cumulativePnlByOrderId } = useMemo(
    () => buildStatsPnl(data?.orders ?? []),
    [data?.orders],
  );
  const orderCount = data?.orders.length ?? 0;
  const allFailed = Boolean(
    data?.accountsCount && data.sourceErrors.length === data.accountsCount,
  );

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Stats</h1>
          <p className="mt-1 text-sm text-[#69706c]">
            Hyperliquid transactions across all enabled wallets and markets.
          </p>
        </div>
        <button
          className="button-secondary disabled:opacity-60"
          disabled={loading}
          onClick={() => setRefreshNonce((value) => value + 1)}
          type="button"
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : ""}
            aria-hidden="true"
          />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-[#69706c]">
          Loading Hyperliquid history…
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="alert alert-error">
          {error}
          {data ? " Showing the previous results." : ""}
        </div>
      ) : null}
      {data?.sourceErrors.length ? (
        <div className="alert alert-warning" role="alert">
          <p className="font-semibold">
            {allFailed
              ? "Unable to load transaction history."
              : "Partial results — some wallets could not be loaded."}
          </p>
          {data.sourceErrors.map((sourceError) => (
            <p key={sourceError.accountId}>
              {sourceError.accountLabel}: {sourceError.message}
            </p>
          ))}
        </div>
      ) : null}

      <section className="panel min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="panel-heading">
            <h2>Cumulative realized P/L</h2>
            <p>
              Reported closed P/L in USD, before fees. Excludes funding and
              unrealized P/L.
            </p>
          </div>
          <div className="text-right">
            <p
              className={`text-2xl font-semibold ${totalPnlUsd !== null && totalPnlUsd < 0 ? "text-[#9b3d30]" : "text-[#1f7a68]"}`}
            >
              {totalPnlUsd === null
                ? "N/A"
                : currencyFormatter.format(totalPnlUsd)}
            </p>
          </div>
        </div>
        {points.length ? (
          <StatsPnlChart points={points} />
        ) : (
          <div className="flex h-72 items-center justify-center text-center text-sm text-[#69706c]">
            {loading
              ? "Loading realized P/L…"
              : "No reported realized P/L to chart."}
          </div>
        )}
        <p className="mt-3 text-xs text-[#69706c]">
          Orders are booked at their last fill, matching the journal.
          Unavailable P/L is excluded. Chart times use {PORTFOLIO_TIMEZONE}.
        </p>
      </section>

      <section className="panel min-w-0 overflow-hidden">
        <div className="panel-heading">
          <h2>Transactions</h2>
          <p>
            Filled orders, newest first. Partial fills are grouped by order, as
            in the journal.
          </p>
        </div>
        {!loading && data?.accountsCount === 0 ? (
          <div className="empty-state">
            <div>
              <h2>No Hyperliquid accounts configured</h2>
              <p>
                <Link className="underline" href="/settings">
                  Add an enabled Hyperliquid account in Settings
                </Link>{" "}
                to show transactions.
              </p>
            </div>
          </div>
        ) : null}
        {!loading &&
        data &&
        data.accountsCount > 0 &&
        !orderCount &&
        !allFailed ? (
          <div className="empty-state">
            <div>
              <h2>No filled orders</h2>
              <p>No transactions were returned for the available wallets.</p>
            </div>
          </div>
        ) : null}
        {orderCount > 0 ? (
          <>
            <FilledOrdersTable
              orders={data!.orders.slice(
                page * PAGE_SIZE,
                (page + 1) * PAGE_SIZE,
              )}
              cumulativePnlByOrderId={cumulativePnlByOrderId}
              showAccountAndAsset
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#69706c]" aria-live="polite">
                Orders {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, orderCount)} of {orderCount}
              </p>
              {orderCount > PAGE_SIZE ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="button-secondary disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button-secondary disabled:opacity-40"
                    disabled={(page + 1) * PAGE_SIZE >= orderCount}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        <p className="mt-4 text-xs text-[#69706c]">
          New fills refresh up to once per minute. Collected history is retained.
          The first load is limited to the history Hyperliquid makes available,
          so older activity may be missing. Repeated wallet addresses are counted
          once.
        </p>
      </section>
    </main>
  );
}
