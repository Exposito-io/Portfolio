"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HyperliquidCandle, JournalTradeAsset } from "@/lib/types";

type CandleInterval = "1h" | "4h" | "1d" | "1w";

export function JournalChart({ asset }: { asset: JournalTradeAsset }) {
  const [candles, setCandles] = useState<HyperliquidCandle[]>([]);
  const [interval, setInterval] = useState<CandleInterval>("1d");
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCandles() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          coin: asset.chartCoin,
          interval,
          days: String(days),
        });
        const response = await fetch(`/api/hyperliquid/candles?${params}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load chart.");
        setCandles(payload.candles);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load chart.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCandles();
    return () => controller.abort();
  }, [asset.chartCoin, days, interval]);

  return (
    <div className="panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="panel-heading">
          <h2>{asset.label}</h2>
          <p>{asset.chartCoin}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="input h-10 w-24"
            value={interval}
            onChange={(event) => setInterval(event.target.value as CandleInterval)}
          >
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
            <option value="1w">1w</option>
          </select>
          <select
            className="input h-10 w-28"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={30}>30d</option>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
            <option value={365}>1y</option>
          </select>
        </div>
      </div>

      {error ? <div className="alert alert-warning">{error}</div> : null}

      <div className="chart-frame">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[#1f7a68]">
            <RefreshCw className="animate-spin" size={22} aria-hidden="true" />
          </div>
        ) : candles.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={candles} margin={{ left: 8, right: 12, top: 8 }}>
              <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
              <XAxis
                dataKey="timeKey"
                minTickGap={24}
                tick={{ fill: "#65706b", fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#65706b", fontSize: 12 }}
                tickFormatter={(value) => formatPrice(Number(value))}
                tickLine={false}
                width={72}
              />
              <Tooltip
                formatter={(value) => formatPrice(Number(value))}
                labelFormatter={(label) => String(label)}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid rgba(0,0,0,0.14)",
                }}
              />
              <Line
                type="monotone"
                dataKey="close"
                dot={false}
                name="Close"
                stroke="#1f7a68"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#69706c]">
            No candles returned.
          </div>
        )}
      </div>
    </div>
  );
}

function formatPrice(value: number) {
  if (value >= 1000) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
}
