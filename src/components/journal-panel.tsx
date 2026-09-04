"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";

import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import {
  JournalTradeCard,
  type JournalCardMarketState,
} from "@/components/journal-trade-card";
import { calculateJournalMarketSummary } from "@/lib/journal-market";
import type {
  HyperliquidCandle,
  JournalTrade,
  JournalTradeAsset,
  JournalTradePnlSummary,
  PortfolioResponse,
} from "@/lib/types";

type TradePnlState = {
  summary: JournalTradePnlSummary | null;
  error: string;
  loading: boolean;
};

export function JournalPanel() {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [journalDescriptionTemplate, setJournalDescriptionTemplate] = useState<
    string | null
  >(null);
  const [tradeFormOpen, setTradeFormOpen] = useState(false);
  const [closedTradesOpen, setClosedTradesOpen] = useState(false);
  const [tradePnlById, setTradePnlById] = useState<Record<string, TradePnlState>>(
    {},
  );
  const [marketByCoin, setMarketByCoin] = useState<
    Record<string, JournalCardMarketState>
  >({});
  const [portfolioInvestmentsUsd, setPortfolioInvestmentsUsd] = useState<
    number | null
  >(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadTrades = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/journal/trades");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load trades.");
      setTrades(payload.trades);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load trades.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadTrades();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadTrades]);

  useEffect(() => {
    async function loadMarkets() {
      try {
        const response = await fetch("/api/hyperliquid/markets");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setMarkets(payload.markets);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load Hyperliquid markets.",
        );
      }
    }

    void loadMarkets();
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setJournalDescriptionTemplate(
          payload.settings?.journalDescriptionTemplate ?? "",
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load journal settings.",
        );
      }
    }

    void loadSettings();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPortfolioInvestments() {
      setPortfolioLoading(true);
      setPortfolioError("");
      try {
        const response = await fetch("/api/portfolio", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as PortfolioResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load portfolio value.");
        }
        setPortfolioInvestmentsUsd(
          payload.snapshot?.totals.totalInvestmentsUsd ?? null,
        );
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setPortfolioError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load portfolio value.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setPortfolioLoading(false);
      }
    }

    void loadPortfolioInvestments();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
      if (!trades.length) {
        setTradePnlById({});
        return;
      }

      setTradePnlById((current) =>
        Object.fromEntries(
          trades.filter((trade) => trade.kind === "trade").map((trade) => [
            trade.id,
            current[trade.id] ?? {
              summary: null,
              error: "",
              loading: true,
            },
          ]),
        ),
      );

      for (const trade of trades) {
        if (trade.kind === "trade") {
          void loadTradePnl(trade.id, controller.signal);
        }
      }
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trades]);

  useEffect(() => {
    const controller = new AbortController();
    const coins = Array.from(
      new Set(trades.map((trade) => trade.asset.chartCoin).filter(Boolean)),
    );

    if (!coins.length) {
      setMarketByCoin({});
      return () => controller.abort();
    }

    setMarketByCoin(
      Object.fromEntries(
        coins.map((coin) => [
          coin,
          { candles: [], error: "", loading: true, summary: null },
        ]),
      ),
    );

    async function loadMarketsForCards() {
      const marketEntries = await Promise.all(
        coins.map(async (coin): Promise<[string, JournalCardMarketState]> => {
          try {
            const params = new URLSearchParams({
              coin,
              interval: "15m",
              days: "31",
            });
            const response = await fetch(`/api/hyperliquid/candles?${params}`, {
              signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Unable to load market data.");
            }

            const candles = payload.candles as HyperliquidCandle[];
            return [
              coin,
              {
                candles,
                error: "",
                loading: false,
                summary: calculateJournalMarketSummary(candles),
              },
            ];
          } catch (marketError) {
            return [
              coin,
              {
                candles: [],
                error:
                  marketError instanceof Error
                    ? marketError.message
                    : "Unable to load market data.",
                loading: false,
                summary: null,
              },
            ];
          }
        }),
      );

      if (!controller.signal.aborted) {
        setMarketByCoin(Object.fromEntries(marketEntries));
      }
    }

    void loadMarketsForCards();
    return () => controller.abort();
  }, [trades]);

  useEffect(() => {
    if (!tradeFormOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setTradeFormOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [saving, tradeFormOpen]);

  async function saveTrade(payload: TradeFormPayload) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        "/api/journal/trades",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save trade.");
      setTradeFormOpen(false);
      await loadTrades(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save trade.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadTradePnl(tradeId: string, signal: AbortSignal) {
    setTradePnlById((current) => ({
      ...current,
      [tradeId]: {
        summary: current[tradeId]?.summary ?? null,
        error: "",
        loading: true,
      },
    }));

    try {
      const response = await fetch(
        `/api/journal/trades/${tradeId}/filled-orders`,
        { signal },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load PnL.");
      }

      setTradePnlById((current) => ({
        ...current,
        [tradeId]: {
          summary: payload.summary ?? null,
          error: "",
          loading: false,
        },
      }));
    } catch (pnlError) {
      if (signal.aborted) return;

      setTradePnlById((current) => ({
        ...current,
        [tradeId]: {
          summary: null,
          error: pnlError instanceof Error ? pnlError.message : "Unable to load PnL.",
          loading: false,
        },
      }));
    }
  }

  function openNewTradeForm() {
    setError("");
    setTradeFormOpen(true);
  }

  function closeTradeForm() {
    if (saving) return;
    setTradeFormOpen(false);
  }

  const openTrades = trades.filter((trade) => !trade.endDate);
  const closedTrades = trades.filter((trade) => trade.endDate);

  function renderTrade(trade: JournalTrade) {
    return (
      <JournalTradeCard
        key={trade.id}
        marketState={marketByCoin[trade.asset.chartCoin]}
        pnlState={tradePnlById[trade.id]}
        portfolioState={{
          error: portfolioError,
          investmentsUsd: portfolioInvestmentsUsd,
          loading: portfolioLoading,
        }}
        trade={trade}
      />
    );
  }

  return (
    <main className="journal-page w-full px-4 py-8 sm:px-6 lg:px-8">
      <section className="journal-page-shell">
        <div className="journal-page-header">
          <div>
            <h1>Journal</h1>
          </div>
          <button
            className="journal-new-button"
            disabled={journalDescriptionTemplate === null}
            onClick={openNewTradeForm}
            type="button"
          >
            <Plus size={17} aria-hidden="true" />
            New journal item
          </button>
        </div>

        {error && !tradeFormOpen ? (
          <div className="alert alert-error">{error}</div>
        ) : null}

        {loading ? (
          <p className="py-8 text-sm text-[#69706c]">Loading trades...</p>
        ) : null}

        {!loading && !trades.length ? (
          <div className="empty-state">
            <Plus size={28} aria-hidden="true" />
            <div>
              <h2>No journal items yet</h2>
              <p>Add the first idea to start building the journal.</p>
            </div>
          </div>
        ) : null}

        {!loading && trades.length ? (
          <>
            <div className="journal-trade-section">
              <div className="journal-trade-section-heading">
                <h2>Open journal items</h2>
                <span aria-label={`${openTrades.length} open journal items`}>
                  {openTrades.length}
                </span>
              </div>
              <div className="journal-card-grid">
                {openTrades.map(renderTrade)}
                {!openTrades.length ? (
                  <p className="py-3 text-sm text-[#69706c]">
                    No open journal items.
                  </p>
                ) : null}
              </div>
            </div>

            {closedTrades.length ? (
              <div className="journal-trade-section journal-closed-trades">
                <button
                  aria-expanded={closedTradesOpen}
                  className="journal-closed-trades-toggle"
                  onClick={() => setClosedTradesOpen((open) => !open)}
                  type="button"
                >
                  <span>
                    {closedTradesOpen ? (
                      <ChevronDown size={18} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={18} aria-hidden="true" />
                    )}
                    Closed journal items
                  </span>
                  <span>{closedTrades.length}</span>
                </button>
                {closedTradesOpen ? (
                  <div className="journal-card-grid mt-4">
                    {closedTrades.map(renderTrade)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {tradeFormOpen ? (
        <div className="journal-modal-backdrop" onClick={closeTradeForm}>
          <div
            aria-labelledby="journal-trade-modal-title"
            aria-modal="true"
            className="journal-modal journal-trade-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="journal-modal-header">
              <div>
                <p>Create journal item</p>
                <h2 id="journal-trade-modal-title">New journal item</h2>
              </div>
              <button
                aria-label="Close trade form"
                className="icon-button"
                disabled={saving}
                onClick={closeTradeForm}
                type="button"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="journal-modal-body">
              {error ? <div className="alert alert-error">{error}</div> : null}
              <JournalTradeForm
                key="new"
                trade={null}
                defaultDescriptionMarkdown={journalDescriptionTemplate ?? ""}
                markets={markets}
                saving={saving}
                submitLabel="Add item"
                onCancel={closeTradeForm}
                onSubmit={saveTrade}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
