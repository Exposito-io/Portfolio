"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Save, X } from "lucide-react";

import { MarkdownEditor } from "@/components/markdown-editor";
import type { JournalTrade, JournalTradeAsset } from "@/lib/types";

export type TradeFormPayload = {
  title: string;
  descriptionMarkdown: string;
  startDate: string;
  endDate: string;
  asset: JournalTradeAsset;
};

type TradeFormState = {
  title: string;
  descriptionMarkdown: string;
  startDate: string;
  endDate: string;
  assetKey: string;
};

const emptyForm: TradeFormState = {
  title: "",
  descriptionMarkdown: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  assetKey: "",
};

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
  const [form, setForm] = useState<TradeFormState>(emptyForm);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (trade) {
        setForm({
          title: trade.title,
          descriptionMarkdown: trade.descriptionMarkdown,
          startDate: trade.startDate,
          endDate: trade.endDate ?? "",
          assetKey: getAssetKey(trade.asset),
        });
        return;
      }

      setForm(emptyForm);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [trade]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!form.assetKey && marketOptions[0]) {
        setForm((current) => ({ ...current, assetKey: marketOptions[0][0] }));
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [form.assetKey, marketOptions]);

  async function saveTrade(event: FormEvent) {
    event.preventDefault();
    const asset = marketOptions.find(([key]) => key === form.assetKey)?.[1];
    if (!asset) return;

    await onSubmit({
      title: form.title,
      descriptionMarkdown: form.descriptionMarkdown,
      startDate: form.startDate,
      endDate: form.endDate,
      asset,
    });

    if (!trade) {
      setForm({
        ...emptyForm,
        assetKey: marketOptions[0]?.[0] || "",
      });
    }
  }

  return (
    <form className="grid gap-4" onSubmit={saveTrade}>
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
          Hyperliquid asset
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
