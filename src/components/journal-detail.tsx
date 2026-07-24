"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { JournalChart } from "@/components/journal-chart";
import { JournalFilledOrders } from "@/components/journal-filled-orders";
import { JournalPnlBadge } from "@/components/journal-pnl-badge";
import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import { useJournalFilledOrders } from "@/components/use-journal-filled-orders";
import type { JournalEntry, JournalTrade, JournalTradeAsset } from "@/lib/types";

type EntryFormState = {
  date: string;
  descriptionMarkdown: string;
};

const emptyEntryForm: EntryFormState = {
  date: new Date().toISOString().slice(0, 10),
  descriptionMarkdown: "",
};

export function JournalDetail({ tradeId }: { tradeId: string }) {
  const [trade, setTrade] = useState<JournalTrade | null>(null);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [entryForm, setEntryForm] = useState<EntryFormState>(emptyEntryForm);
  const [editingTrade, setEditingTrade] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [entryFormOpen, setEntryFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const filledOrdersState = useJournalFilledOrders(trade?.id ?? null);

  const loadTrade = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/trades/${tradeId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load trade.");
      setTrade(payload.trade);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load trade.",
      );
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadTrade();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadTrade]);

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
    if (!entryFormOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setEditingEntry(null);
        setEntryForm(emptyEntryForm);
        setEntryFormOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [entryFormOpen, saving]);

  async function saveTrade(payload: TradeFormPayload) {
    if (!trade) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save trade.");
      setTrade(result.trade);
      setEditingTrade(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save trade.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!trade) return;

    setSaving(true);
    setError("");
    try {
      const endpoint = editingEntry
        ? `/api/journal/trades/${trade.id}/entries/${editingEntry.id}`
        : `/api/journal/trades/${trade.id}/entries`;
      const response = await fetch(endpoint, {
        method: editingEntry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save entry.");
      setTrade(result.trade);
      setEditingEntry(null);
      setEntryForm(emptyEntryForm);
      setEntryFormOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save entry.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry(entry: JournalEntry) {
    if (!trade || !window.confirm("Delete this entry?")) return;

    setError("");
    try {
      const response = await fetch(
        `/api/journal/trades/${trade.id}/entries/${entry.id}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to delete entry.");
      setTrade(payload.trade);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete entry.",
      );
    }
  }

  function beginNewEntry() {
    setError("");
    setEditingEntry(null);
    setEntryForm(emptyEntryForm);
    setEntryFormOpen(true);
  }

  function beginEditEntry(entry: JournalEntry) {
    setError("");
    setEditingEntry(entry);
    setEntryForm({
      date: entry.date,
      descriptionMarkdown: entry.descriptionMarkdown,
    });
    setEntryFormOpen(true);
  }

  function closeEntryForm() {
    if (saving) return;
    setEditingEntry(null);
    setEntryForm(emptyEntryForm);
    setEntryFormOpen(false);
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6 text-sm text-[#69706c] sm:px-6 lg:px-8">
        Loading trade...
      </main>
    );
  }

  if (!trade) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error ? <div className="alert alert-error">{error}</div> : null}
        <Link className="button-secondary w-fit" href="/journal">
          <ArrowLeft size={16} aria-hidden="true" />
          Journal
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link className="button-secondary w-fit" href="/journal">
          <ArrowLeft size={16} aria-hidden="true" />
          Journal
        </Link>
        <button
          className="button-primary w-fit"
          onClick={beginNewEntry}
          type="button"
        >
          <Plus size={16} aria-hidden="true" />
          New journal entry
        </button>
      </div>

      {error && !entryFormOpen ? (
        <div className="alert alert-error">{error}</div>
      ) : null}

      <section className="grid gap-6">
        <div className="panel">
          {editingTrade ? (
            <JournalTradeForm
              trade={trade}
              markets={markets}
              saving={saving}
              submitLabel="Save trade"
              onCancel={() => setEditingTrade(false)}
              onSubmit={saveTrade}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="panel-heading">
                  <h1>{trade.title}</h1>
                  <p>{formatDateRange(trade)}</p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Edit ${trade.title}`}
                  onClick={() => setEditingTrade(true)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={trade.endDate ? "tag" : "tag tag-green"}>
                  {trade.endDate ? "Closed" : "Open"}
                </span>
                <span className="tag">{trade.asset.label}</span>
                <JournalPnlBadge
                  error={filledOrdersState.error}
                  loading={filledOrdersState.loading}
                  summary={filledOrdersState.data?.summary}
                />
              </div>
              <div className="mt-5">
                <MarkdownView value={trade.descriptionMarkdown} />
              </div>
            </>
          )}
        </div>

      </section>

      <JournalChart trade={trade} ordersState={filledOrdersState} />

      <JournalFilledOrders trade={trade} ordersState={filledOrdersState} />

      <section className="grid gap-6">
        <div className="panel">
          <div className="panel-heading">
            <h2>Entries</h2>
            <p>
              {trade.entries.length ? `${trade.entries.length} notes` : "Notes"}
            </p>
          </div>
          <div className="mt-4 grid gap-3">
            {trade.entries.map((entry) => (
              <article className="entry-row" key={entry.id}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#4f5753]">{entry.date}</p>
                  <div className="mt-2">
                    <MarkdownView value={entry.descriptionMarkdown} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="icon-button"
                    aria-label={`Edit entry ${entry.date}`}
                    onClick={() => beginEditEntry(entry)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete entry ${entry.date}`}
                    onClick={() => removeEntry(entry)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
            {!trade.entries.length ? (
              <div className="empty-state">
                <Plus size={28} aria-hidden="true" />
                <div>
                  <h2>No entries yet</h2>
                  <p>Add updates as the trade idea develops.</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {entryFormOpen ? (
        <div className="journal-modal-backdrop" onClick={closeEntryForm}>
          <div
            aria-labelledby="journal-entry-form-modal-title"
            aria-modal="true"
            className="journal-modal journal-entry-form-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="journal-modal-header">
              <div>
                <p>{editingEntry ? "Edit journal entry" : "New journal entry"}</p>
                <h2 id="journal-entry-form-modal-title">
                  {editingEntry ? editingEntry.date : trade.title}
                </h2>
              </div>
              <button
                aria-label="Close entry form"
                className="icon-button"
                disabled={saving}
                onClick={closeEntryForm}
                type="button"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="journal-modal-body">
              {error ? <div className="alert alert-error">{error}</div> : null}
              <form className="grid gap-4" onSubmit={saveEntry}>
                <div className="grid gap-2">
                  <label className="field-label" htmlFor="entry-date">
                    Date
                  </label>
                  <input
                    id="entry-date"
                    className="input"
                    required
                    type="date"
                    value={entryForm.date}
                    onChange={(event) =>
                      setEntryForm({ ...entryForm, date: event.target.value })
                    }
                  />
                </div>
                <MarkdownEditor
                  id="entry-description"
                  label="Entry"
                  required
                  enableImageUpload
                  value={entryForm.descriptionMarkdown}
                  onChange={(descriptionMarkdown) =>
                    setEntryForm({ ...entryForm, descriptionMarkdown })
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="button-primary"
                    disabled={saving}
                    type="submit"
                  >
                    {editingEntry ? (
                      <Save size={16} aria-hidden="true" />
                    ) : (
                      <Plus size={16} aria-hidden="true" />
                    )}
                    {editingEntry ? "Save entry" : "Add entry"}
                  </button>
                  <button
                    className="button-secondary"
                    disabled={saving}
                    type="button"
                    onClick={closeEntryForm}
                  >
                    <X size={16} aria-hidden="true" />
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatDateRange(trade: JournalTrade) {
  return trade.endDate ? `${trade.startDate} to ${trade.endDate}` : trade.startDate;
}
