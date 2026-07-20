"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  RotateCcw,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { AllocationChart } from "@/components/allocation-chart";
import type { PortfolioResponse } from "@/lib/types";

export function PortfolioDashboard() {
  const [date, setDate] = useState("");
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPortfolio() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (!date && refreshNonce > 0) params.set("refresh", "1");
        const query = params.toString() ? `?${params.toString()}` : "";
        const response = await fetch(`/api/portfolio${query}`, {
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load portfolio.");
        }

        setData(payload);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load portfolio.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadPortfolio();
    return () => controller.abort();
  }, [date, refreshNonce]);

  const snapshot = data?.snapshot;
  const assetPositions =
    snapshot?.positions.filter((position) => position.kind === "asset") ?? [];
  const debtPositions =
    snapshot?.positions.filter((position) => position.kind === "debt") ?? [];
  const totalAssetValueUsd = assetPositions.reduce(
    (sum, position) => sum + position.valueUsd,
    0,
  );
  const totalDebtValueUsd = debtPositions.reduce(
    (sum, position) => sum + position.debtUsd,
    0,
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[#69706c]">
                Read-only Ethereum Aave and Hyperliquid view
              </p>
              <h1 className="text-3xl font-semibold tracking-normal">
                Portfolio
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="field-label" htmlFor="portfolio-date">
                <CalendarDays size={16} aria-hidden="true" />
                Date
              </label>
              <input
                id="portfolio-date"
                className="input h-10 w-[10.5rem]"
                max={todayKey}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <button className="button-secondary h-10" onClick={() => setDate("")}>
                Live
              </button>
              <button
                className="button-primary h-10"
                disabled={loading || Boolean(date)}
                onClick={() => setRefreshNonce((value) => value + 1)}
                title={
                  date
                    ? "Clear the selected date before refreshing live data."
                    : "Refresh live account data and save today's snapshot."
                }
              >
                <RotateCcw size={16} aria-hidden="true" />
                Refresh
              </button>
            </div>
          </div>

          {error ? (
            <Alert tone="error" message={error} />
          ) : null}

          {snapshot?.sourceErrors.length ? (
            <div className="grid gap-2">
              {snapshot.sourceErrors.map((sourceError) => (
                <Alert
                  key={`${sourceError.accountId}:${sourceError.message}`}
                  tone="warning"
                  message={`${sourceError.accountLabel}: ${sourceError.message}`}
                />
              ))}
            </div>
          ) : null}

          {data && data.accountsCount === 0 ? (
            <div className="empty-state">
              <Landmark size={28} aria-hidden="true" />
              <div>
                <h2>No accounts configured</h2>
                <p>Add Aave or Hyperliquid accounts in Settings to start tracking.</p>
              </div>
            </div>
          ) : null}

          {data && !snapshot && data.accountsCount > 0 ? (
            <div className="empty-state">
              <CalendarDays size={28} aria-hidden="true" />
              <div>
                <h2>No snapshot available</h2>
                <p>
                  There is no saved portfolio snapshot on or before{" "}
                  {data.selectedDateKey}.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-[#69706c]">Snapshot</p>
              <h2 className="text-lg font-semibold">
                {snapshot ? snapshot.dateKey : "Waiting for data"}
              </h2>
            </div>
            {loading ? (
              <RefreshCw className="animate-spin text-[#1f7a68]" size={20} />
            ) : null}
          </div>
          <p className="mt-4 text-sm leading-6 text-[#69706c]">
            {data?.mode === "snapshot"
              ? `Showing nearest prior snapshot: ${data.effectiveDateKey ?? "none"}.`
              : data?.mode === "cached"
                ? "Showing today's saved snapshot. Use Refresh for live account data."
                : "Live data refreshed and today's daily snapshot was saved."}
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={<CircleDollarSign size={18} />}
          label="Net worth"
          value={formatCurrency(snapshot?.totals.netWorthUsd)}
        />
        <Metric
          icon={<TrendingUp size={18} />}
          label="Investments"
          value={formatCurrency(snapshot?.totals.totalInvestmentsUsd)}
        />
        <Metric
          icon={<AlertTriangle size={18} />}
          label="Debt"
          value={formatCurrency(snapshot?.totals.totalDebtUsd)}
        />
        <Metric
          icon={<TrendingUp size={18} />}
          label="Yearly PnL"
          value={formatCurrency(snapshot?.totals.yearlyPnlUsd)}
          signed
        />
        <Metric
          icon={<Landmark size={18} />}
          label="Aave health"
          value={
            snapshot?.totals.aaveHealthFactor
              ? snapshot.totals.aaveHealthFactor.toFixed(2)
              : "N/A"
          }
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <div className="panel">
          <div className="panel-heading">
            <h2>Allocation</h2>
            <p>Asset exposure by USD value</p>
          </div>
          <AllocationChart positions={snapshot?.positions ?? []} />
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-heading">
            <h2>Positions</h2>
            <p>Protocol-normalized positive asset exposure</p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Source</th>
                  <th>Account</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {assetPositions.map((position) => (
                  <tr key={position.id}>
                    <td>
                      <span className="font-medium">{position.symbol}</span>
                      <span className="block text-xs text-[#737a76]">
                        {position.name}
                      </span>
                    </td>
                    <td className="capitalize">{position.source}</td>
                    <td>{position.accountLabel}</td>
                    <td>{formatCurrency(position.valueUsd)}</td>
                  </tr>
                ))}
                {assetPositions.length ? (
                  <tr className="total-row">
                    <td colSpan={3}>Total</td>
                    <td>{formatCurrency(totalAssetValueUsd)}</td>
                  </tr>
                ) : null}
                {!assetPositions.length ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-[#69706c]">
                      No positions to display.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-heading">
          <h2>Debts</h2>
          <p>Borrowed balances and liability exposure</p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Source</th>
                <th>Account</th>
                <th>Debt</th>
              </tr>
            </thead>
            <tbody>
              {debtPositions.map((position) => (
                <tr key={position.id}>
                  <td>
                    <span className="font-medium">{position.symbol}</span>
                    <span className="block text-xs text-[#737a76]">
                      {position.name}
                    </span>
                  </td>
                  <td className="capitalize">{position.source}</td>
                  <td>{position.accountLabel}</td>
                  <td>{formatCurrency(position.debtUsd)}</td>
                </tr>
              ))}
              {debtPositions.length ? (
                <tr className="total-row">
                  <td colSpan={3}>Total</td>
                  <td>{formatCurrency(totalDebtValueUsd)}</td>
                </tr>
              ) : null}
              {!debtPositions.length ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[#69706c]">
                    No debts to display.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  signed = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  signed?: boolean;
}) {
  const negative = signed && value.startsWith("-");
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong className={negative ? "text-[#9b3d30]" : ""}>{value}</strong>
    </div>
  );
}

function Alert({
  tone,
  message,
}: {
  tone: "error" | "warning";
  message: string;
}) {
  return <div className={`alert alert-${tone}`}>{message}</div>;
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number") return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
