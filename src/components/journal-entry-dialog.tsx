"use client";

import { useEffect, type FormEventHandler } from "react";
import { Check, Plus, Save, X } from "lucide-react";

import { JournalTagInput } from "@/components/journal-tag-input";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { JournalEntry, JournalTrade } from "@/lib/types";

export type JournalEntryFormState = {
  date: string;
  tags: string[];
  descriptionMarkdown: string;
};

export function JournalEntryDialog({
  trade,
  closingTrade,
  editingEntry,
  error,
  form,
  saving,
  tagSuggestions,
  onChange,
  onClose,
  onSubmit,
}: {
  trade: JournalTrade;
  closingTrade: boolean;
  editingEntry: JournalEntry | null;
  error: string;
  form: JournalEntryFormState;
  saving: boolean;
  tagSuggestions: string[];
  onChange: (form: JournalEntryFormState) => void;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  return (
    <div className="journal-modal-backdrop" onClick={onClose}>
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
            onClick={onClose}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="journal-modal-body">
          {error ? <div className="alert alert-error">{error}</div> : null}
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <label className="field-label" htmlFor="entry-date">
                {closingTrade ? "Close date and time" : "Date and time"}
              </label>
              <input
                id="entry-date"
                className="input"
                required
                type="datetime-local"
                value={form.date}
                onChange={(event) =>
                  onChange({ ...form, date: event.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="field-label" htmlFor="entry-tags">
                Tags
              </label>
              <JournalTagInput
                suggestions={tagSuggestions}
                value={form.tags}
                onChange={(tags) => onChange({ ...form, tags })}
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
              value={form.descriptionMarkdown}
              onChange={(descriptionMarkdown) =>
                onChange({ ...form, descriptionMarkdown })
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
                onClick={onClose}
              >
                <X size={16} aria-hidden="true" />
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
