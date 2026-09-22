"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Layers3, Plus, Trash2, X } from "lucide-react";

import { JournalTemplatePicker } from "@/components/journal-template-picker";
import { JournalTradeForm, type TradeFormPayload } from "@/components/journal-trade-form";
import { MarkdownEditor } from "@/components/markdown-editor";
import type { JournalTrade, JournalTradeAsset, JournalTradeGroup, JournalTradeKind } from "@/lib/types";

type NewGroupTrade = {
  clientId: string;
  trade: TradeFormPayload;
};

export type JournalGroupFormPayload = {
  kind: JournalTradeKind;
  title: string;
  descriptionMarkdown: string;
  metricsMarkdown: string;
  primaryTradeId: string;
  memberTradeIds: string[];
  tradingViewCharts: JournalTradeGroup["tradingViewCharts"];
  newTrades?: NewGroupTrade[];
};

export function JournalGroupDialog({
  error,
  saving,
  trades,
  markets = [],
  openPositionMarketKeys = [],
  group,
  onClose,
  onSubmit,
}: {
  error: string;
  saving: boolean;
  trades: JournalTrade[];
  markets?: JournalTradeAsset[];
  openPositionMarketKeys?: string[];
  group?: JournalTradeGroup;
  onClose: () => void;
  onSubmit: (payload: JournalGroupFormPayload) => Promise<void>;
}) {
  const availableKinds = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.kind))),
    [trades],
  );
  const [kind, setKind] = useState<JournalTradeKind>(group?.kind ?? availableKinds[0] ?? "trade");
  const [title, setTitle] = useState(group?.title ?? "");
  const [descriptionMarkdown, setDescriptionMarkdown] = useState(group?.descriptionMarkdown ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => group?.members.map((member) => member.id) ?? []);
  const [primaryTradeId, setPrimaryTradeId] = useState(group?.primaryTradeId ?? "");
  const [newTrades, setNewTrades] = useState<NewGroupTrade[]>([]);
  const [newTradeFormOpen, setNewTradeFormOpen] = useState(false);
  const candidates = trades.filter((trade) => trade.kind === kind);
  const candidateCount = candidates.length + newTrades.length;

  function toggleTrade(tradeId: string) {
    setSelectedIds((current) => {
      const selected = current.includes(tradeId);
      const next = selected
        ? current.filter((id) => id !== tradeId)
        : [...current, tradeId];
      setPrimaryTradeId((primary) =>
        primary && next.includes(primary) ? primary : next[0] ?? "",
      );
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedIds.length < 2 || !primaryTradeId) return;
    await onSubmit({
      kind,
      title,
      descriptionMarkdown,
      metricsMarkdown: group?.metricsMarkdown ?? "",
      primaryTradeId,
      memberTradeIds: selectedIds,
      tradingViewCharts: group?.tradingViewCharts ?? [],
      ...(newTrades.length ? { newTrades } : {}),
    });
  }

  async function stageNewTrade(trade: TradeFormPayload) {
    const clientId = `new:${crypto.randomUUID()}`;
    setNewTrades((current) => [...current, { clientId, trade: { ...trade, kind } }]);
    setSelectedIds((current) => [...current, clientId]);
    setPrimaryTradeId((current) => current || clientId);
    setNewTradeFormOpen(false);
  }

  function removeNewTrade(clientId: string) {
    setNewTrades((current) => current.filter((item) => item.clientId !== clientId));
    setSelectedIds((current) => {
      const next = current.filter((id) => id !== clientId);
      setPrimaryTradeId((primary) => primary === clientId ? next[0] ?? "" : primary);
      return next;
    });
  }

  return (
    <div className="journal-modal-backdrop" onClick={onClose}>
      <div
        aria-labelledby="journal-group-modal-title"
        aria-modal="true"
        className="journal-modal journal-group-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="journal-modal-header">
          <div>
            <p>{group ? "Manage composition" : "Compose journal items"}</p>
            <h2 id="journal-group-modal-title">{group ? "Edit grouped thesis" : "New grouped thesis"}</h2>
          </div>
          <button className="icon-button" aria-label="Close group form" onClick={onClose} type="button">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {newTradeFormOpen ? (
          <div className="journal-modal-body grid gap-4">
            <div>
              <p className="field-label">New group position</p>
              <p className="text-xs text-[#69706c]">
                This journal item is created only when the group is saved.
              </p>
            </div>
            <JournalTradeForm
              markets={markets}
              openPositionMarketKeys={openPositionMarketKeys}
              saving={saving}
              submitLabel="Add to group"
              onCancel={() => setNewTradeFormOpen(false)}
              onSubmit={stageNewTrade}
            />
          </div>
        ) : (
        <form className="journal-modal-body grid gap-5" onSubmit={submit}>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <div className="grid gap-2">
            <label className="field-label" htmlFor="group-title">Thesis title</label>
            <input
              className="input"
              id="group-title"
              placeholder="Hyperscalers"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="field-label">Journal type</legend>
            <div className="flex gap-4">
              {(["trade", "idea"] as const).map((option) => (
                <label className="flex items-center gap-2 text-sm capitalize" key={option}>
                  <input
                    checked={kind === option}
                    disabled={Boolean(group)}
                    name="group-kind"
                    type="radio"
                    onChange={() => {
                      setKind(option);
                      setSelectedIds([]);
                      setPrimaryTradeId("");
                      setNewTrades([]);
                    }}
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="field-label">Positions</legend>
            <p className="text-xs text-[#69706c]">Select 2–12 standalone journal items. Choose one lead ticker.</p>
            <div className="journal-group-member-list">
              {candidates.map((trade) => {
                const selected = selectedIds.includes(trade.id);
                return (
                  <div className={`journal-group-member${selected ? " selected" : ""}`} key={trade.id}>
                    <label>
                      <input checked={selected} type="checkbox" onChange={() => toggleTrade(trade.id)} />
                      <span><strong>{trade.asset.coin}</strong><small>{trade.title}</small></span>
                    </label>
                    {selected ? (
                      <label className="journal-group-primary">
                        <input
                          checked={primaryTradeId === trade.id}
                          name="primary-trade"
                          type="radio"
                          onChange={() => setPrimaryTradeId(trade.id)}
                        />
                        Lead
                      </label>
                    ) : null}
                  </div>
                );
              })}
              {newTrades.map(({ clientId, trade }) => (
                <div className="journal-group-member selected" key={clientId}>
                  <label>
                    <input checked readOnly type="checkbox" />
                    <span><strong>{trade.asset.coin}</strong><small>{trade.title} · new</small></span>
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="journal-group-primary">
                      <input checked={primaryTradeId === clientId} name="primary-trade" type="radio" onChange={() => setPrimaryTradeId(clientId)} />
                      Lead
                    </label>
                    <button aria-label={`Remove new ${trade.asset.coin} position`} className="icon-button danger" onClick={() => removeNewTrade(clientId)} type="button">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {!candidateCount ? (
                <p className="p-3 text-sm text-[#69706c]">Select “New position” to build this group from scratch.</p>
              ) : null}
            </div>
            {!group ? (
              <button className="button-secondary w-fit" disabled={saving || selectedIds.length >= 12} onClick={() => setNewTradeFormOpen(true)} type="button">
                <Plus size={15} />New position
              </button>
            ) : null}
          </fieldset>
          <JournalTemplatePicker
            descriptionMarkdown={descriptionMarkdown}
            disabled={saving}
            onInsert={setDescriptionMarkdown}
          />
          <MarkdownEditor
            id="group-description"
            label="Shared thesis"
            value={descriptionMarkdown}
            onChange={setDescriptionMarkdown}
          />
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={saving || selectedIds.length < 2} type="submit">
              <Layers3 size={16} aria-hidden="true" />
              {group ? "Save group" : "Create group"}
            </button>
            <button className="button-secondary" disabled={saving} onClick={onClose} type="button">
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
