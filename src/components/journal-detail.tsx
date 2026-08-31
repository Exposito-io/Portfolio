"use client";

import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ArrowLeft } from "lucide-react";

import { JournalChart } from "@/components/journal-chart";
import { JournalDetailEntries } from "@/components/journal-detail-entries";
import { JournalDetailSummary } from "@/components/journal-detail-summary";
import { JournalDetailTabs } from "@/components/journal-detail-tabs";
import { JournalDetailTopbar } from "@/components/journal-detail-topbar";
import {
  JournalEntryDialog,
  type JournalEntryFormState,
} from "@/components/journal-entry-dialog";
import { groupOrdersByDate } from "@/components/journal-entry-order-totals";
import { JournalFilledOrders } from "@/components/journal-filled-orders";
import { JournalNews } from "@/components/journal-news";
import { JournalNewsProvider } from "@/components/journal-news-context";
import type { TradeFormPayload } from "@/components/journal-trade-form";
import { useJournalFilledOrders } from "@/components/use-journal-filled-orders";
import {
  calculateJournalMarketSummary,
  type JournalMarketSummary,
} from "@/lib/journal-market";
import type { JournalFundingSummary } from "@/lib/journal-funding";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getDateTimeKey } from "@/lib/date";
import type {
  HyperliquidCandle,
  JournalEntry,
  JournalTrade,
  JournalTradeAsset,
  PortfolioResponse,
} from "@/lib/types";

function createEmptyEntryForm(): JournalEntryFormState {
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
  const [entryForm, setEntryForm] = useState<JournalEntryFormState>(
    createEmptyEntryForm,
  );
  const [editingTrade, setEditingTrade] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [entryFormOpen, setEntryFormOpen] = useState(false);
  const [closingTrade, setClosingTrade] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const chartCoin = trade?.asset.chartCoin;
  const filledOrdersState = useJournalFilledOrders(
    trade?.kind === "trade" ? trade.id : null,
  );
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
    setEditingEntry(null);
    setClosingTrade(true);
    setEntryForm({
      ...createEmptyEntryForm(),
      tags: ["post-mortem"],
    });
    setEntryFormOpen(true);
  }

  const closeEntryForm = useCallback(() => {
    if (saving) return;
    setEditingEntry(null);
    setClosingTrade(false);
    setEntryForm(createEmptyEntryForm());
    setEntryFormOpen(false);
  }, [saving]);

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
      <JournalDetailTopbar
        trade={trade}
        ordersState={filledOrdersState}
        portfolioError={portfolioError}
        portfolioInvestmentsUsd={portfolioInvestmentsUsd}
        portfolioLoading={portfolioLoading}
        onCloseTrade={beginCloseTrade}
        onNewEntry={beginNewEntry}
      />

      {error && !entryFormOpen ? (
        <div className="alert alert-error">{error}</div>
      ) : null}

      <JournalNewsProvider key={trade.id} tradeId={trade.id}>
        <JournalDetailSummary
          trade={trade}
          markets={markets}
          editing={editingTrade}
          saving={saving}
          ordersState={filledOrdersState}
          marketError={marketError}
          marketLoading={marketLoading}
          marketSummary={marketSummary}
          fundingError={fundingError}
          fundingLoading={fundingLoading}
          fundingSummary={fundingSummary}
          onAutoSaveDescription={autoSaveTradeDescription}
          onCancelEdit={() => setEditingTrade(false)}
          onEdit={() => setEditingTrade(true)}
          onSave={saveTrade}
        />

        <JournalDetailTabs
          charts={
            <JournalChart
              trade={trade}
              ordersState={filledOrdersState}
              markets={markets}
              onTradeChange={setTrade}
            />
          }
          journal={
            <JournalDetailEntries
              entries={trade.entries}
              orderTotals={entryOrderTotals}
              ordersLoading={filledOrdersState.loading}
              onDelete={removeEntry}
              onEdit={beginEditEntry}
            />
          }
          transactions={
            trade.kind === "trade" ? (
              <JournalFilledOrders
                trade={trade}
                ordersState={filledOrdersState}
              />
            ) : null
          }
          news={<JournalNews tradeId={trade.id} />}
        />
      </JournalNewsProvider>

      {entryFormOpen ? (
        <JournalEntryDialog
          trade={trade}
          closingTrade={closingTrade}
          editingEntry={editingEntry}
          error={error}
          form={entryForm}
          saving={saving}
          tagSuggestions={existingTags}
          onChange={setEntryForm}
          onClose={closeEntryForm}
          onSubmit={saveEntry}
        />
      ) : null}
    </main>
  );
}

function toDateTimeInputValue(value: string, createdAt: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return getDateTimeKey(new Date(value), PORTFOLIO_TIMEZONE);
  }
  if (value.includes("T")) return value;
  return `${value}T${getDateTimeKey(new Date(createdAt), PORTFOLIO_TIMEZONE).slice(11)}`;
}
