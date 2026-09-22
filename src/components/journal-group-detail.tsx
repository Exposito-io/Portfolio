"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Layers3, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { FilledOrdersTable } from "@/components/filled-orders-table";
import { JournalGroupDialog, type JournalGroupFormPayload } from "@/components/journal-group-dialog";
import { JournalTradeForm, type TradeFormPayload } from "@/components/journal-trade-form";
import { JournalChart } from "@/components/journal-chart";
import { JournalDetailMetrics } from "@/components/journal-detail-metrics";
import { JournalDetailTabs } from "@/components/journal-detail-tabs";
import type { JournalDetailTab } from "@/components/journal-detail-tabs";
import { JournalPnlMetric, JournalPositionValueMetric } from "@/components/journal-pnl-badge";
import { JournalNews } from "@/components/journal-news";
import { JournalNewsProvider } from "@/components/journal-news-context";
import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import { useJournalGroupOrders } from "@/components/use-journal-group-orders";
import type { FilledOrdersState } from "@/components/use-journal-filled-orders";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { formatJournalDateTimeKey, getDateTimeKey } from "@/lib/date";
import { calculateCumulativeRealizedPnlByOrder } from "@/lib/journal-pnl";
import type {
  HyperliquidFilledOrder,
  JournalTrade,
  JournalTradeAsset,
  JournalTradeGroup,
  JournalTradeGroupEntry,
  JournalItem,
  PortfolioResponse,
} from "@/lib/types";

const JournalDocuments = dynamic(
  () => import("@/components/journal-documents").then((module) => module.JournalDocuments),
  { loading: () => <p className="journal-documents-status">Loading documents…</p> },
);

type GroupEntryDraft = {
  date: string;
  tags: string;
  descriptionMarkdown: string;
  tradeIds: string[];
};

export function JournalGroupDetail({
  groupId,
  initialTab = "charts",
  initialDocumentId,
}: {
  groupId: string;
  initialTab?: JournalDetailTab;
  initialDocumentId?: string | null;
}) {
  const [group, setGroup] = useState<JournalTradeGroup | null>(null);
  const [markets, setMarkets] = useState<JournalTradeAsset[]>([]);
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState({ title: "", descriptionMarkdown: "" });
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [closingTradeIds, setClosingTradeIds] = useState<string[]>([]);
  const [entryDraft, setEntryDraft] = useState<GroupEntryDraft>(createEntryDraft);
  const [activeTab, setActiveTab] = useState<JournalDetailTab>(initialTab);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(initialDocumentId ?? null);
  const [manageOpen, setManageOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [availableTrades, setAvailableTrades] = useState<JournalTrade[]>([]);
  const orders = useJournalGroupOrders(group?.members ?? []);

  const loadGroup = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/groups/${groupId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load journal group.");
      setGroup(payload.group);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load journal group.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadGroup(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadGroup]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/hyperliquid/markets", { signal: controller.signal }).then(async (response) => {
        const payload = await response.json();
        if (response.ok) setMarkets(payload.markets);
      }),
      fetch("/api/portfolio", { signal: controller.signal }).then(async (response) => {
        const payload = await response.json() as PortfolioResponse;
        if (response.ok) setPortfolioValue(payload.snapshot?.totals.totalInvestmentsUsd ?? null);
      }),
    ]).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const primaryTrade = group
    ? group.members.find((member) => member.id === group.primaryTradeId) ?? group.members[0]
    : null;
  const primaryOrdersState = primaryTrade
    ? orders.byTradeId[primaryTrade.id] ?? emptyOrdersState(primaryTrade.kind)
    : emptyOrdersState("idea");
  const combinedOrders = useMemo(
    () => group
      ? group.members.flatMap((member) => orders.byTradeId[member.id]?.data?.orders ?? []).sort((a, b) => b.lastTime - a.lastTime)
      : [],
    [group, orders.byTradeId],
  );
  const cumulativePnl = useMemo(
    () => calculateCumulativeRealizedPnlByOrder(combinedOrders),
    [combinedOrders],
  );

  if (loading) return <main className="w-full px-4 py-6 text-sm text-[#69706c]">Loading grouped journal…</main>;
  if (!group || !primaryTrade) {
    return (
      <main className="w-full px-4 py-6">
        {error ? <div className="alert alert-error">{error}</div> : null}
        <Link className="button-secondary mt-3 w-fit" href="/journal"><ArrowLeft size={16} />Journal</Link>
      </main>
    );
  }

  const displayTrade: JournalTrade = {
    ...primaryTrade,
    title: group.title,
    descriptionMarkdown: group.descriptionMarkdown,
    metricsMarkdown: group.metricsMarkdown,
    startDate: group.startDate,
    endDate: group.endDate,
    tradingViewCharts: group.tradingViewCharts,
  };

  async function patchGroup(payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save group.");
      setGroup(result.group);
      return result.group as JournalTradeGroup;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save group.");
      throw saveError;
    } finally {
      setSaving(false);
    }
  }

  async function saveSummary(event: FormEvent) {
    event.preventDefault();
    await patchGroup(summaryDraft);
    setEditingSummary(false);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const closing = closingTradeIds.length > 0;
      const response = await fetch(
        closing ? `/api/journal/groups/${groupId}/close` : `/api/journal/groups/${groupId}/entries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: entryDraft.date,
            tags: entryDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            descriptionMarkdown: entryDraft.descriptionMarkdown,
            tradeIds: closing ? closingTradeIds : entryDraft.tradeIds,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save entry.");
      setGroup(payload.group);
      setEntryDialogOpen(false);
      setClosingTradeIds([]);
      setEntryDraft(createEntryDraft());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save entry.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: JournalTradeGroupEntry) {
    if (!window.confirm("Delete this group entry?")) return;
    const response = await fetch(`/api/journal/groups/${groupId}/entries/${entry.id}`, { method: "DELETE" });
    const payload = await response.json();
    if (response.ok) setGroup(payload.group);
    else setError(payload.error || "Unable to delete entry.");
  }

  function openEntry(tradeIds: string[] = []) {
    setClosingTradeIds([]);
    setEntryDraft({ ...createEntryDraft(), tradeIds });
    setEntryDialogOpen(true);
  }

  function openClose(tradeIds: string[]) {
    setClosingTradeIds(tradeIds);
    setEntryDraft({ ...createEntryDraft(), tags: "post-mortem", tradeIds });
    setEntryDialogOpen(true);
  }

  async function openManage() {
    if (!group) return;
    setError("");
    try {
      const response = await fetch("/api/journal/items");
      const payload = await response.json() as { items?: JournalItem[]; error?: string };
      if (!response.ok || !payload.items) throw new Error(payload.error || "Unable to load journal items.");
      const standalone = payload.items
        .filter((item): item is Extract<JournalItem, { itemType: "trade" }> => item.itemType === "trade")
        .map((item) => item.trade);
      setAvailableTrades(Array.from(new Map([...group.members, ...standalone].map((trade) => [trade.id, trade])).values()));
      setManageOpen(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load journal items.");
    }
  }

  async function saveMembership(payload: JournalGroupFormPayload) {
    await patchGroup(payload);
    setManageOpen(false);
  }

  async function ungroup() {
    if (!window.confirm("Ungroup this thesis? Member journal items will be preserved, but shared group content and documents will be deleted.")) return;
    setSaving(true);
    const response = await fetch(`/api/journal/groups/${groupId}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "Unable to ungroup journal items.");
      setSaving(false);
      return;
    }
    window.location.assign("/journal");
  }

  async function createMember(payload: TradeFormPayload) {
    if (!group) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/journal/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade: { ...payload, kind: group.kind }, makePrimary: false }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to add position.");
      setGroup(result.group);
      setAddMemberOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add position.");
    } finally {
      setSaving(false);
    }
  }

  const openMembers = group.members.filter((member) => !member.endDate);

  return (
    <main className="journal-group-page flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="journal-detail-topbar">
        <Link className="button-secondary w-fit" href="/journal"><ArrowLeft size={16} />Journal</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className={group.endDate ? "tag" : "tag tag-green"}>{group.endDate ? "Closed" : `${openMembers.length} open`}</span>
          <span className="tag">{group.members.length} positions</span>
          <button className="button-secondary" onClick={() => void openManage()} type="button"><Pencil size={15} />Manage</button>
          {group.members.length < 12 ? <button className="button-secondary" onClick={() => { setError(""); setAddMemberOpen(true); }} type="button"><Plus size={15} />New position</button> : null}
          {openMembers.length ? (
            <button className="button-secondary" onClick={() => openClose(openMembers.map((member) => member.id))} type="button">
              <Check size={16} />Close all
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <nav aria-label="Journal positions" className="journal-group-scope">
        <span className="active"><Layers3 size={15} />All</span>
        {group.members.map((member) => (
          <Link href={`/journal/${member.id}`} key={member.id}>
            {member.asset.coin}
            <small>{member.endDate ? "Closed" : "Open"}</small>
          </Link>
        ))}
      </nav>

      <section className="journal-detail-summary-grid">
        <div className="panel">
          {editingSummary ? (
            <form className="grid gap-4" onSubmit={saveSummary}>
              <div className="grid gap-2">
                <label className="field-label" htmlFor="group-detail-title">Title</label>
                <input className="input" id="group-detail-title" required value={summaryDraft.title} onChange={(event) => setSummaryDraft({ ...summaryDraft, title: event.target.value })} />
              </div>
              <MarkdownEditor id="group-detail-description" label="Shared thesis" value={summaryDraft.descriptionMarkdown} onChange={(descriptionMarkdown) => setSummaryDraft({ ...summaryDraft, descriptionMarkdown })} />
              <div className="flex gap-2"><button className="button-primary" disabled={saving} type="submit"><Save size={16} />Save</button><button className="button-secondary" onClick={() => setEditingSummary(false)} type="button"><X size={16} />Cancel</button></div>
            </form>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="panel-heading"><h1>{group.title}</h1><p>{formatJournalDateTimeKey(group.startDate, PORTFOLIO_TIMEZONE)}{group.endDate ? ` to ${formatJournalDateTimeKey(group.endDate, PORTFOLIO_TIMEZONE)}` : " to now"}</p></div>
                <button className="icon-button" aria-label="Edit grouped thesis" onClick={() => { setSummaryDraft({ title: group.title, descriptionMarkdown: group.descriptionMarkdown }); setEditingSummary(true); }} type="button"><Pencil size={16} /></button>
              </div>
              <div className="journal-trade-description mt-5"><MarkdownView emptyMessage="No shared thesis yet." value={group.descriptionMarkdown} /></div>
            </>
          )}
        </div>
        <aside className="journal-detail-metrics">
          {group.kind === "trade" ? (
            <>
              <JournalPositionValueMetric loading={orders.loading} error={orders.error} summary={orders.summary} portfolioInvestmentsUsd={portfolioValue} />
              <JournalPnlMetric loading={orders.loading} error={orders.error} summary={orders.summary} />
            </>
          ) : null}
          <section className="panel journal-group-position-summary">
            <span>Lead ticker</span><strong>{primaryTrade.asset.coin}</strong><small>{primaryTrade.asset.label}</small>
          </section>
        </aside>
      </section>

      <section className="journal-group-positions" aria-label="Positions">
        {group.members.map((member) => {
          const state = orders.byTradeId[member.id];
          return (
            <article className="panel journal-group-position-card" key={member.id}>
              <div><span className="journal-group-position-symbol">{member.asset.coin}</span><p>{member.title}</p></div>
              <div className="journal-group-position-meta"><span className="tag capitalize">{member.direction ?? "No direction"}</span><span className={member.endDate ? "tag" : "tag tag-green"}>{member.endDate ? "Closed" : "Open"}</span>{member.id === group.primaryTradeId ? <span className="tag">Lead</span> : null}</div>
              {group.kind === "trade" ? <JournalPnlMetric loading={state?.loading} error={state?.error} summary={state?.data?.summary} /> : null}
              <div className="flex flex-wrap gap-2"><Link className="button-secondary" href={`/journal/${member.id}`}>Open position</Link>{!member.endDate ? <button className="button-secondary" onClick={() => openClose([member.id])} type="button"><Check size={15} />Close</button> : null}</div>
            </article>
          );
        })}
      </section>

      <JournalDetailTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        charts={
          <JournalChart
            trade={displayTrade}
            markets={markets}
            ordersState={primaryOrdersState}
            onTradeChange={() => undefined}
            onSaveCharts={async (tradingViewCharts) => {
              const updated = await patchGroup({ tradingViewCharts });
              const nextPrimary = updated.members.find((member) => member.id === updated.primaryTradeId) ?? updated.members[0];
              return { ...nextPrimary, title: updated.title, descriptionMarkdown: updated.descriptionMarkdown, metricsMarkdown: updated.metricsMarkdown, startDate: updated.startDate, endDate: updated.endDate, tradingViewCharts: updated.tradingViewCharts };
            }}
          />
        }
        journal={<GroupTimeline group={group} orderLoading={orders.loading} onDelete={deleteEntry} onNew={openEntry} />}
        metrics={<JournalDetailMetrics trade={displayTrade} saving={saving} onSave={(metricsMarkdown) => patchGroup({ metricsMarkdown }).then(() => undefined)} />}
        documents={
          <JournalDocuments
            tradeId={group.id}
            apiBasePath={`/api/journal/groups/${group.id}/documents`}
            documentPathBase={`/journal/groups/${group.id}/documents`}
            selectedDocumentId={selectedDocumentId}
            onDocumentNavigate={(documentId, mode) => {
              setSelectedDocumentId(documentId);
              const path = documentId
                ? `/journal/groups/${group.id}/documents/${encodeURIComponent(documentId)}`
                : `/journal/groups/${group.id}/documents`;
              window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", path);
            }}
          />
        }
        transactions={group.kind === "trade" ? <GroupTransactions orders={combinedOrders} cumulativePnl={cumulativePnl} loading={orders.loading} error={orders.error} /> : null}
        news={
          <JournalNewsProvider
            tradeId={group.id}
            apiBasePath={`/api/journal/groups/${group.id}/news`}
          >
            <JournalNews
              tradeId={group.id}
              apiBasePath={`/api/journal/groups/${group.id}/news`}
            />
          </JournalNewsProvider>
        }
      />

      {entryDialogOpen ? (
        <GroupEntryDialog
          closing={closingTradeIds.length > 0}
          draft={entryDraft}
          error={error}
          group={group}
          saving={saving}
          onChange={setEntryDraft}
          onClose={() => { if (!saving) { setEntryDialogOpen(false); setClosingTradeIds([]); } }}
          onSubmit={saveEntry}
        />
      ) : null}
      {manageOpen ? (
        <JournalGroupDialog
          error={error}
          group={group}
          saving={saving}
          trades={availableTrades}
          onClose={() => { if (!saving) setManageOpen(false); }}
          onSubmit={saveMembership}
        />
      ) : null}
      {addMemberOpen ? (
        <div className="journal-modal-backdrop" onClick={() => { if (!saving) setAddMemberOpen(false); }}>
          <div className="journal-modal journal-trade-modal" role="dialog" aria-modal="true" aria-labelledby="group-new-position-title" onClick={(event) => event.stopPropagation()}>
            <div className="journal-modal-header"><div><p>{group.title}</p><h2 id="group-new-position-title">New position</h2></div><button className="icon-button" aria-label="Close position form" onClick={() => setAddMemberOpen(false)} type="button"><X size={16} /></button></div>
            <div className="journal-modal-body">{error ? <div className="alert alert-error">{error}</div> : null}<JournalTradeForm markets={markets} saving={saving} submitLabel="Add position" onCancel={() => setAddMemberOpen(false)} onSubmit={createMember} /></div>
          </div>
        </div>
      ) : null}
      <div className="flex justify-end">
        <button className="button-secondary text-[#9b3d30]" disabled={saving} onClick={() => void ungroup()} type="button"><Trash2 size={15} />Ungroup thesis</button>
      </div>
    </main>
  );
}

function GroupTimeline({
  group,
  orderLoading,
  onDelete,
  onNew,
}: {
  group: JournalTradeGroup;
  orderLoading: boolean;
  onDelete: (entry: JournalTradeGroupEntry) => void;
  onNew: (tradeIds?: string[]) => void;
}) {
  const memberById = new Map(group.members.map((member) => [member.id, member]));
  const entries = [
    ...group.entries.map((entry) => ({ scope: "group" as const, entry })),
    ...group.members.flatMap((member) => member.entries.map((entry) => ({ scope: "trade" as const, entry, member }))),
  ].sort((left, right) => new Date(right.entry.date).getTime() - new Date(left.entry.date).getTime());
  return (
    <section className="panel">
      <div className="panel-heading flex flex-wrap items-center justify-between gap-3"><div><h2>Shared timeline</h2><p>{entries.length} notes across this thesis</p></div><button className="button-primary" onClick={() => onNew()} type="button"><Plus size={16} />New group entry</button></div>
      <div className="mt-4 grid gap-3">
        {entries.map((item) => (
          <article className="entry-row" key={`${item.scope}:${item.entry.id}`}>
            <div className="entry-row-header">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="entry-row-date">{formatJournalDateTimeKey(item.entry.date, PORTFOLIO_TIMEZONE)}</p>{item.scope === "trade" ? <span className="tag">{item.member.asset.coin}</span> : item.entry.tradeIds.map((id) => <span className="tag" key={id}>{memberById.get(id)?.asset.coin ?? "Former member"}</span>)}{item.entry.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
              {item.scope === "group" ? <button className="icon-button danger" aria-label="Delete group entry" onClick={() => onDelete(item.entry)} type="button"><Trash2 size={16} /></button> : <Link className="button-secondary" href={`/journal/${item.member.id}`}>Open</Link>}
            </div>
            <MarkdownView value={item.entry.descriptionMarkdown} />
          </article>
        ))}
        {!entries.length ? <div className="empty-state"><Plus size={28} /><div><h2>No entries yet</h2><p>Add a shared update or write inside a member trade.</p></div></div> : null}
      </div>
      <span className="sr-only">{orderLoading ? "Orders loading" : "Orders loaded"}</span>
    </section>
  );
}

function GroupTransactions({ orders, cumulativePnl, loading, error }: { orders: HyperliquidFilledOrder[]; cumulativePnl: Map<string, number>; loading: boolean; error: string }) {
  const [positionFilter, setPositionFilter] = useState("all");
  const positions = Array.from(new Set(orders.map((order) => order.coin))).sort();
  const visibleOrders = positionFilter === "all"
    ? orders
    : orders.filter((order) => order.coin === positionFilter);

  return (
    <section className="panel">
      <div className="panel-heading"><h2>Combined transactions</h2><p>Orders from every member, sorted by most recent fill</p></div>
      {positions.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Transaction position filters">
          {["all", ...positions].map((position) => (
            <button
              className={positionFilter === position ? "tag tag-green" : "tag"}
              key={position}
              onClick={() => setPositionFilter(position)}
              type="button"
            >
              {position === "all" ? "All positions" : position}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="alert alert-warning mt-3">Partial results: {error}</div> : null}
      {loading ? (
        <p className="mt-4 text-sm text-[#69706c]">Loading transactions…</p>
      ) : visibleOrders.length ? (
        <FilledOrdersTable
          assetColumnLabel="Position"
          orders={visibleOrders}
          cumulativePnlByOrderId={cumulativePnl}
          showAccountAndAsset
        />
      ) : (
        <div className="empty-state mt-4"><div><h2>No filled orders</h2><p>No member orders matched this position and date range.</p></div></div>
      )}
    </section>
  );
}

function GroupEntryDialog({ closing, draft, error, group, saving, onChange, onClose, onSubmit }: { closing: boolean; draft: GroupEntryDraft; error: string; group: JournalTradeGroup; saving: boolean; onChange: (draft: GroupEntryDraft) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <div className="journal-modal-backdrop" onClick={onClose}><div className="journal-modal" role="dialog" aria-modal="true" aria-labelledby="group-entry-title" onClick={(event) => event.stopPropagation()}><div className="journal-modal-header"><div><p>{closing ? "Close positions" : "Shared timeline"}</p><h2 id="group-entry-title">{closing ? "Close selected positions" : "New group entry"}</h2></div><button className="icon-button" aria-label="Close entry dialog" onClick={onClose} type="button"><X size={16} /></button></div><form className="journal-modal-body grid gap-4" onSubmit={onSubmit}>{error ? <div className="alert alert-error">{error}</div> : null}<div className="grid gap-2"><label className="field-label" htmlFor="group-entry-date">{closing ? "Close date and time" : "Date and time"}</label><input className="input" id="group-entry-date" type="datetime-local" required value={draft.date} onChange={(event) => onChange({ ...draft, date: event.target.value })} /></div>{!closing ? <fieldset className="grid gap-2"><legend className="field-label">Linked positions (optional)</legend><div className="flex flex-wrap gap-3">{group.members.map((member) => <label className="flex items-center gap-2 text-sm" key={member.id}><input checked={draft.tradeIds.includes(member.id)} type="checkbox" onChange={() => onChange({ ...draft, tradeIds: draft.tradeIds.includes(member.id) ? draft.tradeIds.filter((id) => id !== member.id) : [...draft.tradeIds, member.id] })} />{member.asset.coin}</label>)}</div></fieldset> : null}<div className="grid gap-2"><label className="field-label" htmlFor="group-entry-tags">Tags</label><input className="input" id="group-entry-tags" placeholder="earnings, sizing" value={draft.tags} onChange={(event) => onChange({ ...draft, tags: event.target.value })} /></div><MarkdownEditor id="group-entry-description" label={closing ? "Post-mortem (optional)" : "Entry"} required={!closing} value={draft.descriptionMarkdown} onChange={(descriptionMarkdown) => onChange({ ...draft, descriptionMarkdown })} /><div className="flex gap-2"><button className="button-primary" disabled={saving} type="submit">{closing ? <Check size={16} /> : <Plus size={16} />}{closing ? "Close positions" : "Add entry"}</button><button className="button-secondary" onClick={onClose} type="button"><X size={16} />Cancel</button></div></form></div></div>;
}

function createEntryDraft(): GroupEntryDraft {
  return { date: getDateTimeKey(new Date(), PORTFOLIO_TIMEZONE), tags: "", descriptionMarkdown: "", tradeIds: [] };
}

function emptyOrdersState(kind: JournalTrade["kind"]): FilledOrdersState {
  return { data: null, error: "", loading: kind === "trade" };
}
