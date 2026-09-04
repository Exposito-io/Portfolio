"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, EllipsisVertical } from "lucide-react";

import { JournalPositionValueMetric } from "@/components/journal-pnl-badge";
import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { formatJournalDateTimeKey } from "@/lib/date";
import type { JournalTrade } from "@/lib/types";

export function JournalDetailTopbar({
  trade,
  ordersState,
  portfolioError,
  portfolioInvestmentsUsd,
  portfolioLoading,
  onCloseTrade,
}: {
  trade: JournalTrade;
  ordersState: FilledOrdersState;
  portfolioError: string;
  portfolioInvestmentsUsd: number | null;
  portfolioLoading: boolean;
  onCloseTrade: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;

    function closeActions(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        actionsRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setActionsOpen(false);
    }

    document.addEventListener("mousedown", closeActions);
    window.addEventListener("keydown", closeActions);
    return () => {
      document.removeEventListener("mousedown", closeActions);
      window.removeEventListener("keydown", closeActions);
    };
  }, [actionsOpen]);

  function closeTrade() {
    setActionsOpen(false);
    onCloseTrade();
  }

  return (
    <div className="journal-detail-topbar">
      <Link className="button-secondary w-fit" href="/journal">
        <ArrowLeft size={16} aria-hidden="true" />
        Journal
      </Link>
      <div className="journal-detail-topbar-controls">
        <JournalTradeDetailsMetric trade={trade} />
        {trade.kind === "trade" ? (
          <JournalPositionValueMetric
            error={ordersState.error}
            loading={ordersState.loading}
            portfolioError={portfolioError}
            portfolioLoading={portfolioLoading}
            portfolioInvestmentsUsd={portfolioInvestmentsUsd}
            summary={ordersState.data?.summary}
          />
        ) : null}
        {!trade.endDate ? (
          <div className="journal-entry-actions" ref={actionsRef}>
            <button
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              aria-label="More journal actions"
              className="journal-entry-actions-toggle"
              onClick={() => setActionsOpen((open) => !open)}
              type="button"
            >
              <EllipsisVertical size={18} aria-hidden="true" />
            </button>
            {actionsOpen ? (
              <div className="journal-entry-actions-menu" role="menu">
                <button onClick={closeTrade} role="menuitem" type="button">
                  <Check size={16} aria-hidden="true" />
                  {trade.kind === "idea" ? "Close idea" : "Close trade"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
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
        {trade.direction ? (
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
