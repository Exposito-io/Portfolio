"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  EntryOrderTotalsView,
  type EntryOrderTotals,
} from "@/components/journal-entry-order-totals";
import { MarkdownView } from "@/components/markdown-editor";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { formatJournalDateTimeKey, getJournalDateKey } from "@/lib/date";
import type { JournalEntry } from "@/lib/types";

export function JournalDetailEntries({
  entries,
  orderTotals,
  ordersLoading,
  onDelete,
  onEdit,
}: {
  entries: JournalEntry[];
  orderTotals: Map<string, EntryOrderTotals>;
  ordersLoading: boolean;
  onDelete: (entry: JournalEntry) => void;
  onEdit: (entry: JournalEntry) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Entries</h2>
        <p>{entries.length ? `${entries.length} notes` : "Notes"}</p>
      </div>
      <div className="mt-4 grid gap-3">
        {entries.map((entry) => (
          <article className="entry-row" key={entry.id}>
            <div className="entry-row-header">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="entry-row-date">
                  {formatJournalDateTimeKey(entry.date, PORTFOLIO_TIMEZONE)}
                </p>
                {entry.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <EntryOrderTotalsView
                loading={ordersLoading}
                totals={orderTotals.get(
                  getJournalDateKey(entry.date, PORTFOLIO_TIMEZONE),
                )}
              />
              <div className="flex shrink-0 gap-2">
                <button
                  className="icon-button"
                  aria-label={`Edit entry ${entry.date}`}
                  onClick={() => onEdit(entry)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Delete entry ${entry.date}`}
                  onClick={() => onDelete(entry)}
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
        {!entries.length ? (
          <div className="empty-state">
            <Plus size={28} aria-hidden="true" />
            <div>
              <h2>No entries yet</h2>
              <p>Add updates as the trade idea develops.</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
