"use client";

import { useEffect, useState } from "react";

import { MarkdownView } from "@/components/markdown-editor";
import type { JournalDescriptionTemplate } from "@/lib/types";

export function JournalTemplatePicker({
  descriptionMarkdown,
  disabled,
  onInsert,
}: {
  descriptionMarkdown: string;
  disabled: boolean;
  onInsert: (descriptionMarkdown: string) => void;
}) {
  const [templates, setTemplates] = useState<JournalDescriptionTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadTemplates() {
      try {
        const response = await fetch("/api/settings", {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Unable to load templates.");
        if (!controller.signal.aborted)
          setTemplates(payload.settings.journalDescriptionTemplates);
      } catch (loadError) {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load templates.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadTemplates();
    return () => controller.abort();
  }, []);

  const selected = templates.find((template) => template.id === selectedId);
  const nextDescription = selected
    ? `${descriptionMarkdown}${descriptionMarkdown ? "\n\n" : ""}${selected.descriptionMarkdown}`
    : descriptionMarkdown;
  const tooLong = nextDescription.length > 12_000;

  return (
    <div className="grid min-w-0 gap-2">
      <label className="field-label" htmlFor="journal-template">
        Description template
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="journal-template"
          className="input min-w-0 flex-1"
          disabled={disabled || loading || !templates.length}
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">
            {loading ? "Loading templates..." : "Choose a template"}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title}
            </option>
          ))}
        </select>
        <button
          className="button-secondary"
          type="button"
          disabled={disabled || !selected?.descriptionMarkdown || tooLong}
          onClick={() => {
            onInsert(nextDescription);
            setSelectedId("");
          }}
        >
          Insert template
        </button>
      </div>
      <p className="text-sm text-[#69706c]">
        {error
          ? `${error} You can still write your description.`
          : !loading && !templates.length
            ? "Add templates in Settings. You can also write your own description."
            : "Insert adds the template below your existing text. Choosing a template only previews it."}
      </p>
      {tooLong ? (
        <p className="text-sm text-red-700" role="alert">
          This template would exceed the 12,000-character description limit.
        </p>
      ) : null}
      {selected ? (
        <section
          aria-label="Template preview"
          className="markdown-template-preview"
        >
          <MarkdownView value={selected.descriptionMarkdown} />
        </section>
      ) : null}
    </div>
  );
}
