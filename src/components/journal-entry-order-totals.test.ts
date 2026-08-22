import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EntryOrderTotalsView,
  groupOrdersByDate,
  type EntryOrderTotals,
} from "@/components/journal-entry-order-totals";
import type { HyperliquidFilledOrder } from "@/lib/types";

const baseOrder: HyperliquidFilledOrder = {
  id: "order-1",
  accountId: "account-1",
  accountLabel: "Hyperliquid",
  coin: "BTC",
  side: "Buy",
  direction: "Open Long",
  averagePrice: 100,
  totalSize: 10,
  notionalUsd: 1_000,
  fee: null,
  feeToken: null,
  closedPnl: null,
  firstTime: Date.parse("2026-08-20T16:00:00Z"),
  lastTime: Date.parse("2026-08-20T16:00:00Z"),
  orderId: 1,
  fillCount: 1,
};

describe("groupOrdersByDate", () => {
  it("calculates daily position percentages and transaction PnL", () => {
    const totals = groupOrdersByDate(
      [
        baseOrder,
        {
          ...baseOrder,
          id: "order-2",
          totalSize: 5,
          notionalUsd: 550,
          firstTime: Date.parse("2026-08-21T14:00:00Z"),
          lastTime: Date.parse("2026-08-21T14:00:00Z"),
        },
        {
          ...baseOrder,
          id: "order-3",
          side: "Sell",
          direction: "Close Long",
          totalSize: 3,
          notionalUsd: 360,
          closedPnl: 60.345,
          firstTime: Date.parse("2026-08-22T15:00:00Z"),
          lastTime: Date.parse("2026-08-22T15:00:00Z"),
        },
        {
          ...baseOrder,
          id: "order-4",
          side: "Sell",
          direction: "Close Long",
          totalSize: 3,
          notionalUsd: 330,
          closedPnl: -15.1,
          firstTime: Date.parse("2026-08-22T16:00:00Z"),
          lastTime: Date.parse("2026-08-22T16:00:00Z"),
        },
      ],
      "America/Toronto",
    );

    expect(totals.get("2026-08-21")).toMatchObject({
      buyUsd: 550,
      buyCount: 1,
      buyPositionPercent: 33.33,
      pnlUsd: null,
    });
    expect(totals.get("2026-08-22")).toMatchObject({
      sellUsd: 690,
      sellCount: 2,
      sellPositionPercent: 40,
      pnlUsd: 45.25,
    });
  });

  it("measures a same-day round trip against the largest position held", () => {
    const totals = groupOrdersByDate(
      [
        baseOrder,
        {
          ...baseOrder,
          id: "order-2",
          side: "Sell",
          direction: "Close Long",
          closedPnl: 25,
          firstTime: Date.parse("2026-08-20T17:00:00Z"),
          lastTime: Date.parse("2026-08-20T17:00:00Z"),
        },
      ],
      "America/Toronto",
    ).get("2026-08-20");

    expect(totals).toMatchObject({
      buyPositionPercent: 100,
      sellPositionPercent: 100,
      pnlUsd: 25,
    });
  });
});

describe("EntryOrderTotalsView", () => {
  it("renders position percentages and signed transaction PnL", () => {
    const totals: EntryOrderTotals = {
      buyUsd: 550,
      sellUsd: 690,
      buyCount: 1,
      sellCount: 2,
      buyPositionPercent: 33.33,
      sellPositionPercent: 40,
      pnlUsd: -12.34,
    };

    const markup = renderToStaticMarkup(
      createElement(EntryOrderTotalsView, { loading: false, totals }),
    );

    expect(markup).toContain("Of position");
    expect(markup).toContain("33.33%");
    expect(markup).toContain("40%");
    expect(markup).toContain("Transactions PnL");
    expect(markup).toContain("-$12.34");
  });

  it("hides zero transaction PnL for buy-only days", () => {
    const totals: EntryOrderTotals = {
      buyUsd: 1_000,
      sellUsd: 0,
      buyCount: 1,
      sellCount: 0,
      buyPositionPercent: 100,
      sellPositionPercent: null,
      pnlUsd: 0,
    };

    const markup = renderToStaticMarkup(
      createElement(EntryOrderTotalsView, { loading: false, totals }),
    );

    expect(markup).not.toContain("Transactions PnL");
  });
});
