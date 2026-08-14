import { describe, expect, it } from "vitest";

import { calculateJournalTradePnlSummary } from "@/lib/journal-pnl";
import type { HyperliquidFilledOrder } from "@/lib/types";

const baseOrder: HyperliquidFilledOrder = {
  id: "order-1",
  accountId: "account-1",
  accountLabel: "Hyperliquid",
  coin: "BTC",
  side: "Buy",
  direction: "Open Long",
  averagePrice: 100,
  totalSize: 1,
  notionalUsd: 100,
  fee: null,
  feeToken: null,
  closedPnl: null,
  firstTime: 1,
  lastTime: 1,
  orderId: 1,
  fillCount: 1,
};

describe("journal PnL", () => {
  it("sums closed PnL, notional, orders, and fills", () => {
    expect(
      calculateJournalTradePnlSummary([
        { ...baseOrder, id: "order-1", closedPnl: 12.345, fillCount: 2 },
        {
          ...baseOrder,
          id: "order-2",
          closedPnl: -2.1,
          notionalUsd: 200.5,
          fillCount: 3,
        },
      ]),
    ).toEqual({
      pnlUsd: 10.25,
      pnlPercent: 3.41,
      realizedPnlUsd: 10.25,
      unrealizedPnlUsd: null,
      positionValueUsd: 0,
      orderCount: 2,
      fillCount: 5,
      notionalUsd: 300.5,
    });
  });

  it("returns null PnL when Hyperliquid has no closed PnL values", () => {
    expect(
      calculateJournalTradePnlSummary([
        { ...baseOrder, id: "order-1", closedPnl: null },
      ]),
    ).toMatchObject({
      pnlUsd: null,
      pnlPercent: null,
      realizedPnlUsd: null,
      unrealizedPnlUsd: null,
      positionValueUsd: 0,
      orderCount: 1,
      fillCount: 1,
      notionalUsd: 100,
    });
  });

  it("adds unrealized PnL to trade PnL for unfinished trades", () => {
    expect(
      calculateJournalTradePnlSummary(
        [{ ...baseOrder, id: "order-1", closedPnl: 12.34 }],
        100.1,
        5000.5,
        false,
      ),
    ).toMatchObject({
      pnlUsd: 112.44,
      pnlPercent: 112.44,
      realizedPnlUsd: 12.34,
      unrealizedPnlUsd: 100.1,
      positionValueUsd: 5000.5,
    });
  });

  it("uses unrealized PnL when there is no realized trade PnL", () => {
    expect(
      calculateJournalTradePnlSummary([baseOrder], -25.5, null, false),
    ).toMatchObject({
      pnlUsd: -25.5,
      pnlPercent: -25.5,
      realizedPnlUsd: null,
      unrealizedPnlUsd: -25.5,
      positionValueUsd: 0,
    });
  });

  it("uses all order PnL for finished trades", () => {
    expect(
      calculateJournalTradePnlSummary(
        [
          { ...baseOrder, id: "order-1", closedPnl: 12.34 },
          { ...baseOrder, id: "order-2", closedPnl: -2.1 },
        ],
        100.1,
        5000.5,
        true,
      ),
    ).toMatchObject({
      pnlUsd: 10.24,
      pnlPercent: 5.12,
      realizedPnlUsd: 10.24,
    });
  });
});
