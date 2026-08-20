"use client";

import {
  FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Save, X } from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getDateTimeKey } from "@/lib/date";
import type {
  JournalTrade,
  JournalTradeAsset,
  JournalTradeDirection,
  JournalTradeKind,
} from "@/lib/types";

export type TradeFormPayload = {
  kind: JournalTradeKind;
  direction: JournalTradeDirection | null;
  title: string;
  descriptionMarkdown: string;
  startDate: string;
  endDate: string;
  asset: JournalTradeAsset;
};

type TradeFormState = {
  kind: JournalTradeKind;
  direction: JournalTradeDirection;
  title: string;
  descriptionMarkdown: string;
  startDate: string;
  endDate: string;
  assetKey: string;
};

type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

function createEmptyForm(descriptionMarkdown = ""): TradeFormState {
  return {
    kind: "trade",
    direction: "long",
    title: "",
    descriptionMarkdown,
    startDate: getDateTimeKey(new Date(), PORTFOLIO_TIMEZONE),
    endDate: "",
    assetKey: "",
  };
}

function createTradeForm(trade: JournalTrade): TradeFormState {
  return {
    kind: trade.kind,
    direction: trade.direction ?? "long",
    title: trade.title,
    descriptionMarkdown: trade.descriptionMarkdown,
    startDate: toDateTimeInputValue(trade.startDate, "00:00"),
    endDate: trade.endDate
      ? toDateTimeInputValue(trade.endDate, "23:59")
      : "",
    assetKey: getAssetKey(trade.asset),
  };
}

export function JournalTradeForm({
  trade,
  markets,
  saving,
  submitLabel,
  onCancel,
  onSubmit,
  onAutoSaveDescription,
  autoSaveIntervalMs = 5_000,
  showDescriptionPreview = false,
  defaultDescriptionMarkdown = "",
}: {
  trade?: JournalTrade | null;
  markets: JournalTradeAsset[];
  saving: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: (payload: TradeFormPayload) => Promise<void>;
  onAutoSaveDescription?: (descriptionMarkdown: string) => Promise<void>;
  autoSaveIntervalMs?: number;
  showDescriptionPreview?: boolean;
  defaultDescriptionMarkdown?: string;
}) {
  const marketOptions = useMemo(
    () => markets.map((market) => [getAssetKey(market), market] as const),
    [markets],
  );
  const [form, setForm] = useState<TradeFormState>(() =>
    trade ? createTradeForm(trade) : createEmptyForm(defaultDescriptionMarkdown),
  );
  const previewMarkdown = useDeferredValue(form.descriptionMarkdown);
  const [autoSaveStatus, setAutoSaveStatus] =
    useState<AutoSaveStatus>("idle");
  const previousDefaultDescriptionRef = useRef(defaultDescriptionMarkdown);
  const latestDescriptionRef = useRef(form.descriptionMarkdown);
  const lastSavedDescriptionRef = useRef(form.descriptionMarkdown);
  const autoSavePromiseRef = useRef<Promise<void> | null>(null);
  const manualSaveInProgressRef = useRef(false);

  useEffect(() => {
    const previousDefaultDescription = previousDefaultDescriptionRef.current;
    previousDefaultDescriptionRef.current = defaultDescriptionMarkdown;
    if (trade || previousDefaultDescription === defaultDescriptionMarkdown) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setForm((current) =>
        current.descriptionMarkdown === previousDefaultDescription
          ? { ...current, descriptionMarkdown: defaultDescriptionMarkdown }
          : current,
      );
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [defaultDescriptionMarkdown, trade]);

  useEffect(() => {
    latestDescriptionRef.current = form.descriptionMarkdown;
    if (!onAutoSaveDescription) return;

    setAutoSaveStatus((current) =>
      form.descriptionMarkdown === lastSavedDescriptionRef.current
        ? current === "saving"
          ? current
          : current === "pending" || current === "error"
            ? "saved"
            : current
        : current === "saving"
          ? current
          : "pending",
    );
  }, [form.descriptionMarkdown, onAutoSaveDescription]);

  useEffect(() => {
    if (!onAutoSaveDescription) return;

    const interval = window.setInterval(() => {
      const descriptionMarkdown = latestDescriptionRef.current;
      if (
        manualSaveInProgressRef.current ||
        autoSavePromiseRef.current ||
        descriptionMarkdown === lastSavedDescriptionRef.current
      ) {
        return;
      }

      setAutoSaveStatus("saving");
      const promise = onAutoSaveDescription(descriptionMarkdown);
      autoSavePromiseRef.current = promise;
      void promise
        .then(() => {
          lastSavedDescriptionRef.current = descriptionMarkdown;
          setAutoSaveStatus(
            latestDescriptionRef.current === descriptionMarkdown
              ? "saved"
              : "pending",
          );
        })
        .catch(() => setAutoSaveStatus("error"))
        .finally(() => {
          if (autoSavePromiseRef.current === promise) {
            autoSavePromiseRef.current = null;
          }
        });
    }, autoSaveIntervalMs);

    return () => window.clearInterval(interval);
  }, [autoSaveIntervalMs, onAutoSaveDescription]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!marketOptions[0]) return;

      setForm((current) =>
        current.assetKey
          ? current
          : { ...current, assetKey: marketOptions[0][0] },
      );
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [form.assetKey, marketOptions]);

  async function saveTrade(event: FormEvent) {
    event.preventDefault();
    const asset = marketOptions.find(([key]) => key === form.assetKey)?.[1];
    if (!asset) return;

    manualSaveInProgressRef.current = true;
    try {
      await autoSavePromiseRef.current;
    } catch {
      // The complete manual save below retries the latest description.
    }

    try {
      await onSubmit({
        kind: form.kind,
        direction: form.kind === "idea" ? null : form.direction,
        title: form.title,
        descriptionMarkdown: form.descriptionMarkdown,
        startDate: form.startDate,
        endDate: form.endDate,
        asset,
      });
      lastSavedDescriptionRef.current = form.descriptionMarkdown;
    } finally {
      manualSaveInProgressRef.current = false;
    }

    if (!trade) {
      setForm({
        ...createEmptyForm(defaultDescriptionMarkdown),
        assetKey: marketOptions[0]?.[0] || "",
      });
    }
  }

  return (
    <form className="grid gap-4" onSubmit={saveTrade}>
      <label className="flex items-center gap-3 text-sm font-medium text-[#343a37]">
        <input
          checked={form.kind === "idea"}
          className="h-4 w-4 accent-[#1f7a68]"
          type="checkbox"
          onChange={(event) =>
            setForm({ ...form, kind: event.target.checked ? "idea" : "trade" })
          }
        />
        This is a trade idea
      </label>
      {form.kind === "trade" ? (
        <fieldset className="grid gap-2">
          <legend className="field-label">Direction</legend>
          <div className="flex flex-wrap gap-4">
            {(["long", "short"] as const).map((direction) => (
              <label
                className="flex items-center gap-2 text-sm font-medium capitalize text-[#343a37]"
                key={direction}
              >
                <input
                  checked={form.direction === direction}
                  className="h-4 w-4 accent-[#1f7a68]"
                  name="trade-direction"
                  type="radio"
                  value={direction}
                  onChange={() => setForm({ ...form, direction })}
                />
                {direction}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="grid gap-2">
        <label className="field-label" htmlFor="trade-title">
          Title
        </label>
        <input
          id="trade-title"
          className="input"
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="SOL breakout setup"
        />
      </div>
      <div className="grid gap-2">
        <label className="field-label" htmlFor="trade-asset">
          Ticker / Hyperliquid asset
        </label>
        <select
          id="trade-asset"
          className="input"
          required
          disabled={!marketOptions.length}
          value={form.assetKey}
          onChange={(event) => setForm({ ...form, assetKey: event.target.value })}
        >
          {!marketOptions.length ? <option value="">Loading markets...</option> : null}
          {marketOptions.map(([key, market]) => (
            <option key={key} value={key}>
              {market.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <label className="field-label" htmlFor="trade-start">
            Start date and time
          </label>
          <input
            id="trade-start"
            className="input"
            required
            type="datetime-local"
            value={form.startDate}
            onChange={(event) =>
              setForm({ ...form, startDate: event.target.value })
            }
          />
        </div>
        <div className="grid gap-2">
          <label className="field-label" htmlFor="trade-end">
            End date and time
          </label>
          <input
            id="trade-end"
            className="input"
            type="datetime-local"
            value={form.endDate}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
          />
        </div>
      </div>
      <div className="journal-trade-description-editor-layout">
        <MarkdownEditor
          id="trade-description"
          label="Description"
          value={form.descriptionMarkdown}
          onChange={(descriptionMarkdown) =>
            setForm({ ...form, descriptionMarkdown })
          }
        />
        {showDescriptionPreview ? (
          <section
            aria-label="Description preview"
            className="journal-trade-description-preview"
          >
            <div className="journal-trade-description-preview-heading">
              <span className="field-label">Preview</span>
            </div>
            <div className="journal-trade-description-preview-body">
              <MarkdownView value={previewMarkdown} />
            </div>
          </section>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="button-primary"
          disabled={saving || !marketOptions.length}
          type="submit"
        >
          <Save size={16} aria-hidden="true" />
          {submitLabel}
        </button>
        {onCancel ? (
          <button className="button-secondary" type="button" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
        ) : null}
        {onAutoSaveDescription ? (
          <p className="journal-trade-autosave-status" role="status">
            {formatAutoSaveStatus(autoSaveStatus, autoSaveIntervalMs)}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function formatAutoSaveStatus(
  status: AutoSaveStatus,
  autoSaveIntervalMs: number,
) {
  if (status === "pending") return "Unsaved description changes";
  if (status === "saving") return "Autosaving description…";
  if (status === "saved") return "Description autosaved";
  if (status === "error") return "Autosave failed — retrying";

  return `Description autosaves every ${Math.round(autoSaveIntervalMs / 1_000)} seconds`;
}

export function getAssetKey(asset: JournalTradeAsset) {
  return `${asset.kind}:${asset.dex ?? ""}:${asset.chartCoin}`;
}

function toDateTimeInputValue(value: string, fallbackTime: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return getDateTimeKey(new Date(value), PORTFOLIO_TIMEZONE);
  }
  return value.includes("T") ? value : `${value}T${fallbackTime}`;
}
