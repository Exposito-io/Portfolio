"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

type JournalDetailTab = "charts" | "journal" | "transactions" | "news";

const tabs: { id: JournalDetailTab; label: string }[] = [
  { id: "charts", label: "Charts" },
  { id: "journal", label: "Journal" },
  { id: "transactions", label: "Transactions" },
  { id: "news", label: "News" },
];

export function JournalDetailTabs({
  charts,
  journal,
  transactions,
  news,
}: {
  charts: ReactNode;
  journal: ReactNode;
  transactions: ReactNode;
  news: ReactNode;
}) {
  const id = useId();
  const [activeTab, setActiveTab] = useState<JournalDetailTab>("charts");
  const [newsMounted, setNewsMounted] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectTab(tab: JournalDetailTab) {
    if (tab === "news") setNewsMounted(true);
    setActiveTab(tab);
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
            aria-selected={activeTab === tab.id}
            className="journal-detail-tab"
            id={`${id}-${tab.id}-tab`}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`${id}-charts-tab`}
        className="journal-detail-tab-panel"
        hidden={activeTab !== "charts"}
        id={`${id}-charts-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {charts}
      </div>
      <div
        aria-labelledby={`${id}-journal-tab`}
        className="journal-detail-tab-panel"
        hidden={activeTab !== "journal"}
        id={`${id}-journal-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {journal}
      </div>
      <div
        aria-labelledby={`${id}-transactions-tab`}
        className="journal-detail-tab-panel"
        hidden={activeTab !== "transactions"}
        id={`${id}-transactions-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {transactions}
      </div>
      <div
        aria-labelledby={`${id}-news-tab`}
        className="journal-detail-tab-panel journal-detail-news"
        hidden={activeTab !== "news"}
        id={`${id}-news-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {newsMounted ? news : null}
      </div>
    </section>
  );
}
