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
  JournalEntry,
  JournalTrade,
} from "@/lib/types";

type CandleInterval = "15m" | "1h" | "4h" | "1d" | "1w";

type RangeOption = {
  label: string;
  days: number;
};

type ChartOrderMarker = {
  kind: "order";
  id: string;
  side: HyperliquidFilledOrder["side"];
  notionalUsd: number;
  orderCount: number;
};

type ChartEntryMarker = {
  kind: "entry";
  id: string;
  date: string;
  descriptionMarkdown: string;
};

type ChartMarkerDetail = ChartOrderMarker | ChartEntryMarker;

type HoveredMarker = ChartMarkerDetail & {
  x: number;
  y: number;
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
  const markerDetailsRef = useRef<Map<string, ChartMarkerDetail>>(new Map());
  const [candles, setCandles] = useState<HyperliquidCandle[]>([]);
  const [interval, setInterval] = useState<CandleInterval>("1d");
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");
  const [hoveredMarker, setHoveredMarker] = useState<HoveredMarker | null>(null);
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
  const markerData = useMemo(
    () =>
      buildChartMarkers({
        orders: ordersState.data?.orders ?? [],
        entries: trade.entries,
        candles,
      }),
    [candles, ordersState.data?.orders, trade.entries],
  );

  useEffect(() => {
    markerDetailsRef.current = markerData.details;
  }, [markerData.details]);

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

    chart.subscribeCrosshairMove((param) => {
      const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
      const point = param.point;

      if (!objectId || !point) {
        setHoveredMarker(null);
        return;
      }

      const detail = markerDetailsRef.current.get(String(objectId));
      if (!detail) {
        setHoveredMarker(null);
        return;
      }

      setHoveredMarker({
        ...detail,
        x: point.x,
        y: point.y,
      });
    });

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
    markersRef.current?.setMarkers(markerData.markers);
    chartRef.current?.timeScale().fitContent();
  }, [candleData, markerData.markers]);

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
            {markerData.markers.length
              ? ` · ${markerData.markers.length} chart markers`
              : ""}
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
        {hoveredMarker ? (
          <div
            className="chart-marker-tooltip"
            style={{
              left: hoveredMarker.x + 12,
              top: hoveredMarker.y,
            }}
          >
            {hoveredMarker.kind === "order" ? (
              <>
                <strong>{hoveredMarker.side}</strong>
                <span>{formatCompactUsd(hoveredMarker.notionalUsd)}</span>
                <small>
                  {hoveredMarker.orderCount}{" "}
                  {hoveredMarker.orderCount === 1 ? "order" : "orders"}
                </small>
              </>
            ) : (
              <>
                <strong>Journal entry</strong>
                <span>{hoveredMarker.date}</span>
                <small className="chart-marker-tooltip-note">
                  {toPlainText(hoveredMarker.descriptionMarkdown)}
                </small>
              </>
            )}
          </div>
        ) : null}
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

function buildChartMarkers({
  orders,
  entries,
  candles,
}: {
  orders: HyperliquidFilledOrder[];
  entries: JournalEntry[];
  candles: HyperliquidCandle[];
}): {
  markers: SeriesMarker<Time>[];
  details: Map<string, ChartMarkerDetail>;
} {
  if (!candles.length || (!orders.length && !entries.length)) {
    return { markers: [], details: new Map() };
  }

  const groups = new Map<
    string,
    {
      time: UTCTimestamp;
      side: HyperliquidFilledOrder["side"];
      notionalUsd: number;
      orderCount: number;
    }
  >();

  for (const order of orders) {
    const candle = findContainingCandle(order.lastTime, candles);
    if (!candle) continue;

    const time = Math.floor(candle.time / 1000) as UTCTimestamp;
    const key = `${time}:${order.side}`;
    const group = groups.get(key) ?? {
      time,
      side: order.side,
      notionalUsd: 0,
      orderCount: 0,
    };
    group.notionalUsd += order.notionalUsd;
    group.orderCount += 1;
    groups.set(key, group);
  }

  const details = new Map<string, ChartMarkerDetail>();
  const markers = [...groups.values()]
    .map<SeriesMarker<Time>>((group) => {
      const isBuy = group.side === "Buy";
      const id = `${group.time}:${group.side}`;
      details.set(id, {
        kind: "order",
        id,
        side: group.side,
        notionalUsd: group.notionalUsd,
        orderCount: group.orderCount,
      });

      return {
        id,
        time: group.time,
        position: isBuy ? "belowBar" : "aboveBar",
        color: isBuy ? "#1f7a68" : "#9b3d30",
        shape: "circle",
        size: 0.85,
      };
    })
    .sort((a, b) => Number(a.time) - Number(b.time));

  for (const entry of entries) {
    const candle = findContainingCandle(
      Date.parse(`${entry.date}T00:00:00.000Z`),
      candles,
    );
    if (!candle) continue;

    const id = `entry:${entry.id}`;
    details.set(id, {
      kind: "entry",
      id,
      date: entry.date,
      descriptionMarkdown: entry.descriptionMarkdown,
    });
    markers.push({
      id,
      time: Math.floor(candle.time / 1000) as UTCTimestamp,
      position: "aboveBar",
      color: "#c27b2c",
      shape: "square",
      size: 0.9,
    });
  }

  markers.sort((a, b) => Number(a.time) - Number(b.time));
  return { markers, details };
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

function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    notation: value >= 100_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function toPlainText(markdown: string) {
  const text = markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "No description.";
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}
