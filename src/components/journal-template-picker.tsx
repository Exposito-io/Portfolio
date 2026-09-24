"use client";

import { useEffect, useState } from "react";

import type { JournalDescriptionTemplate } from "@/lib/types";

export function JournalTemplatePicker({
  descriptionMarkdown,
  disabled,
  onSelect,
}: {
  descriptionMarkdown: string;
  disabled: boolean;
  onSelect: (descriptionMarkdown: string) => void;
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
  const tooLong = Boolean(
    selected && selected.descriptionMarkdown.length > 12_000,
  );

  function selectTemplate(templateId: string) {
    if (!templateId) {
      setSelectedId("");
      return;
    }

    const template = templates.find((item) => item.id === templateId);
    if (!template) return;

    if (template.descriptionMarkdown.length > 12_000) {
      setSelectedId(templateId);
      return;
    }

    if (
      descriptionMarkdown &&
      !window.confirm(
        "Replace your current description with this template? Your current description will be lost.",
      )
    ) {
      return;
    }

    onSelect(template.descriptionMarkdown);
    setSelectedId("");
  }

  return (
    <div className="grid min-w-0 gap-2">
      <label className="field-label" htmlFor="journal-template">
        Description template
      </label>
      <select
        id="journal-template"
        className="input min-w-0"
        disabled={disabled || loading || !templates.length}
        value={selectedId}
        onChange={(event) => selectTemplate(event.target.value)}
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
      <p className="text-sm text-[#69706c]">
        {error
          ? `${error} You can still write your description.`
          : !loading && !templates.length
            ? "Add templates in Settings. You can also write your own description."
            : "Choosing a template replaces the description. You'll be asked first if the description isn't empty."}
      </p>
      {tooLong ? (
        <p className="text-sm text-red-700" role="alert">
          This template would exceed the 12,000-character description limit.
        </p>
      ) : null}
    </div>
  );
}
