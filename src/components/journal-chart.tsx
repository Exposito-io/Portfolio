"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChartCandlestick,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import {
  EntryOrderTotalsView,
  groupOrdersByDate,
} from "@/components/journal-entry-order-totals";
import { MarkdownView } from "@/components/markdown-editor";
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
  onTradeChange,
}: {
  trade: JournalTrade;
  ordersState: FilledOrdersState;
  onTradeChange: (trade: JournalTrade) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeChartId, setActiveChartId] = useState("journal");
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState("");
  const [chartsSaving, setChartsSaving] = useState(false);
  const activeTradingViewChart = trade.tradingViewCharts.find(
    (chart) => chart.id === activeChartId,
  );

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
  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;

    const detail = markerData.details.get(selectedEntryId);
    return detail?.kind === "entry" ? detail : null;
  }, [markerData.details, selectedEntryId]);
  const entryOrderTotals = useMemo(
    () =>
      groupOrdersByDate(
        ordersState.data?.orders ?? [],
        ordersState.data?.timezone ?? "America/Toronto",
      ),
    [ordersState.data?.orders, ordersState.data?.timezone],
  );

  useEffect(() => {
    markerDetailsRef.current = markerData.details;
  }, [markerData.details]);

  useEffect(() => {
    if (!selectedEntry) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedEntryId(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedEntry]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

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

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const point = param.point;
      const detail = getHoveredMarkerDetail(param, markerDetailsRef.current);

      if (!detail || !point) {
        setHoveredMarker(null);
        return;
      }

      setHoveredMarker({
        ...detail,
        x: point.x,
        y: point.y,
      });
    };

    const handleChartClick = (param: MouseEventParams<Time>) => {
      const detail = getHoveredMarkerDetail(param, markerDetailsRef.current);
      if (detail?.kind !== "entry") {
        return;
      }

      setHoveredMarker(null);
      setSelectedEntryId(detail.id);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleChartClick);

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markerPlugin;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.unsubscribeClick(handleChartClick);
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

  function changeInterval(nextInterval: CandleInterval) {
    setInterval(nextInterval);
    const allowedDays = rangeOptionsByInterval[nextInterval].map(
      (option) => option.days,
    );
    if (!allowedDays.includes(days)) {
      setDays(allowedDays[allowedDays.length - 1]);
    }
  }

  async function toggleFullscreen() {
    const panel = panelRef.current;
    if (!panel) return;

    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch (fullscreenError) {
      setError(
        fullscreenError instanceof Error
          ? fullscreenError.message
          : "Unable to toggle fullscreen.",
      );
    }
  }

  async function saveTradingViewCharts(
    charts: JournalTrade["tradingViewCharts"],
  ) {
    setChartsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradingViewCharts: charts }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to save charts.");
      }
      onTradeChange(payload.trade);
      return payload.trade as JournalTrade;
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save charts.",
      );
      return null;
    } finally {
      setChartsSaving(false);
    }
  }

  async function addTradingViewChart(event: React.FormEvent) {
    event.preventDefault();
    const symbol = chartSymbol.trim();
    if (!symbol) return;

    const chart = { id: crypto.randomUUID(), symbol };
    const updatedTrade = await saveTradingViewCharts([
      ...trade.tradingViewCharts,
      chart,
    ]);
    if (!updatedTrade) return;

    setActiveChartId(chart.id);
    setChartSymbol("");
    setAddChartOpen(false);
  }

  async function removeTradingViewChart(id: string) {
    const charts = trade.tradingViewCharts.filter((chart) => chart.id !== id);
    const updatedTrade = await saveTradingViewCharts(charts);
    if (updatedTrade && activeChartId === id) setActiveChartId("journal");
  }

  return (
    <div ref={panelRef} className="panel chart-panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="panel-heading">
          <h2>{activeTradingViewChart?.symbol ?? trade.asset.label}</h2>
          <p>
            {activeTradingViewChart ? "TradingView" : trade.asset.chartCoin}
            {!activeTradingViewChart && markerData.markers.length
              ? ` · ${markerData.markers.length} chart markers`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!activeTradingViewChart ? <select
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
          </select> : null}

          <button
            className="button-secondary"
            type="button"
            onClick={() => setAddChartOpen(true)}
          >
            <Plus size={16} aria-hidden="true" />
            Add chart
          </button>

          <button
            className="icon-button"
            type="button"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-warning">{error}</div> : null}
      {ordersState.error ? (
        <div className="alert alert-warning">{ordersState.error}</div>
      ) : null}

      <div className="chart-workspace">
      <div className="chart-frame chart-frame-tradingview">
        <div
          ref={chartContainerRef}
          className={activeTradingViewChart ? "hidden h-full w-full" : "h-full w-full"}
        />
        {activeTradingViewChart ? (
          <TradingViewEmbed symbol={activeTradingViewChart.symbol} />
        ) : null}
        {!activeTradingViewChart && hoveredMarker ? (
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
              <EntryMarkerTooltip marker={hoveredMarker} />
            )}
          </div>
        ) : null}
        {!activeTradingViewChart && loading ? (
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
        <aside className="chart-sidebar" aria-label="Available charts">
          <p className="chart-sidebar-title">Charts</p>
          <button
            className={activeChartId === "journal" ? "chart-choice active" : "chart-choice"}
            onClick={() => setActiveChartId("journal")}
            type="button"
          >
            <ChartCandlestick size={16} aria-hidden="true" />
            <span><strong>{trade.asset.label}</strong><small>Journal chart</small></span>
          </button>
          {trade.tradingViewCharts.map((chart) => (
            <div className="chart-choice-row" key={chart.id}>
              <button
                className={activeChartId === chart.id ? "chart-choice active" : "chart-choice"}
                onClick={() => setActiveChartId(chart.id)}
                type="button"
              >
                <ChartCandlestick size={16} aria-hidden="true" />
                <span><strong>{chart.symbol}</strong><small>TradingView</small></span>
              </button>
              <button
                aria-label={`Remove ${chart.symbol} chart`}
                className="chart-remove"
                disabled={chartsSaving}
                onClick={() => void removeTradingViewChart(chart.id)}
                type="button"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </aside>
      </div>

      {addChartOpen ? (
        <div className="journal-entry-modal-backdrop" onClick={() => setAddChartOpen(false)}>
          <form
            aria-labelledby="add-chart-title"
            aria-modal="true"
            className="journal-entry-modal add-chart-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={addTradingViewChart}
            role="dialog"
          >
            <div className="journal-entry-modal-header">
              <div><p>TradingView</p><h3 id="add-chart-title">Add chart</h3></div>
              <button aria-label="Close add chart" className="icon-button" onClick={() => setAddChartOpen(false)} type="button"><X size={16} /></button>
            </div>
            <div className="journal-entry-modal-body grid gap-4">
              <div className="grid gap-2">
                <label className="field-label" htmlFor="tradingview-symbol">Symbol or formula</label>
                <input
                  autoFocus
                  className="input"
                  id="tradingview-symbol"
                  onChange={(event) => setChartSymbol(event.target.value)}
                  placeholder="NASDAQ:AAPL or BINANCE:BTCUSDT/ETHUSDT"
                  required
                  value={chartSymbol}
                />
                <p className="text-xs text-[#69706c]">Use the same symbol or formula you would enter in TradingView.</p>
              </div>
              <div className="flex gap-2">
                <button className="button-primary" disabled={chartsSaving} type="submit"><Plus size={16} />Add chart</button>
                <button className="button-secondary" disabled={chartsSaving} onClick={() => setAddChartOpen(false)} type="button">Cancel</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {selectedEntry ? (
        <div
          className="journal-entry-modal-backdrop"
          onClick={() => setSelectedEntryId(null)}
        >
          <div
            aria-labelledby="journal-entry-modal-title"
            aria-modal="true"
            className="journal-entry-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="journal-entry-modal-header">
              <div>
                <p>Journal entry</p>
                <h3 id="journal-entry-modal-title">{selectedEntry.date}</h3>
              </div>
              <div className="journal-entry-modal-actions">
                <EntryOrderTotalsView
                  loading={ordersState.loading}
                  totals={entryOrderTotals.get(selectedEntry.date)}
                />
                <button
                  aria-label="Close entry"
                  className="icon-button"
                  onClick={() => setSelectedEntryId(null)}
                  type="button"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="journal-entry-modal-body">
              <MarkdownView value={selectedEntry.descriptionMarkdown} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TradingViewEmbed({ symbol }: { symbol: string }) {
  const src = `https://s.tradingview.com/widgetembed/?${new URLSearchParams({
    symbol,
    interval: "D",
    theme: "light",
    style: "1",
    locale: "en",
    hide_side_toolbar: "0",
    allow_symbol_change: "0",
    save_image: "0",
    calendar: "0",
  })}`;

  return (
    <iframe
      allowFullScreen
      className="tradingview-embed"
      key={symbol}
      src={src}
      title={`TradingView chart for ${symbol}`}
    />
  );
}

function EntryMarkerTooltip({ marker }: { marker: ChartEntryMarker }) {
  const image = getFirstMarkdownImage(marker.descriptionMarkdown);

  return (
    <>
      <strong>Journal entry</strong>
      <span>{marker.date}</span>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- Tooltip images come from Markdown/GridFS without stable dimensions for next/image.
        <img
          alt={image.alt}
          className="chart-marker-tooltip-image"
          src={image.src}
        />
      ) : null}
      <small className="chart-marker-tooltip-note">
        {toPlainText(marker.descriptionMarkdown)}
      </small>
    </>
  );
}

function getHoveredMarkerDetail(
  param: MouseEventParams<Time>,
  details: Map<string, ChartMarkerDetail>,
) {
  const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
  if (!objectId) return null;
  return details.get(String(objectId)) ?? null;
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

function getFirstMarkdownImage(markdown: string) {
  const imageMatch = markdown.match(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/,
  );
  if (!imageMatch) return null;

  const src = imageMatch[2].replace(/^<|>$/g, "");
  if (!isSupportedImageSrc(src)) return null;

  return {
    alt: imageMatch[1] || "Journal entry image",
    src,
  };
}

function isSupportedImageSrc(src: string) {
  return (
    src.startsWith("/") ||
    src.startsWith("data:image/") ||
    /^https?:\/\//i.test(src)
  );
}

function toPlainText(markdown: string) {
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
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
