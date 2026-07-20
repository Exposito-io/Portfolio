"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Scan, ZoomIn, ZoomOut } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import type {
  HyperliquidCandle,
  HyperliquidFilledOrder,
  JournalTrade,
} from "@/lib/types";

type CandleInterval = "15m" | "1h" | "4h" | "1d" | "1w";

type RangeOption = {
  label: string;
  days: number;
};

const rangeOptionsByInterval: Record<CandleInterval, RangeOption[]> = {
  "15m": [
    { label: "1d", days: 1 },
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
  ],
  "1h": [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "180d", days: 180 },
  ],
  "4h": [
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
    { label: "180d", days: 180 },
    { label: "1y", days: 365 },
  ],
  "1d": [
    { label: "90d", days: 90 },
    { label: "180d", days: 180 },
    { label: "1y", days: 365 },
    { label: "3y", days: 1095 },
  ],
  "1w": [
    { label: "1y", days: 365 },
    { label: "3y", days: 1095 },
    { label: "5y", days: 1825 },
  ],
};

export function JournalChart({
  trade,
  ordersState,
}: {
  trade: JournalTrade;
  ordersState: FilledOrdersState;
}) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [candles, setCandles] = useState<HyperliquidCandle[]>([]);
  const [interval, setInterval] = useState<CandleInterval>("1d");
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const rangeOptions = rangeOptionsByInterval[interval];
  const candleData = useMemo(
    () =>
      candles.map<CandlestickData<UTCTimestamp>>((candle) => ({
        time: Math.floor(candle.time / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  );
  const markers = useMemo(
    () => buildOrderMarkers(ordersState.data?.orders ?? [], candles),
    [candles, ordersState.data?.orders],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadCandles() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          coin: trade.asset.chartCoin,
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
  }, [days, interval, trade.asset.chartCoin]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#4f5753",
      },
      grid: {
        vertLines: { color: "rgba(0, 0, 0, 0.06)" },
        horzLines: { color: "rgba(0, 0, 0, 0.06)" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "rgba(0, 0, 0, 0.12)",
      },
      timeScale: {
        borderColor: "rgba(0, 0, 0, 0.12)",
        rightOffset: 8,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#1f7a68",
      downColor: "#9b3d30",
      borderUpColor: "#1f7a68",
      borderDownColor: "#9b3d30",
      wickUpColor: "#1f7a68",
      wickDownColor: "#9b3d30",
      priceFormat: {
        type: "price",
        precision: 4,
        minMove: 0.0001,
      },
    });
    const markerPlugin = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markerPlugin;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;

    seriesRef.current.setData(candleData);
    markersRef.current?.setMarkers(markers);
    chartRef.current?.timeScale().fitContent();
  }, [candleData, markers]);

  function zoom(multiplier: number) {
    const timeScale = chartRef.current?.timeScale();
    const range = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !range) return;

    const center = (range.from + range.to) / 2;
    const halfWidth = ((range.to - range.from) * multiplier) / 2;
    timeScale.setVisibleLogicalRange({
      from: center - halfWidth,
      to: center + halfWidth,
    });
  }

  function changeInterval(nextInterval: CandleInterval) {
    setInterval(nextInterval);
    const allowedDays = rangeOptionsByInterval[nextInterval].map(
      (option) => option.days,
    );
    if (!allowedDays.includes(days)) {
      setDays(allowedDays[allowedDays.length - 1]);
    }
  }

  return (
    <div className="panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="panel-heading">
          <h2>{trade.asset.label}</h2>
          <p>
            {trade.asset.chartCoin}
            {markers.length ? ` · ${markers.length} order markers` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="input h-10 w-24"
            value={interval}
            onChange={(event) =>
              changeInterval(event.target.value as CandleInterval)
            }
          >
            <option value="15m">15m</option>
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
            {rangeOptions.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoom(0.7)}
          >
            <ZoomIn size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoom(1.4)}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Fit chart"
            aria-label="Fit chart"
            onClick={() => chartRef.current?.timeScale().fitContent()}
          >
            <Scan size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-warning">{error}</div> : null}
      {ordersState.error ? (
        <div className="alert alert-warning">{ordersState.error}</div>
      ) : null}

      <div className="chart-frame chart-frame-tradingview">
        <div ref={chartContainerRef} className="h-full w-full" />
        {loading ? (
          <div className="chart-overlay text-[#1f7a68]">
            <RefreshCw className="animate-spin" size={22} aria-hidden="true" />
          </div>
        ) : !candles.length ? (
          <div className="chart-overlay text-sm text-[#69706c]">
            No candles returned.
          </div>
        ) : (
          null
        )}
      </div>
    </div>
  );
}

function buildOrderMarkers(
  orders: HyperliquidFilledOrder[],
  candles: HyperliquidCandle[],
): SeriesMarker<Time>[] {
  if (!candles.length || !orders.length) return [];

  const markers: SeriesMarker<Time>[] = [];

  for (const order of orders) {
    const candle = findContainingCandle(order.lastTime, candles);
    if (!candle) continue;

    const isBuy = order.side === "Buy";
    markers.push({
      id: order.id,
      time: Math.floor(candle.time / 1000) as UTCTimestamp,
      position: isBuy ? "belowBar" : "aboveBar",
      color: isBuy ? "#1f7a68" : "#9b3d30",
      shape: isBuy ? "arrowUp" : "arrowDown",
      text: `${isBuy ? "B" : "S"} ${formatCompactSize(order.totalSize)}`,
      size: 1.15,
    });
  }

  return markers.sort((a, b) => Number(a.time) - Number(b.time));
}

function findContainingCandle(
  orderTime: number,
  candles: HyperliquidCandle[],
) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (orderTime >= candles[index].time) {
      return candles[index];
    }
  }

  return null;
}

function formatCompactSize(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}
