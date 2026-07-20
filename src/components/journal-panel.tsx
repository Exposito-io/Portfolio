"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";

import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import { MarkdownView } from "@/components/markdown-editor";
import type { JournalTrade, JournalTradeAsset } from "@/lib/types";

export function JournalPanel() {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [editingTrade, setEditingTrade] = useState<JournalTrade | null>(null);
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
      await loadTrades(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save trade.",
      );
    } finally {
      setSaving(false);
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
      if (editingTrade?.id === trade.id) setEditingTrade(null);
      await loadTrades(false);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete trade.",
      );
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[440px_1fr] lg:px-8">
      <section className="panel h-fit">
        <div className="panel-heading">
          <h1>Journal</h1>
          <p>{editingTrade ? "Edit trade idea" : "New trade idea"}</p>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <div className="mt-5">
          <JournalTradeForm
            key={editingTrade?.id ?? "new"}
            trade={editingTrade}
            markets={markets}
            saving={saving}
            submitLabel={editingTrade ? "Save trade" : "Add trade"}
            onCancel={editingTrade ? () => setEditingTrade(null) : undefined}
            onSubmit={saveTrade}
          />
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="panel-heading">
            <h2>Trades</h2>
            <p>{trades.length ? `${trades.length} saved ideas` : "Saved ideas"}</p>
          </div>
          <span className="tag tag-green">
            <BookOpen size={13} aria-hidden="true" />
            {trades.filter((trade) => !trade.endDate).length} open
          </span>
        </div>

        {loading ? (
          <p className="py-8 text-sm text-[#69706c]">Loading trades...</p>
        ) : null}

        {!loading && !trades.length ? (
          <div className="empty-state">
            <Plus size={28} aria-hidden="true" />
            <div>
              <h2>No trades yet</h2>
              <p>Add the first idea to start building the journal.</p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3">
          {trades.map((trade) => (
            <article className="trade-row" key={trade.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="trade-title" href={`/journal/${trade.id}`}>
                    {trade.title}
                  </Link>
                  <span className={trade.endDate ? "tag" : "tag tag-green"}>
                    {trade.endDate ? "Closed" : "Open"}
                  </span>
                  <span className="tag">{trade.asset.label}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-[#69706c]">
                  {formatDateRange(trade)}
                </p>
                <div className="mt-3 line-clamp-3 text-sm leading-6 text-[#4f5753]">
                  <MarkdownView
                    value={
                      trade.entries[0]?.descriptionMarkdown ||
                      trade.descriptionMarkdown
                    }
                  />
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="icon-button"
                  aria-label={`Edit ${trade.title}`}
                  onClick={() => setEditingTrade(trade)}
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
          ))}
        </div>
      </section>
    </main>
  );
}

function formatDateRange(trade: JournalTrade) {
  return trade.endDate ? `${trade.startDate} to ${trade.endDate}` : trade.startDate;
}
