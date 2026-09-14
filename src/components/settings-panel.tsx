"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import type {
  AccountSource,
  JournalDescriptionTemplate,
  PortfolioAccount,
} from "@/lib/types";

type FormState = {
  source: AccountSource;
  label: string;
  address: string;
  enabled: boolean;
  notes: string;
};

const emptyForm: FormState = {
  source: "aave",
  label: "",
  address: "",
  enabled: true,
  notes: "",
};

export function SettingsPanel() {
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<JournalDescriptionTemplate[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  const loadAccounts = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    setError("");
    try {
      const response = await fetch("/api/accounts");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setAccounts(payload.accounts);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load accounts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAccounts(false);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadAccounts]);

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

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        editingId ? `/api/accounts/${editingId}` : "/api/accounts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setForm(emptyForm);
      setEditingId(null);
      await loadAccounts();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await loadAccounts();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete account.",
      );
    }
  }

  function editAccount(account: PortfolioAccount) {
    setEditingId(account.id);
    setForm({
      source: account.source,
      label: account.label,
      address: account.address,
      enabled: account.enabled,
      notes: account.notes,
    });
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[440px_1fr] lg:px-8">
      <section className="panel lg:col-span-2">
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
              {templates.map((template, index) => (
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
                        Template title {index + 1}
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
                      aria-label={`Remove template ${index + 1}`}
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
                    label={`Description template ${index + 1}`}
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
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="button-secondary"
                  disabled={templates.length >= 50}
                  type="button"
                  onClick={() => {
                    setTemplates((current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        title: "",
                        descriptionMarkdown: "",
                      },
                    ]);
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
      <section className="panel h-fit">
        <div className="panel-heading">
          <h1>Settings</h1>
          <p>Configure read-only Aave and Hyperliquid accounts.</p>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <form className="mt-5 grid gap-4" onSubmit={saveAccount}>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="source">
              Source
            </label>
            <select
              id="source"
              className="input"
              value={form.source}
              onChange={(event) =>
                setForm({
                  ...form,
                  source: event.target.value as AccountSource,
                })
              }
            >
              <option value="aave">Aave Ethereum</option>
              <option value="hyperliquid">Hyperliquid</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="label">
              Label
            </label>
            <input
              id="label"
              className="input"
              required
              value={form.label}
              onChange={(event) =>
                setForm({ ...form, label: event.target.value })
              }
              placeholder="Main wallet"
            />
          </div>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="address">
              Address
            </label>
            <input
              id="address"
              className="input font-mono text-sm"
              required
              value={form.address}
              onChange={(event) =>
                setForm({ ...form, address: event.target.value })
              }
              placeholder="0x..."
            />
          </div>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              className="input min-h-24 resize-y"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              placeholder="Strategy, purpose, or reminders"
            />
          </div>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                setForm({ ...form, enabled: event.target.checked })
              }
            />
            Enabled in portfolio refresh
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={saving} type="submit">
              {editingId ? <Save size={16} /> : <Plus size={16} />}
              {editingId ? "Save account" : "Add account"}
            </button>
            {editingId ? (
              <button
                className="button-secondary"
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                <X size={16} />
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Accounts</h2>
          <p>Named addresses included in portfolio snapshots.</p>
        </div>

        {loading ? (
          <p className="py-8 text-sm text-[#69706c]">Loading accounts...</p>
        ) : null}

        {!loading && !accounts.length ? (
          <div className="empty-state">
            <Plus size={28} aria-hidden="true" />
            <div>
              <h2>No accounts yet</h2>
              <p>Add your first read-only address to begin tracking.</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3">
          {accounts.map((account) => (
            <article className="account-row" key={account.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3>{account.label}</h3>
                  <span className="tag">{sourceLabel(account.source)}</span>
                  {account.enabled ? (
                    <span className="tag tag-green">
                      <Check size={13} /> Enabled
                    </span>
                  ) : (
                    <span className="tag">Disabled</span>
                  )}
                </div>
                <p className="mt-2 break-all font-mono text-xs text-[#626966]">
                  {account.address}
                </p>
                {account.notes ? (
                  <p className="mt-2 text-sm text-[#69706c]">{account.notes}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="icon-button"
                  aria-label={`Edit ${account.label}`}
                  onClick={() => editAccount(account)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Delete ${account.label}`}
                  onClick={() => removeAccount(account.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function sourceLabel(source: AccountSource) {
  return source === "aave" ? "Aave Ethereum" : "Hyperliquid";
}
