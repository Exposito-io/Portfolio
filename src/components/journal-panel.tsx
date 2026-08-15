"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import { JournalPnlBadge } from "@/components/journal-pnl-badge";
import { MarkdownView } from "@/components/markdown-editor";
import type {
  JournalTrade,
  JournalTradeAsset,
  JournalTradePnlSummary,
} from "@/lib/types";
import { formatJournalDateTimeKey } from "@/lib/date";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";

type TradePnlState = {
  summary: JournalTradePnlSummary | null;
  error: string;
  loading: boolean;
};

export function JournalPanel() {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null);
  const [tradeFormOpen, setTradeFormOpen] = useState(false);
  const [closedTradesOpen, setClosedTradesOpen] = useState(false);
  const [tradePnlById, setTradePnlById] = useState<Record<string, TradePnlState>>(
    {},
  );
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
    if (!tradeFormOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setEditingTrade(null);
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
        editingTrade ? `/api/journal/trades/${editingTrade.id}` : "/api/journal/trades",
        {
          method: editingTrade ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save trade.");
      setEditingTrade(null);
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

  async function removeTrade(trade: JournalTrade) {
    if (!window.confirm(`Delete "${trade.title}"?`)) return;

    setError("");
    try {
      const response = await fetch(`/api/journal/trades/${trade.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to delete trade.");
      if (editingTrade?.id === trade.id) {
        setEditingTrade(null);
        setTradeFormOpen(false);
      }
      await loadTrades(false);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete trade.",
      );
    }
  }

  function openNewTradeForm() {
    setError("");
    setEditingTrade(null);
    setTradeFormOpen(true);
  }

  function openEditTradeForm(trade: JournalTrade) {
    setError("");
    setEditingTrade(trade);
    setTradeFormOpen(true);
  }

  function closeTradeForm() {
    if (saving) return;
    setEditingTrade(null);
    setTradeFormOpen(false);
  }

  const openTrades = trades.filter((trade) => !trade.endDate);
  const closedTrades = trades.filter((trade) => trade.endDate);

  function renderTrade(trade: JournalTrade) {
    return (
      <article className="trade-row" key={trade.id}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link className="trade-title" href={`/journal/${trade.id}`}>
              {trade.title}
            </Link>
            {trade.kind === "idea" ? (
              <span className="tag">Trade idea</span>
            ) : null}
            {trade.kind === "trade" && trade.direction ? (
              <span className="tag capitalize">{trade.direction}</span>
            ) : null}
            <span className="tag">{trade.asset.label}</span>
            {trade.kind === "trade" ? (
              <JournalPnlBadge
                error={tradePnlById[trade.id]?.error}
                loading={tradePnlById[trade.id]?.loading}
                summary={tradePnlById[trade.id]?.summary}
              />
            ) : null}
          </div>
          <p className="mt-2 text-sm font-medium text-[#69706c]">
            {formatDateRange(trade)}
          </p>
          <div className="mt-3 line-clamp-3 text-sm leading-6 text-[#4f5753]">
            <MarkdownView value={trade.descriptionMarkdown} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="icon-button"
            aria-label={`Edit ${trade.title}`}
            onClick={() => openEditTradeForm(trade)}
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button danger"
            aria-label={`Delete ${trade.title}`}
            onClick={() => removeTrade(trade)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="panel-heading">
            <h1>Journal</h1>
            <p>{trades.length ? `${trades.length} saved ideas` : "Saved ideas"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="tag tag-green">
              <BookOpen size={13} aria-hidden="true" />
              {trades.filter((trade) => !trade.endDate).length} open
            </span>
            <button
              className="button-primary"
              onClick={openNewTradeForm}
              type="button"
            >
              <Plus size={16} aria-hidden="true" />
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
                <span>{openTrades.length}</span>
              </div>
              <div className="grid gap-3">
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
                  <span className="tag">{closedTrades.length}</span>
                </button>
                {closedTradesOpen ? (
                  <div className="mt-3 grid gap-3">
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
                <p>{editingTrade ? "Edit journal item" : "New journal item"}</p>
                <h2 id="journal-trade-modal-title">
                  {editingTrade ? editingTrade.title : "New journal item"}
                </h2>
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
                key={editingTrade?.id ?? "new"}
                trade={editingTrade}
                markets={markets}
                saving={saving}
                submitLabel={editingTrade ? "Save item" : "Add item"}
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

function formatDateRange(trade: JournalTrade) {
  return trade.endDate
    ? `${formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE)} to ${formatJournalDateTimeKey(trade.endDate, PORTFOLIO_TIMEZONE)}`
    : formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE);
}
