"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useId,
  useMemo,
  useState,
} from "react";

import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { formatJournalDateTimeKey } from "@/lib/date";
import type { JournalMarketSummary } from "@/lib/journal-market";
import type {
  HyperliquidCandle,
  JournalTrade,
  JournalTradePnlSummary,
} from "@/lib/types";

export type JournalCardMarketState = {
  candles: HyperliquidCandle[];
  error: string;
  loading: boolean;
  summary: JournalMarketSummary | null;
};

type JournalTradeCardProps = {
  marketState?: JournalCardMarketState;
  pnlState?: {
    error: string;
    loading: boolean;
    summary: JournalTradePnlSummary | null;
  };
  trade: JournalTrade;
};

export function JournalTradeCard({
  marketState,
  pnlState,
  trade,
}: JournalTradeCardProps) {
  const marketSummary = marketState?.summary;
  const chartTone = getTone(marketSummary?.change24hPercent);
  const status = trade.endDate ? "Closed" : "Open";

  return (
    <Link
      aria-label={`Open ${trade.title}`}
      className="journal-card"
      href={`/journal/${trade.id}`}
    >
      <article>
        <header className="journal-card-header">
          <div className="journal-card-identity">
            <div className="journal-card-asset-mark" aria-hidden="true">
              {getAssetMonogram(trade.asset.coin)}
            </div>
            <div className="min-w-0">
              <h3>{trade.title}</h3>
              <div className="journal-card-meta">
                <strong>{trade.asset.coin}</strong>
                <span aria-hidden="true">·</span>
                <span className={`journal-card-status journal-card-status-${status.toLowerCase()}`}>
                  <i aria-hidden="true" />
                  {status}
                </span>
                {trade.direction ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{trade.direction}</span>
                  </>
                ) : null}
              </div>
              <p>{formatDateRange(trade)}</p>
            </div>
          </div>

          <div className="journal-card-price">
            <span>Current price</span>
            <strong>
              {marketState?.loading
                ? "Loading"
                : marketSummary
                  ? formatAssetPrice(marketSummary.priceUsd)
                  : "N/A"}
            </strong>
          </div>

          <span className="journal-card-arrow" aria-hidden="true">
            <ArrowUpRight size={20} strokeWidth={1.8} />
          </span>
        </header>

        <JournalSparkline
          candles={marketState?.candles ?? []}
          error={marketState?.error}
          loading={marketState?.loading ?? true}
          tone={chartTone}
        />

        <div className="journal-card-metrics">
          <PnlCell state={pnlState} tradeKind={trade.kind} />
          <PerformanceCell label="24h" value={marketSummary?.change24hPercent} />
          <PerformanceCell label="7d" value={marketSummary?.change7dPercent} />
          <PerformanceCell label="30d" value={marketSummary?.change30dPercent} />
        </div>
      </article>
    </Link>
  );
}

function JournalSparkline({
  candles,
  error,
  loading,
  tone,
}: {
  candles: HyperliquidCandle[];
  error?: string;
  loading: boolean;
  tone: "positive" | "negative" | "neutral";
}) {
  const gradientId = useId().replaceAll(":", "");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const displayedCandles = useMemo(
    () => candles.slice(-96).filter((candle) => Number.isFinite(candle.close)),
    [candles],
  );
  const coordinates = useMemo(
    () => buildSparklineCoordinates(displayedCandles, 600, 112, 6),
    [displayedCandles],
  );
  const color =
    tone === "positive" ? "#10845f" : tone === "negative" ? "#d14f45" : "#52605a";

  if (loading) {
    return <div className="journal-card-chart journal-card-chart-loading" aria-label="Loading 15 minute chart" />;
  }

  if (!coordinates.length) {
    return (
      <div className="journal-card-chart journal-card-chart-empty">
        {error || "Chart unavailable"}
      </div>
    );
  }

  const linePath = `M ${coordinates.map(({ x, y }) => `${x} ${y}`).join(" L ")}`;
  const areaPath = `${linePath} L 600 112 L 0 112 Z`;
  const lastPoint = coordinates.at(-1) ?? { x: 0, y: 0 };
  const hoveredPoint = hoveredIndex === null ? null : coordinates[hoveredIndex];
  const hoveredCandle =
    hoveredIndex === null ? null : displayedCandles[hoveredIndex];
  const prices = displayedCandles.map((candle) => candle.close);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const midpoint = (minimum + maximum) / 2;
  const middleCandle = displayedCandles[Math.floor(displayedCandles.length / 2)];

  function updateHoveredCandle(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.min(
      Math.max(event.clientX - bounds.left, 0),
      bounds.width,
    );
    const nextIndex = Math.round(
      (position / bounds.width) * (displayedCandles.length - 1),
    );
    setHoveredIndex((current) => (current === nextIndex ? current : nextIndex));
  }

  return (
    <div className="journal-card-chart" aria-label="15 minute price chart">
      <div
        className="journal-card-chart-plot"
        onPointerLeave={() => setHoveredIndex(null)}
        onPointerMove={updateHoveredCandle}
      >
        <svg preserveAspectRatio="none" role="img" viewBox="0 0 600 112">
          <title>15 minute price chart</title>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="journal-card-chart-grid" aria-hidden="true">
            <line x1="0" x2="600" y1="6" y2="6" />
            <line x1="0" x2="600" y1="56" y2="56" />
            <line x1="0" x2="600" y1="106" y2="106" />
            <line x1="0" x2="0" y1="6" y2="106" />
            <line x1="300" x2="300" y1="6" y2="106" />
            <line x1="600" x2="600" y1="6" y2="106" />
          </g>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
          />
          {hoveredPoint ? (
            <g className="journal-card-chart-crosshair" aria-hidden="true">
              <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1="6" y2="106" />
              <line x1="0" x2="600" y1={hoveredPoint.y} y2={hoveredPoint.y} />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} fill={color} r="4" />
            </g>
          ) : null}
          <circle cx={lastPoint.x} cy={lastPoint.y} fill={color} r="4" />
        </svg>

        {hoveredPoint && hoveredCandle ? (
          <div
            className="journal-card-chart-tooltip"
            data-edge={
              hoveredIndex === 0
                ? "start"
                : hoveredIndex === displayedCandles.length - 1
                  ? "end"
                  : undefined
            }
            style={{
              left: `${(hoveredPoint.x / 600) * 100}%`,
              top: `${(hoveredPoint.y / 112) * 100}%`,
            }}
          >
            <strong>{formatAssetPrice(hoveredCandle.close)}</strong>
            <span>{formatChartTimestamp(hoveredCandle.time)}</span>
          </div>
        ) : null}
      </div>

      <div className="journal-card-chart-y-axis" aria-hidden="true">
        <span>{formatAxisPrice(maximum)}</span>
        <span>{formatAxisPrice(midpoint)}</span>
        <span>{formatAxisPrice(minimum)}</span>
      </div>
      <div className="journal-card-chart-x-axis" aria-hidden="true">
        <span>{formatChartTime(displayedCandles[0].time)}</span>
        <span>{formatChartTime(middleCandle.time)}</span>
        <span>{formatChartTime(displayedCandles.at(-1)?.time ?? 0)}</span>
      </div>
    </div>
  );
}

function PnlCell({
  state,
  tradeKind,
}: {
  state?: JournalTradeCardProps["pnlState"];
  tradeKind: JournalTrade["kind"];
}) {
  const pnl = state?.summary?.pnlUsd;
  const percent = state?.summary?.pnlPercent;
  const tone = getTone(pnl);
  const unavailable = tradeKind !== "trade" || state?.error || pnl === null || pnl === undefined;

  return (
    <div className={`journal-card-metric journal-card-metric-pnl journal-card-metric-${tone}`}>
      <span>PnL</span>
      {state?.loading && tradeKind === "trade" ? (
        <strong>Loading</strong>
      ) : unavailable ? (
        <strong>N/A</strong>
      ) : (
        <>
          <strong>{formatSignedCurrency(pnl)}</strong>
          <small>{isFiniteNumber(percent) ? formatSignedPercent(percent) : ""}</small>
        </>
      )}
    </div>
  );
}

function PerformanceCell({ label, value }: { label: string; value?: number }) {
  const tone = getTone(value);

  return (
    <div className={`journal-card-metric journal-card-metric-${tone}`}>
      <span>{label}</span>
      <strong>{isFiniteNumber(value) ? formatSignedPercent(value) : "N/A"}</strong>
    </div>
  );
}

export function buildSparklinePoints(
  candles: HyperliquidCandle[],
  width: number,
  height: number,
  padding: number,
) {
  return buildSparklineCoordinates(candles, width, height, padding).map(
    ({ x, y }) => `${x} ${y}`,
  );
}

function buildSparklineCoordinates(
  candles: HyperliquidCandle[],
  width: number,
  height: number,
  padding: number,
) {
  const values = candles.map((candle) => candle.close).filter(Number.isFinite);
  if (!values.length) return [];

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const denominator = Math.max(values.length - 1, 1);

  return values.map((value, index) => {
    const x = (index / denominator) * width;
    const y = padding + ((maximum - value) / range) * (height - padding * 2);
    return { x: roundPoint(x), y: roundPoint(y) };
  });
}

function roundPoint(value: number) {
  return Math.round(value * 100) / 100;
}

function getAssetMonogram(coin: string) {
  return coin.replace(/^.*:/, "").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "•";
}

function getTone(value: number | undefined | null) {
  return isFiniteNumber(value)
    ? value > 0
      ? "positive"
      : value < 0
        ? "negative"
        : "neutral"
    : "neutral";
}

function formatDateRange(trade: JournalTrade) {
  return trade.endDate
    ? `${formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE)} to ${formatJournalDateTimeKey(trade.endDate, PORTFOLIO_TIMEZONE)}`
    : `${formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE)} — Present`;
}

function formatSignedCurrency(value: number) {
  const formatted = new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    style: "currency",
  }).format(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function formatSignedPercent(value: number) {
  const formatted = `${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}%`;
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function formatAssetPrice(value: number) {
  const maximumFractionDigits = value >= 1000 ? 2 : value >= 1 ? 4 : 8;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits,
    style: "currency",
  }).format(value);
}

function formatAxisPrice(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}m`;
  }
  if (absoluteValue >= 1_000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (absoluteValue >= 1) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function formatChartTime(time: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: PORTFOLIO_TIMEZONE,
  }).format(new Date(time));
}

function formatChartTimestamp(time: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: PORTFOLIO_TIMEZONE,
  }).format(new Date(time));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
