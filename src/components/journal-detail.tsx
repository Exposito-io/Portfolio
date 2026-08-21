"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Check,
  EllipsisVertical,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { JournalChart } from "@/components/journal-chart";
import {
  EntryOrderTotalsView,
  groupOrdersByDate,
} from "@/components/journal-entry-order-totals";
import { JournalFilledOrders } from "@/components/journal-filled-orders";
import { JournalTagInput } from "@/components/journal-tag-input";
import {
  JournalClosingPriceMetric,
  JournalMarketMetric,
  JournalEntryPriceMetric,
  JournalFundingMetric,
  JournalPnlMetric,
  JournalPositionValueMetric,
} from "@/components/journal-pnl-badge";
import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import { useJournalFilledOrders } from "@/components/use-journal-filled-orders";
import {
  calculateJournalMarketSummary,
  type JournalMarketSummary,
} from "@/lib/journal-market";
import type { JournalFundingSummary } from "@/lib/journal-funding";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import {
  formatJournalDateTimeKey,
  getDateTimeKey,
  getJournalDateKey,
} from "@/lib/date";
import type {
  HyperliquidCandle,
  JournalEntry,
  JournalTrade,
  JournalTradeAsset,
  PortfolioResponse,
} from "@/lib/types";

type EntryFormState = {
  date: string;
  tags: string[];
  descriptionMarkdown: string;
};

function createEmptyEntryForm(): EntryFormState {
  return {
    date: getDateTimeKey(new Date(), PORTFOLIO_TIMEZONE),
    tags: [],
    descriptionMarkdown: "",
  };
}

export function JournalDetail({ tradeId }: { tradeId: string }) {
  const [trade, setTrade] = useState<JournalTrade | null>(null);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [marketSummary, setMarketSummary] =
    useState<JournalMarketSummary | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(true);
  const [fundingSummary, setFundingSummary] =
    useState<JournalFundingSummary | null>(null);
  const [fundingError, setFundingError] = useState("");
  const [fundingLoading, setFundingLoading] = useState(true);
  const [portfolioInvestmentsUsd, setPortfolioInvestmentsUsd] = useState<
    number | null
  >(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [entryForm, setEntryForm] = useState<EntryFormState>(
    createEmptyEntryForm,
  );
  const [editingTrade, setEditingTrade] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [entryFormOpen, setEntryFormOpen] = useState(false);
  const [closingTrade, setClosingTrade] = useState(false);
  const [entryActionsOpen, setEntryActionsOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const entryActionsRef = useRef<HTMLDivElement>(null);
  const chartCoin = trade?.asset.chartCoin;
  const filledOrdersState = useJournalFilledOrders(
    trade?.kind === "trade" ? trade.id : null,
  );
  const filledOrdersSummary = filledOrdersState.data?.summary;
  const isFlatTrade =
    filledOrdersSummary !== undefined &&
    Math.abs(filledOrdersSummary.positionValueUsd ?? 0) === 0;
  const entryOrderTotals = useMemo(
    () =>
      groupOrdersByDate(
        filledOrdersState.data?.orders ?? [],
        filledOrdersState.data?.timezone ?? "America/Toronto",
      ),
    [filledOrdersState.data?.orders, filledOrdersState.data?.timezone],
  );
  const existingTags = useMemo(
    () =>
      Array.from(
        new Map(
          (trade?.entries ?? [])
            .flatMap((entry) => entry.tags)
            .map((tag) => [tag.toLocaleLowerCase(), tag]),
        ).values(),
      ).sort((left, right) => left.localeCompare(right)),
    [trade?.entries],
  );

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
    if (!chartCoin) return;
    const controller = new AbortController();
    const requestedCoin = chartCoin;

    async function loadMarketSummary() {
      setMarketLoading(true);
      setMarketError("");
      try {
        const params = new URLSearchParams({
          coin: requestedCoin,
          interval: "1h",
          days: "31",
        });
        const response = await fetch(`/api/hyperliquid/candles?${params}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load market price.");
        }
        setMarketSummary(
          calculateJournalMarketSummary(payload.candles as HyperliquidCandle[]),
        );
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setMarketError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load market price.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setMarketLoading(false);
      }
    }

    void loadMarketSummary();
    return () => controller.abort();
  }, [chartCoin]);

  useEffect(() => {
    if (!chartCoin || trade?.asset.kind === "spot") return;
    const controller = new AbortController();
    const requestedCoin = chartCoin;

    async function loadFundingSummary() {
      setFundingLoading(true);
      setFundingError("");
      try {
        const params = new URLSearchParams({ coin: requestedCoin });
        if (trade?.asset.dex) params.set("dex", trade.asset.dex);
        const response = await fetch(`/api/hyperliquid/funding?${params}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load funding rates.");
        }
        setFundingSummary(payload.summary as JournalFundingSummary | null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setFundingError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load funding rates.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setFundingLoading(false);
      }
    }

    void loadFundingSummary();
    return () => controller.abort();
  }, [chartCoin, trade?.asset.dex, trade?.asset.kind]);

  useEffect(() => {
    if (!entryFormOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) {
        setEditingEntry(null);
        setClosingTrade(false);
        setEntryForm(createEmptyEntryForm());
        setEntryFormOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [entryFormOpen, saving]);

  useEffect(() => {
    if (!entryActionsOpen) return;

    function closeEntryActions(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        entryActionsRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setEntryActionsOpen(false);
    }

    document.addEventListener("mousedown", closeEntryActions);
    window.addEventListener("keydown", closeEntryActions);
    return () => {
      document.removeEventListener("mousedown", closeEntryActions);
      window.removeEventListener("keydown", closeEntryActions);
    };
  }, [entryActionsOpen]);

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

  const autoSaveTradeDescription = useCallback(
    async (descriptionMarkdown: string) => {
      if (!trade?.id) return;
      const response = await fetch(`/api/journal/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptionMarkdown }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to autosave description.");
      }
      setTrade(result.trade);
    },
    [trade],
  );

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!trade) return;

    setSaving(true);
    setError("");
    try {
      const endpoint = closingTrade
        ? `/api/journal/trades/${trade.id}/close`
        : editingEntry
          ? `/api/journal/trades/${trade.id}/entries/${editingEntry.id}`
          : `/api/journal/trades/${trade.id}/entries`;
      const response = await fetch(endpoint, {
        method: editingEntry && !closingTrade ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save entry.");
      setTrade(result.trade);
      setEditingEntry(null);
      setClosingTrade(false);
      setEntryForm(createEmptyEntryForm());
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
    setClosingTrade(false);
    setEntryForm(createEmptyEntryForm());
    setEntryFormOpen(true);
  }

  function beginEditEntry(entry: JournalEntry) {
    setError("");
    setEditingEntry(entry);
    setClosingTrade(false);
    setEntryForm({
      date: toDateTimeInputValue(entry.date, entry.createdAt),
      tags: entry.tags,
      descriptionMarkdown: entry.descriptionMarkdown,
    });
    setEntryFormOpen(true);
  }

  function beginCloseTrade() {
    setError("");
    setEntryActionsOpen(false);
    setEditingEntry(null);
    setClosingTrade(true);
    setEntryForm({
      ...createEmptyEntryForm(),
      tags: ["post-mortem"],
    });
    setEntryFormOpen(true);
  }

  function closeEntryForm() {
    if (saving) return;
    setEditingEntry(null);
    setClosingTrade(false);
    setEntryForm(createEmptyEntryForm());
    setEntryFormOpen(false);
  }

  if (loading) {
    return (
      <main className="w-full px-4 py-6 text-sm text-[#69706c] sm:px-6 lg:px-8">
        Loading trade...
      </main>
    );
  }

  if (!trade) {
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        {error ? <div className="alert alert-error">{error}</div> : null}
        <Link className="button-secondary w-fit" href="/journal">
          <ArrowLeft size={16} aria-hidden="true" />
          Journal
        </Link>
      </main>
    );
  }

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="journal-detail-topbar">
        <Link className="button-secondary w-fit" href="/journal">
          <ArrowLeft size={16} aria-hidden="true" />
          Journal
        </Link>
        <div className="journal-detail-topbar-controls">
          <JournalTradeDetailsMetric trade={trade} />
          {trade.kind === "trade" ? (
            <JournalPositionValueMetric
              error={filledOrdersState.error}
              loading={filledOrdersState.loading}
              portfolioError={portfolioError}
              portfolioLoading={portfolioLoading}
              portfolioInvestmentsUsd={portfolioInvestmentsUsd}
              summary={filledOrdersState.data?.summary}
            />
          ) : null}
          <div className="journal-entry-actions" ref={entryActionsRef}>
            <button
              className="button-primary"
              onClick={beginNewEntry}
              type="button"
            >
              <Plus size={16} aria-hidden="true" />
              New journal entry
            </button>
            {!trade.endDate ? (
              <>
                <button
                  aria-expanded={entryActionsOpen}
                  aria-haspopup="menu"
                  aria-label="More journal actions"
                  className="journal-entry-actions-toggle"
                  onClick={() => setEntryActionsOpen((open) => !open)}
                  type="button"
                >
                  <EllipsisVertical size={18} aria-hidden="true" />
                </button>
                {entryActionsOpen ? (
                  <div className="journal-entry-actions-menu" role="menu">
                    <button onClick={beginCloseTrade} role="menuitem" type="button">
                      <Check size={16} aria-hidden="true" />
                      {trade.kind === "idea" ? "Close idea" : "Close trade"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {error && !entryFormOpen ? (
        <div className="alert alert-error">{error}</div>
      ) : null}

      <section
        className={`journal-detail-summary-grid${editingTrade ? " journal-detail-summary-grid-editing" : ""}`}
      >
        <div className="panel">
          {editingTrade ? (
            <JournalTradeForm
              trade={trade}
              markets={markets}
              saving={saving}
              showDescriptionPreview
              submitLabel="Save trade"
              onCancel={() => setEditingTrade(false)}
              onAutoSaveDescription={autoSaveTradeDescription}
              onSubmit={saveTrade}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="panel-heading">
                  <h1>{trade.title}</h1>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Edit ${trade.title}`}
                  onClick={() => setEditingTrade(true)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="journal-trade-description mt-5">
                <MarkdownView value={trade.descriptionMarkdown} />
              </div>
            </>
          )}
        </div>
        <aside className="journal-detail-metrics" aria-label="Trade metrics">
          {trade.kind === "trade" ? (
            <div
              className={`journal-detail-position-metrics${isFlatTrade ? " journal-detail-position-metrics-flat" : ""}`}
            >
              <JournalEntryPriceMetric
                error={filledOrdersState.error}
                loading={filledOrdersState.loading}
                summary={filledOrdersSummary}
              />
              {isFlatTrade ? (
                <JournalClosingPriceMetric summary={filledOrdersSummary} />
              ) : null}
              <JournalPnlMetric
                error={filledOrdersState.error}
                loading={filledOrdersState.loading}
                summary={filledOrdersSummary}
              />
            </div>
          ) : null}
          <JournalMarketMetric
            error={marketError}
            loading={marketLoading}
            summary={marketSummary}
          />
          {trade.asset.kind !== "spot" ? (
            <JournalFundingMetric
              error={fundingError}
              loading={fundingLoading}
              summary={fundingSummary}
            />
          ) : null}
        </aside>
      </section>

      <JournalChart
        trade={trade}
        markets={markets}
        ordersState={filledOrdersState}
        onTradeChange={setTrade}
      />

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
                <div className="entry-row-header">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="entry-row-date">{formatEntryDateTime(entry)}</p>
                    {entry.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <EntryOrderTotalsView
                    loading={filledOrdersState.loading}
                    totals={entryOrderTotals.get(
                      getJournalDateKey(entry.date, PORTFOLIO_TIMEZONE),
                    )}
                  />
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
                </div>
                <div className="min-w-0">
                  <MarkdownView value={entry.descriptionMarkdown} />
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

      {trade.kind === "trade" ? (
        <JournalFilledOrders trade={trade} ordersState={filledOrdersState} />
      ) : null}

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
                <p>
                  {closingTrade
                    ? trade.kind === "idea"
                      ? "Close idea"
                      : "Close trade"
                    : editingEntry
                      ? "Edit journal entry"
                      : "New journal entry"}
                </p>
                <h2 id="journal-entry-form-modal-title">
                  {closingTrade
                    ? trade.title
                    : editingEntry
                      ? editingEntry.date
                      : trade.title}
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
                    {closingTrade ? "Close date and time" : "Date and time"}
                  </label>
                  <input
                    id="entry-date"
                    className="input"
                    required
                    type="datetime-local"
                    value={entryForm.date}
                    onChange={(event) =>
                      setEntryForm({ ...entryForm, date: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="field-label" htmlFor="entry-tags">
                    Tags
                  </label>
                  <JournalTagInput
                    suggestions={existingTags}
                    value={entryForm.tags}
                    onChange={(tags) => setEntryForm({ ...entryForm, tags })}
                  />
                  <p className="text-xs text-[#69706c]">
                    Press Enter or comma to add a tag. You can add up to 8.
                  </p>
                </div>
                <MarkdownEditor
                  id="entry-description"
                  label={closingTrade ? "Journal entry (optional)" : "Entry"}
                  required={!closingTrade}
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
                    ) : closingTrade ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Plus size={16} aria-hidden="true" />
                    )}
                    {closingTrade
                      ? trade.kind === "idea"
                        ? "Close idea"
                        : "Close trade"
                      : editingEntry
                        ? "Save entry"
                        : "Add entry"}
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

function JournalTradeDetailsMetric({ trade }: { trade: JournalTrade }) {
  return (
    <section
      aria-label="Trade details"
      className="journal-detail-trade-widget"
    >
      <div className="journal-detail-trade-date">
        <span>Trade date</span>
        <strong>{formatDateRange(trade)}</strong>
      </div>
      <div className="journal-detail-trade-tags" aria-label="Trade tags">
        <span className={trade.endDate ? "tag" : "tag tag-green"}>
          {trade.endDate ? "Closed" : "Open"}
        </span>
        {trade.kind === "idea" ? <span className="tag">Trade idea</span> : null}
        {trade.kind === "trade" && trade.direction ? (
          <span className="tag capitalize">{trade.direction}</span>
        ) : null}
        <span className="tag">{trade.asset.label}</span>
      </div>
    </section>
  );
}

function formatDateRange(trade: JournalTrade) {
  return trade.endDate
    ? `${formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE)} to ${formatJournalDateTimeKey(trade.endDate, PORTFOLIO_TIMEZONE)}`
    : formatJournalDateTimeKey(trade.startDate, PORTFOLIO_TIMEZONE);
}

function formatEntryDateTime(entry: JournalEntry) {
  return formatJournalDateTimeKey(entry.date, PORTFOLIO_TIMEZONE);
}

function toDateTimeInputValue(value: string, createdAt: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return getDateTimeKey(new Date(value), PORTFOLIO_TIMEZONE);
  }
  if (value.includes("T")) return value;
  return `${value}T${getDateTimeKey(new Date(createdAt), PORTFOLIO_TIMEZONE).slice(11)}`;
}
