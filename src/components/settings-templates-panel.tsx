"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import type { JournalDescriptionTemplate } from "@/lib/types";

export function SettingsTemplatesPanel() {
  const [templates, setTemplates] = useState<JournalDescriptionTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const template =
    templates.find((item) => item.id === selectedTemplateId) ?? templates[0];
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setTemplates(payload.settings.journalDescriptionTemplates);
        setSettingsLoaded(true);
      } catch (loadError) {
        setTemplateError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load settings.",
        );
      }
    }

    void loadSettings();
  }, []);

  async function saveJournalTemplates(event: FormEvent) {
    event.preventDefault();
    const invalidTemplate = templates.find(
      (item) => !item.title.trim() || item.descriptionMarkdown.length > 12_000,
    );
    if (invalidTemplate) {
      setSelectedTemplateId(invalidTemplate.id);
      setTemplateError(
        !invalidTemplate.title.trim()
          ? "Each template needs a title."
          : "Template descriptions must be 12,000 characters or fewer.",
      );
      return;
    }
    setSavingTemplate(true);
    setTemplateSaved(false);
    setTemplateError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalDescriptionTemplates: templates }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to save settings.");
      setTemplates(payload.settings.journalDescriptionTemplates);
      setTemplateSaved(true);
    } catch (saveError) {
      setTemplateError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save settings.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  function updateTemplate(
    id: string,
    changes: Partial<JournalDescriptionTemplate>,
  ) {
    setTemplates((current) =>
      current.map((template) =>
        template.id === id ? { ...template, ...changes } : template,
      ),
    );
    setTemplateSaved(false);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h1>Journal templates</h1>
        <p>
          Create named Markdown templates to insert when creating or editing a
          journal description.
        </p>
      </div>
      {templateError ? (
        <div className="alert alert-error" role="alert">
          {templateError}
        </div>
      ) : null}
      {!settingsLoaded ? (
        <p className="mt-4 text-sm text-[#69706c]">
          {templateError
            ? "Templates could not be loaded. Reload the page to try again."
            : "Loading templates..."}
        </p>
      ) : (
        <form className="mt-5 grid gap-5" onSubmit={saveJournalTemplates}>
          <fieldset className="grid min-w-0 gap-5" disabled={savingTemplate}>
            {!templates.length ? (
              <p className="text-sm text-[#69706c]">
                No templates yet. Add a template to get started.
              </p>
            ) : null}
            {template ? (
              <div className="grid min-w-0 gap-2">
                <label
                  className="field-label"
                  htmlFor="settings-journal-template"
                >
                  Journal template
                </label>
                <select
                  id="settings-journal-template"
                  className="input"
                  value={template.id}
                  onChange={(event) =>
                    setSelectedTemplateId(event.target.value)
                  }
                >
                  {templates.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      {item.title.trim() || `Untitled template ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {template ? (
              <div
                className="grid min-w-0 gap-4 rounded-xl border border-[#e2e5e2] p-4 lg:grid-cols-2"
                key={template.id}
              >
                <div className="flex min-w-0 items-end gap-3 lg:col-span-2">
                  <div className="grid min-w-0 flex-1 gap-2">
                    <label
                      className="field-label"
                      htmlFor={`template-title-${template.id}`}
                    >
                      Template title
                    </label>
                    <input
                      id={`template-title-${template.id}`}
                      className="input"
                      required
                      maxLength={100}
                      value={template.title}
                      onChange={(event) =>
                        updateTemplate(template.id, {
                          title: event.target.value,
                        })
                      }
                      placeholder="Breakout setup"
                    />
                  </div>
                  <button
                    className="button-secondary"
                    type="button"
                    aria-label="Remove selected template"
                    onClick={() => {
                      setTemplates((current) =>
                        current.filter((item) => item.id !== template.id),
                      );
                      setTemplateSaved(false);
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Remove
                  </button>
                </div>
                <MarkdownEditor
                  id={`template-description-${template.id}`}
                  label="Description template"
                  value={template.descriptionMarkdown}
                  onChange={(descriptionMarkdown) =>
                    updateTemplate(template.id, { descriptionMarkdown })
                  }
                />
                <div className="grid min-w-0 content-start gap-2">
                  <p className="field-label">Preview</p>
                  <div className="markdown-template-preview">
                    <MarkdownView value={template.descriptionMarkdown} />
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="button-secondary"
                disabled={templates.length >= 50}
                type="button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  setTemplates((current) => [
                    ...current,
                    { id, title: "", descriptionMarkdown: "" },
                  ]);
                  setSelectedTemplateId(id);
                  setTemplateSaved(false);
                }}
              >
                <Plus size={16} aria-hidden="true" />
                Add template
              </button>
              <button className="button-primary" type="submit">
                <Save size={16} aria-hidden="true" />
                {savingTemplate ? "Saving..." : "Save templates"}
              </button>
              {templateSaved ? (
                <span
                  className="text-sm font-medium text-[#1f7a68]"
                  role="status"
                >
                  Saved
                </span>
              ) : null}
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
