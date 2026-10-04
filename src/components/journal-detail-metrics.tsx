"use client";

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BarChart3,
  ChevronDown,
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import {
  DefiLlamaEmbedError,
  parseDefiLlamaEmbedInput,
} from "@/lib/journal-metrics";
import type { JournalMetricEmbed, JournalTrade } from "@/lib/types";

export function JournalDetailMetrics({
  trade,
  saving,
  onSave,
}: {
  trade: JournalTrade;
  saving: boolean;
  onSave: (
    metricsMarkdown: string,
    metricsEmbeds: JournalMetricEmbed[],
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trade.metricsMarkdown);
  const [draftEmbeds, setDraftEmbeds] = useState(trade.metricsEmbeds);
  const [defiLlamaDialogOpen, setDefiLlamaDialogOpen] = useState(false);

  function beginEdit() {
    setDraft(trade.metricsMarkdown);
    setDraftEmbeds(trade.metricsEmbeds);
    setEditing(true);
  }

  async function addDefiLlamaMetric(embed: JournalMetricEmbed) {
    await onSave(trade.metricsMarkdown, [...trade.metricsEmbeds, embed]);
    setDefiLlamaDialogOpen(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await onSave(draft, draftEmbeds);
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
          <div className="journal-metric-actions">
            <AddMetricMenu
              disabled={saving || trade.metricsEmbeds.length >= 8}
              onSelectDefiLlama={() => setDefiLlamaDialogOpen(true)}
            />
            <button
              aria-label="Edit metrics"
              className="icon-button"
              onClick={beginEdit}
              type="button"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </div>
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
          {draftEmbeds.length ? (
            <div className="journal-metric-embed-manager">
              <div>
                <span className="field-label">Embedded charts</span>
                <p>Remove charts here, then save your metric changes.</p>
              </div>
              <ul className="journal-metric-embed-draft-list">
                {draftEmbeds.map((embed, index) => (
                  <li key={embed.id}>
                    <div>
                      <strong>{embed.name || `DefiLlama chart ${index + 1}`}</strong>
                      <span>{embed.url}</span>
                    </div>
                    <button
                      aria-label={`Remove ${embed.name || `DefiLlama chart ${index + 1}`}`}
                      className="icon-button"
                      type="button"
                      onClick={() =>
                        setDraftEmbeds((current) =>
                          current.filter((item) => item.id !== embed.id),
                        )
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
        <div className="journal-metrics-content mt-4">
          {trade.metricsMarkdown.trim() ? (
            <MarkdownView value={trade.metricsMarkdown} />
          ) : null}
          <MetricEmbeds embeds={trade.metricsEmbeds} />
          {!trade.metricsMarkdown.trim() && !trade.metricsEmbeds.length ? (
            <p className="text-sm text-[#737a76]">No metrics yet.</p>
          ) : null}
        </div>
      )}
      {defiLlamaDialogOpen ? (
        <DefiLlamaMetricDialog
          existingEmbeds={trade.metricsEmbeds}
          saving={saving}
          onAdd={addDefiLlamaMetric}
          onClose={() => setDefiLlamaDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}

function AddMetricMenu({
  disabled,
  onSelectDefiLlama,
}: {
  disabled: boolean;
  onSelectDefiLlama: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const optionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeMenu(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        containerRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
      if (event instanceof KeyboardEvent) toggleRef.current?.focus();
    }

    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [open]);

  function openAndFocusOption() {
    setOpen(true);
    window.requestAnimationFrame(() => optionRef.current?.focus());
  }

  function handleToggleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openAndFocusOption();
  }

  return (
    <div className="journal-add-metric-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="button-secondary journal-add-metric-toggle"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleToggleKeyDown}
        ref={toggleRef}
        type="button"
      >
        <Plus size={16} aria-hidden="true" />
        Add metric
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="journal-add-metric-options" role="menu">
          <button
            onClick={() => {
              setOpen(false);
              onSelectDefiLlama();
            }}
            ref={optionRef}
            role="menuitem"
            type="button"
          >
            <BarChart3 size={16} aria-hidden="true" />
            <span>
              <strong>DefiLlama chart</strong>
              <small>Embed a chart from DefiLlama</small>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DefiLlamaMetricDialog({
  existingEmbeds,
  saving,
  onAdd,
  onClose,
}: {
  existingEmbeds: JournalMetricEmbed[];
  saving: boolean;
  onAdd: (embed: JournalMetricEmbed) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [embedInput, setEmbedInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const parsed = parseDefiLlamaEmbedInput(embedInput);
      if (existingEmbeds.some((item) => item.url === parsed.url)) {
        throw new DefiLlamaEmbedError("That DefiLlama chart is already added.");
      }
      const customName = name.trim() || parsed.name;
      await onAdd({
        ...parsed,
        id: crypto.randomUUID(),
        ...(customName ? { name: customName } : {}),
      });
    } catch (submitError) {
      setError(
        submitError instanceof DefiLlamaEmbedError
          ? submitError.message
          : submitError instanceof Error
            ? submitError.message
            : "Unable to add that DefiLlama chart.",
      );
    }
  }

  return (
    <div
      className="journal-modal-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        aria-labelledby="defillama-metric-dialog-title"
        aria-modal="true"
        className="journal-modal journal-metric-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="journal-modal-header">
          <div>
            <p>Add metric</p>
            <h2 id="defillama-metric-dialog-title">DefiLlama chart</h2>
          </div>
          <button
            aria-label="Close DefiLlama chart dialog"
            className="icon-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form className="journal-modal-body grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="defillama-metric-name">
              Chart name <span className="field-optional">Optional</span>
            </label>
            <input
              autoFocus
              className="input"
              id="defillama-metric-name"
              maxLength={100}
              placeholder="Ethereum TVL"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <label className="field-label" htmlFor="defillama-metric-embed">
              Chart URL or iframe code
            </label>
            <textarea
              aria-describedby={error ? "defillama-metric-error" : undefined}
              className="input journal-metric-embed-input"
              id="defillama-metric-embed"
              placeholder={'https://defillama.com/... or <iframe src="https://defillama.com/...">'}
              required
              value={embedInput}
              onChange={(event) => setEmbedInput(event.target.value)}
            />
            <p className="text-xs text-[#69706c]">
              Paste the chart URL or the iframe code copied from DefiLlama.
            </p>
          </div>
          {error ? (
            <div className="alert alert-error" id="defillama-metric-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={saving} type="submit">
              <Plus size={16} aria-hidden="true" />
              {saving ? "Adding…" : "Add chart"}
            </button>
            <button
              className="button-secondary"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MetricEmbeds({ embeds }: { embeds: JournalMetricEmbed[] }) {
  if (!embeds.length) return null;

  return (
    <div className="journal-metric-embed-grid">
      {embeds.map((embed, index) => {
        const title = embed.name || `DefiLlama chart ${index + 1}`;
        return (
          <article className="journal-metric-embed-card" key={embed.id}>
            <div className="journal-metric-embed-heading">
              <div>
                <span>DefiLlama</span>
                <strong>{title}</strong>
              </div>
              <a href={embed.url} rel="noreferrer" target="_blank">
                Open
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
            <iframe
              allow="clipboard-write"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-popups allow-same-origin allow-scripts"
              src={embed.url}
              title={title}
            />
          </article>
        );
      })}
    </div>
  );
}
