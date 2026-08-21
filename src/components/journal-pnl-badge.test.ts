import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JournalPnlMetric } from "@/components/journal-pnl-badge";
import type { JournalTradePnlSummary } from "@/lib/types";

const summary: JournalTradePnlSummary = {
  pnlUsd: 25,
  pnlPercent: 5,
  realizedPnlUsd: 25,
  unrealizedPnlUsd: null,
  entryPriceUsd: 100,
  positionValueUsd: 0,
  orderCount: 2,
  fillCount: 2,
  notionalUsd: 500,
};

describe("JournalPnlMetric", () => {
  it("hides unrealized PnL when there is no position", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, { summary }),
    );

    expect(markup).toContain("Transactions PnL");
    expect(markup).toContain("Total PnL");
    expect(markup).not.toContain("Unrealized PnL");
  });

  it("shows unrealized PnL when a position exists", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalPnlMetric, {
        summary: {
          ...summary,
          unrealizedPnlUsd: 10,
          positionValueUsd: 1_000,
        },
      }),
    );

    expect(markup).toContain("Unrealized PnL");
  });
});
