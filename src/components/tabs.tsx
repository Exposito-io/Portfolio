"use client";

import { KeyboardEvent, ReactNode, useId, useRef, useState } from "react";

type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
};

export function Tabs({
  items,
  ariaLabel,
  initialTabId,
}: {
  items: TabItem[];
  ariaLabel: string;
  initialTabId?: string;
}) {
  const id = useId();
  const [activeTab, setActiveTab] = useState(initialTabId ?? items[0]?.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (tabIndex + 1) % items.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (tabIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    setActiveTab(items[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="tabs">
      <div aria-label={ariaLabel} className="tab-list" role="tablist">
        {items.map((tab, index) => (
          <button
            aria-controls={`${id}-${tab.id}-panel`}
            aria-selected={activeTab === tab.id}
            className="tab"
            id={`${id}-${tab.id}-tab`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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

      {items.map((tab) => (
        <div
          aria-labelledby={`${id}-${tab.id}-tab`}
          className="tab-panel"
          hidden={activeTab !== tab.id}
          id={`${id}-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
