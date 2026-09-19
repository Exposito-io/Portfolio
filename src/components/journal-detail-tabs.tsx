"use client";

import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";

import { useJournalNews } from "@/components/journal-news-context";

export type JournalDetailTab =
  | "charts"
  | "journal"
  | "metrics"
  | "documents"
  | "transactions"
  | "news";

const tabs: { id: JournalDetailTab; label: string }[] = [
  { id: "charts", label: "Charts" },
  { id: "journal", label: "Journal" },
  { id: "metrics", label: "Metrics" },
  { id: "documents", label: "Documents" },
  { id: "transactions", label: "Transactions" },
  { id: "news", label: "News" },
];

export function JournalDetailTabs({
  charts,
  journal,
  metrics,
  documents,
  transactions,
  news,
  activeTab,
  onTabChange,
  documentCount = 0,
  newsUnreadCount = 0,
}: {
  charts: ReactNode;
  journal: ReactNode;
  metrics: ReactNode;
  documents: ReactNode;
  transactions: ReactNode;
  news: ReactNode;
  activeTab?: JournalDetailTab;
  onTabChange?: (tab: JournalDetailTab) => void;
  documentCount?: number;
  newsUnreadCount?: number;
}) {
  const id = useId();
  const [internalActiveTab, setInternalActiveTab] =
    useState<JournalDetailTab>("charts");
  const selectedTab = activeTab ?? internalActiveTab;
  const [documentsMounted, setDocumentsMounted] = useState(
    selectedTab === "documents",
  );
  const [newsMounted, setNewsMounted] = useState(selectedTab === "news");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectTab(tab: JournalDetailTab) {
    if (tab === "documents") setDocumentsMounted(true);
    if (tab === "news") setNewsMounted(true);
    if (activeTab === undefined) setInternalActiveTab(tab);
    onTabChange?.(tab);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (tabIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="journal-detail-tabs">
      <div
        aria-label="Journal detail sections"
        className="journal-detail-tab-list"
        role="tablist"
      >
        {tabs.map((tab, index) => (
          <button
            aria-controls={`${id}-${tab.id}-panel`}
            aria-label={getTabAriaLabel(tab, documentCount, newsUnreadCount)}
            aria-selected={selectedTab === tab.id}
            className="journal-detail-tab"
            id={`${id}-${tab.id}-tab`}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={selectedTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.id === "documents" && documentCount > 0 ? (
              <span aria-hidden="true" className="journal-detail-tab-badge">
                {documentCount > 99 ? "99+" : documentCount}
              </span>
            ) : null}
            {tab.id === "news" && newsUnreadCount > 0 ? (
              <span aria-hidden="true" className="journal-detail-tab-badge">
                {newsUnreadCount > 99 ? "99+" : newsUnreadCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`${id}-charts-tab`}
        className="journal-detail-tab-panel"
        hidden={selectedTab !== "charts"}
        id={`${id}-charts-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {charts}
      </div>
      <div
        aria-labelledby={`${id}-journal-tab`}
        className="journal-detail-tab-panel"
        hidden={selectedTab !== "journal"}
        id={`${id}-journal-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {journal}
      </div>
      <div
        aria-labelledby={`${id}-metrics-tab`}
        className="journal-detail-tab-panel"
        hidden={selectedTab !== "metrics"}
        id={`${id}-metrics-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {metrics}
      </div>
      <div
        aria-labelledby={`${id}-documents-tab`}
        className="journal-detail-tab-panel"
        hidden={selectedTab !== "documents"}
        id={`${id}-documents-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {documentsMounted || selectedTab === "documents" ? documents : null}
      </div>
      <div
        aria-labelledby={`${id}-transactions-tab`}
        className="journal-detail-tab-panel"
        hidden={selectedTab !== "transactions"}
        id={`${id}-transactions-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {transactions}
      </div>
      <div
        aria-labelledby={`${id}-news-tab`}
        className="journal-detail-tab-panel journal-detail-news"
        hidden={selectedTab !== "news"}
        id={`${id}-news-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {newsMounted || selectedTab === "news" ? news : null}
      </div>
    </section>
  );
}

function getTabAriaLabel(
  tab: (typeof tabs)[number],
  documentCount: number,
  newsUnreadCount: number,
) {
  if (tab.id === "documents" && documentCount > 0) {
    return `Documents, ${documentCount} ${documentCount === 1 ? "document" : "documents"}`;
  }
  if (tab.id === "news" && newsUnreadCount > 0) {
    return `News, ${newsUnreadCount} unread ${newsUnreadCount === 1 ? "article" : "articles"}`;
  }
  return undefined;
}

export function JournalDetailTabsWithNewsCount({
  tradeId,
  ...props
}: Omit<ComponentProps<typeof JournalDetailTabs>, "newsUnreadCount"> & {
  tradeId: string;
}) {
  const { news } = useJournalNews(tradeId);

  return <JournalDetailTabs {...props} newsUnreadCount={news?.items.length ?? 0} />;
}
