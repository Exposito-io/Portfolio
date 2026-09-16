"use client";

import { type FormEvent, useState } from "react";
import { Pencil, Save, X } from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import type { JournalTrade } from "@/lib/types";

export function JournalDetailMetrics({
  trade,
  saving,
  onSave,
}: {
  trade: JournalTrade;
  saving: boolean;
  onSave: (metricsMarkdown: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trade.metricsMarkdown);

  function beginEdit() {
    setDraft(trade.metricsMarkdown);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // The parent surfaces the error; keep editing so the draft is not lost.
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Metrics</h2>
          <p>Key metrics and links for this trade</p>
        </div>
        {!editing ? (
          <button
            aria-label="Edit metrics"
            className="icon-button"
            onClick={beginEdit}
            type="button"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {editing ? (
        <form className="mt-4 grid gap-4" onSubmit={save}>
          <MarkdownEditor
            id="trade-metrics"
            label="Metrics"
            value={draft}
            onChange={setDraft}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="button-primary" disabled={saving} type="submit">
              <Save size={16} aria-hidden="true" />
              Save metrics
            </button>
            <button
              className="button-secondary"
              disabled={saving}
              type="button"
              onClick={() => setEditing(false)}
            >
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <MarkdownView
            emptyMessage="No metrics yet."
            value={trade.metricsMarkdown}
          />
        </div>
      )}
    </section>
  );
}
