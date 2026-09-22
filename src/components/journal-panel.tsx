"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Layers3,
  Plus,
  X,
} from "lucide-react";

import {
  JournalGroupDialog,
  type JournalGroupFormPayload,
} from "@/components/journal-group-dialog";

import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import {
  JournalTradeCard,
  type JournalCardMarketState,
} from "@/components/journal-trade-card";
import { calculateJournalMarketSummary } from "@/lib/journal-market";
import { getOpenPositionMarketKeys } from "@/lib/journal-market-options";
import { aggregateJournalTradePnlSummaries } from "@/lib/journal-pnl";
import { comparePositionValuesDescending } from "@/lib/journal-sort";
import type {
  HyperliquidCandle,
  JournalItem,
  JournalTrade,
  JournalTradeAsset,
  JournalTradePnlSummary,
  PortfolioResponse,
  PortfolioPosition,
} from "@/lib/types";

type TradePnlState = {
  summary: JournalTradePnlSummary | null;
  error: string;
  loading: boolean;
};

export function JournalPanel() {
  const [items, setItems] = useState<JournalItem[]>([]);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [tradeFormOpen, setTradeFormOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
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
  const [portfolioPositions, setPortfolioPositions] = useState<PortfolioPosition[]>([]);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const visibleItems = useMemo(
    () => items.filter((item) => !getItemEndDate(item) || closedTradesOpen),
    [items, closedTradesOpen],
  );
  const visibleTrades = useMemo(
    () => uniqueTrades(visibleItems.flatMap(getItemTrades)),
    [visibleItems],
  );
  const openPositionMarketKeys = useMemo(
    () => getOpenPositionMarketKeys(markets, portfolioPositions),
    [markets, portfolioPositions],
  );

  const loadItems = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/journal/items");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load trades.");
      if (Array.isArray(payload.items)) {
        setItems(payload.items);
      } else {
        const legacyResponse = await fetch("/api/journal/trades");
        const legacyPayload = await legacyResponse.json();
        if (!legacyResponse.ok || !Array.isArray(legacyPayload.trades)) {
          throw new Error(legacyPayload.error || "Unable to load trades.");
        }
        setItems(legacyPayload.trades.map((trade: JournalTrade) => ({ itemType: "trade" as const, trade })));
      }
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
      void loadItems();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadItems]);

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
        setPortfolioPositions(payload.snapshot?.positions ?? []);
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
      if (!visibleTrades.length) {
        setTradePnlById({});
        return;
      }

      setTradePnlById((current) =>
        Object.fromEntries(
          visibleTrades.filter((trade) => trade.kind === "trade").map((trade) => [
            trade.id,
            current[trade.id] ?? {
              summary: null,
              error: "",
              loading: true,
            },
          ]),
        ),
      );

      for (const trade of visibleTrades) {
        if (trade.kind === "trade") {
          void loadTradePnl(trade.id, controller.signal);
        }
      }
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [visibleTrades]);

  useEffect(() => {
    const controller = new AbortController();
    const coins = Array.from(
      new Set(visibleItems.map(getItemPrimaryTrade).map((trade) => trade.asset.chartCoin).filter(Boolean)),
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
  }, [visibleItems]);

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
      await loadItems(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save trade.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveGroup(payload: JournalGroupFormPayload) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/journal/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create group.");
      setGroupFormOpen(false);
      await loadItems(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to create group.");
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

  const itemsByPositionValue = useMemo(
    () => [...items].sort((left, right) => comparePositionValuesDescending(
      getItemPnlState(left, tradePnlById).summary?.positionValueUsd,
      getItemPnlState(right, tradePnlById).summary?.positionValueUsd,
    )),
    [items, tradePnlById],
  );
  const openItems = itemsByPositionValue.filter((item) => !getItemEndDate(item));
  const closedItems = itemsByPositionValue.filter((item) => getItemEndDate(item));

  function renderItem(item: JournalItem) {
    const trade = getItemDisplayTrade(item);
    const group = item.itemType === "group" ? item.group : null;
    return (
      <JournalTradeCard
        assetSuffix={group ? ` +${group.members.length - 1}` : ""}
        href={group ? `/journal/groups/${group.id}` : undefined}
        key={`${item.itemType}:${group?.id ?? trade.id}`}
        marketState={marketByCoin[trade.asset.chartCoin]}
        pnlState={getItemPnlState(item, tradePnlById)}
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
          <div className="flex flex-wrap gap-2">
            <button className="button-secondary" onClick={() => { setError(""); setGroupFormOpen(true); }} type="button">
              <Layers3 size={17} aria-hidden="true" />
              Group items
            </button>
            <button className="journal-new-button" onClick={openNewTradeForm} type="button">
              <Plus size={17} aria-hidden="true" />
              New journal item
            </button>
          </div>
        </div>

        {error && !tradeFormOpen ? (
          <div className="alert alert-error">{error}</div>
        ) : null}

        {loading ? (
          <p className="py-8 text-sm text-[#69706c]">Loading trades...</p>
        ) : null}

        {!loading && !items.length ? (
          <div className="empty-state">
            <Plus size={28} aria-hidden="true" />
            <div>
              <h2>No journal items yet</h2>
              <p>Add the first idea to start building the journal.</p>
            </div>
          </div>
        ) : null}

        {!loading && items.length ? (
          <>
            <div className="journal-trade-section">
              <div className="journal-trade-section-heading">
                <h2>Open journal items</h2>
                <span aria-label={`${openItems.length} open journal items`}>
                  {openItems.length}
                </span>
              </div>
              <div className="journal-card-grid">
                {openItems.map(renderItem)}
                {!openItems.length ? (
                  <p className="py-3 text-sm text-[#69706c]">
                    No open journal items.
                  </p>
                ) : null}
              </div>
            </div>

            {closedItems.length ? (
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
                  <span>{closedItems.length}</span>
                </button>
                {closedTradesOpen ? (
                  <div className="journal-card-grid mt-4">
                    {closedItems.map(renderItem)}
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
                markets={markets}
                openPositionMarketKeys={openPositionMarketKeys}
                saving={saving}
                submitLabel="Add item"
                onCancel={closeTradeForm}
                onSubmit={saveTrade}
              />
            </div>
          </div>
        </div>
      ) : null}
      {groupFormOpen ? (
        <JournalGroupDialog
          error={error}
          markets={markets}
          openPositionMarketKeys={openPositionMarketKeys}
          saving={saving}
          trades={items.filter((item): item is Extract<JournalItem, { itemType: "trade" }> => item.itemType === "trade").map((item) => item.trade)}
          onClose={() => { if (!saving) setGroupFormOpen(false); }}
          onSubmit={saveGroup}
        />
      ) : null}
    </main>
  );
}

function getItemTrades(item: JournalItem) {
  return item.itemType === "group" ? item.group.members : [item.trade];
}

function uniqueTrades(trades: JournalTrade[]) {
  return Array.from(new Map(trades.map((trade) => [trade.id, trade])).values());
}

function getItemPrimaryTrade(item: JournalItem) {
  if (item.itemType === "trade") return item.trade;
  return item.group.members.find((trade) => trade.id === item.group.primaryTradeId) ?? item.group.members[0];
}

function getItemDisplayTrade(item: JournalItem): JournalTrade {
  if (item.itemType === "trade") return item.trade;
  return {
    ...getItemPrimaryTrade(item),
    id: item.group.id,
    title: item.group.title,
    startDate: item.group.startDate,
    endDate: item.group.endDate,
    descriptionMarkdown: item.group.descriptionMarkdown,
    metricsMarkdown: item.group.metricsMarkdown,
    updatedAt: item.group.updatedAt,
  };
}

function getItemEndDate(item: JournalItem) {
  return item.itemType === "group" ? item.group.endDate : item.trade.endDate;
}

function getItemPnlState(item: JournalItem, states: Record<string, TradePnlState>): TradePnlState {
  const memberStates = getItemTrades(item).filter((trade) => trade.kind === "trade").map((trade) => states[trade.id]);
  if (item.itemType === "trade") {
    return states[item.trade.id] ?? { summary: null, error: "", loading: item.trade.kind === "trade" };
  }
  return {
    summary: aggregateJournalTradePnlSummaries(memberStates.map((state) => state?.summary)),
    error: memberStates.map((state) => state?.error).filter(Boolean).join(" "),
    loading: memberStates.some((state) => !state || state.loading),
  };
}
