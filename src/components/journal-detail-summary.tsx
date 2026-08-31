"use client";

import { Pencil } from "lucide-react";

import { JournalLatestNews } from "@/components/journal-latest-news";
import {
  JournalClosingPriceMetric,
  JournalEntryPriceMetric,
  JournalFundingMetric,
  JournalMarketMetric,
  JournalPnlMetric,
} from "@/components/journal-pnl-badge";
import {
  JournalTradeForm,
  type TradeFormPayload,
} from "@/components/journal-trade-form";
import { MarkdownView } from "@/components/markdown-editor";
import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import type { JournalFundingSummary } from "@/lib/journal-funding";
import type { JournalMarketSummary } from "@/lib/journal-market";
import { calculateAnnualizedPnlPercent } from "@/lib/journal-pnl";
import type { JournalTrade, JournalTradeAsset } from "@/lib/types";

export function JournalDetailSummary({
  trade,
  markets,
  editing,
  saving,
  ordersState,
  marketError,
  marketLoading,
  marketSummary,
  fundingError,
  fundingLoading,
  fundingSummary,
  onAutoSaveDescription,
  onCancelEdit,
  onEdit,
  onSave,
}: {
  trade: JournalTrade;
  markets: JournalTradeAsset[];
  editing: boolean;
  saving: boolean;
  ordersState: FilledOrdersState;
  marketError: string;
  marketLoading: boolean;
  marketSummary: JournalMarketSummary | null;
  fundingError: string;
  fundingLoading: boolean;
  fundingSummary: JournalFundingSummary | null;
  onAutoSaveDescription: (descriptionMarkdown: string) => Promise<void>;
  onCancelEdit: () => void;
  onEdit: () => void;
  onSave: (payload: TradeFormPayload) => Promise<void>;
}) {
  const filledOrdersSummary = ordersState.data?.summary;
  const annualizedPnlPercent = ordersState.data
    ? calculateAnnualizedPnlPercent(
        ordersState.data.summary.pnlPercent,
        ordersState.data.startTime,
        ordersState.data.endTime,
      )
    : null;
  const isFlatTrade =
    filledOrdersSummary !== undefined &&
    Math.abs(filledOrdersSummary.positionValueUsd ?? 0) === 0;

  return (
    <section
      className={`journal-detail-summary-grid${editing ? " journal-detail-summary-grid-editing" : ""}`}
    >
      <div className="panel">
        {editing ? (
          <JournalTradeForm
            trade={trade}
            markets={markets}
            saving={saving}
            showDescriptionPreview
            submitLabel="Save trade"
            onCancel={onCancelEdit}
            onAutoSaveDescription={onAutoSaveDescription}
            onSubmit={onSave}
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
                onClick={onEdit}
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
              error={ordersState.error}
              loading={ordersState.loading}
              summary={filledOrdersSummary}
            />
            {isFlatTrade ? (
              <JournalClosingPriceMetric summary={filledOrdersSummary} />
            ) : null}
            <JournalPnlMetric
              annualizedPercent={annualizedPnlPercent}
              error={ordersState.error}
              loading={ordersState.loading}
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
        <JournalLatestNews tradeId={trade.id} />
      </aside>
    </section>
  );
}
