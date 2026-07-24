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
      realizedPnlUsd: 10.25,
      unrealizedPnlUsd: null,
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
      realizedPnlUsd: null,
      unrealizedPnlUsd: null,
      orderCount: 1,
      fillCount: 1,
      notionalUsd: 100,
    });
  });

  it("adds unrealized PnL for open trades", () => {
    expect(
      calculateJournalTradePnlSummary(
        [{ ...baseOrder, id: "order-1", closedPnl: 12.34 }],
        100.1,
      ),
    ).toMatchObject({
      pnlUsd: 112.44,
      realizedPnlUsd: 12.34,
      unrealizedPnlUsd: 100.1,
    });
  });
});
