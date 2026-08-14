"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Save, X } from "lucide-react";

import { MarkdownEditor } from "@/components/markdown-editor";
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

function createEmptyForm(): TradeFormState {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return {
    kind: "trade",
    direction: "long",
    title: "",
    descriptionMarkdown: "",
    startDate: `${year}-${month}-${day}`,
    endDate: "",
    assetKey: "",
  };
}

export function JournalTradeForm({
  trade,
  markets,
  saving,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  trade?: JournalTrade | null;
  markets: JournalTradeAsset[];
  saving: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: (payload: TradeFormPayload) => Promise<void>;
}) {
  const marketOptions = useMemo(
    () => markets.map((market) => [getAssetKey(market), market] as const),
    [markets],
  );
  const [form, setForm] = useState<TradeFormState>(() => createEmptyForm());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (trade) {
        setForm({
          kind: trade.kind,
          direction: trade.direction ?? "long",
          title: trade.title,
          descriptionMarkdown: trade.descriptionMarkdown,
          startDate: trade.startDate,
          endDate: trade.endDate ?? "",
          assetKey: getAssetKey(trade.asset),
        });
        return;
      }

      setForm(createEmptyForm());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [trade]);

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

    await onSubmit({
      kind: form.kind,
      direction: form.kind === "idea" ? null : form.direction,
      title: form.title,
      descriptionMarkdown: form.descriptionMarkdown,
      startDate: form.startDate,
      endDate: form.endDate,
      asset,
    });

    if (!trade) {
      setForm({
        ...createEmptyForm(),
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
            Start date
          </label>
          <input
            id="trade-start"
            className="input"
            required
            type="date"
            value={form.startDate}
            onChange={(event) =>
              setForm({ ...form, startDate: event.target.value })
            }
          />
        </div>
        <div className="grid gap-2">
          <label className="field-label" htmlFor="trade-end">
            End date
          </label>
          <input
            id="trade-end"
            className="input"
            type="date"
            value={form.endDate}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
          />
        </div>
      </div>
      <MarkdownEditor
        id="trade-description"
        label="Description"
        value={form.descriptionMarkdown}
        onChange={(descriptionMarkdown) =>
          setForm({ ...form, descriptionMarkdown })
        }
      />
      <div className="flex flex-wrap gap-2">
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
      </div>
    </form>
  );
}

export function getAssetKey(asset: JournalTradeAsset) {
  return `${asset.kind}:${asset.dex ?? ""}:${asset.chartCoin}`;
}
