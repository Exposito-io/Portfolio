import { describe, expect, it } from "vitest";

import {
  calculateAnnualizedPnlPercent,
  calculateCumulativeRealizedPnlByOrder,
  calculateJournalTradeClosingPrice,
  calculateJournalTradeEntryPrice,
  calculateJournalTradePnlSummary,
} from "@/lib/journal-pnl";
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
  realizedPnlBasisUsd: null,
  firstTime: 1,
  lastTime: 1,
  orderId: 1,
  fillCount: 1,
};

describe("journal PnL", () => {
  it("annualizes PnL over the trade holding period", () => {
    const dayMs = 24 * 60 * 60 * 1000;

    expect(calculateAnnualizedPnlPercent(10, 0, 73 * dayMs)).toBeCloseTo(50);
  });

  it("does not annualize PnL without a valid holding period", () => {
    expect(calculateAnnualizedPnlPercent(10, 1_000, 1_000)).toBeNull();
    expect(calculateAnnualizedPnlPercent(null, 0, 1_000)).toBeNull();
  });

  it("size-weights entry prices from opening orders when there is no position", () => {
    expect(
      calculateJournalTradeEntryPrice(
        [
          { ...baseOrder, averagePrice: 100, totalSize: 1 },
          {
            ...baseOrder,
            id: "order-2",
            averagePrice: 110,
            totalSize: 2,
          },
          {
            ...baseOrder,
            id: "exit",
            side: "Sell",
            direction: "Close Long",
            averagePrice: 120,
            totalSize: 3,
          },
          {
            ...baseOrder,
            id: "opposite-direction",
            side: "Sell",
            direction: "Open Short",
            averagePrice: 80,
            totalSize: 1,
          },
        ],
        "long",
      ),
    ).toBeCloseTo(106.6666667);
  });

  it("uses the trade side as the entry side when spot orders lack open directions", () => {
    expect(
      calculateJournalTradeEntryPrice(
        [
          {
            ...baseOrder,
            side: "Sell",
            direction: "Sell",
            averagePrice: 20,
            totalSize: 2,
          },
          {
            ...baseOrder,
            id: "exit",
            side: "Buy",
            direction: "Buy",
            averagePrice: 15,
            totalSize: 2,
          },
        ],
        "short",
      ),
    ).toBe(20);
  });

  it("size-weights closing prices from exit orders", () => {
    expect(
      calculateJournalTradeClosingPrice(
        [
          {
            ...baseOrder,
            id: "exit-1",
            side: "Sell",
            direction: "Close Long",
            averagePrice: 120,
            totalSize: 1,
          },
          {
            ...baseOrder,
            id: "exit-2",
            side: "Sell",
            direction: "Close Long",
            averagePrice: 135,
            totalSize: 2,
          },
          { ...baseOrder, averagePrice: 100, totalSize: 3 },
        ],
        "long",
      ),
    ).toBe(130);
  });

  it("uses the opposite trade side for spot closing orders", () => {
    expect(
      calculateJournalTradeClosingPrice(
        [
          {
            ...baseOrder,
            side: "Buy",
            direction: "Buy",
            averagePrice: 15,
            totalSize: 2,
          },
          {
            ...baseOrder,
            id: "exit",
            side: "Sell",
            direction: "Sell",
            averagePrice: 20,
            totalSize: 2,
          },
        ],
        "long",
      ),
    ).toBe(20);
  });

  it("calculates realized PnL through each transaction chronologically", () => {
    const totals = calculateCumulativeRealizedPnlByOrder([
      { ...baseOrder, id: "latest", lastTime: 3, closedPnl: -2.1 },
      { ...baseOrder, id: "earliest", lastTime: 1, closedPnl: 12.345 },
      { ...baseOrder, id: "middle", lastTime: 2, closedPnl: null },
    ]);

    expect(Object.fromEntries(totals)).toEqual({
      earliest: 12.35,
      middle: 12.35,
      latest: 10.25,
    });
  });

  it("sums closed PnL, PnL basis, notional, orders, and fills", () => {
    expect(
      calculateJournalTradePnlSummary([
        {
          ...baseOrder,
          id: "order-1",
          closedPnl: 12.345,
          realizedPnlBasisUsd: 100,
          fillCount: 2,
        },
        {
          ...baseOrder,
          id: "order-2",
          closedPnl: -2.1,
          realizedPnlBasisUsd: 200.5,
          notionalUsd: 200.5,
          fillCount: 3,
        },
      ]),
    ).toEqual({
      pnlUsd: 10.25,
      pnlPercent: 3.41,
      realizedPnlUsd: 10.25,
      realizedPnlPercent: 3.41,
      realizedPnlBasisUsd: 300.5,
      unrealizedPnlUsd: null,
      unrealizedPnlPercent: null,
      entryPriceUsd: null,
      closingPriceUsd: null,
      positionValueUsd: 0,
      positionCostBasisUsd: 0,
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
      realizedPnlPercent: null,
      realizedPnlBasisUsd: 0,
      unrealizedPnlUsd: null,
      unrealizedPnlPercent: null,
      entryPriceUsd: null,
      closingPriceUsd: null,
      positionValueUsd: 0,
      positionCostBasisUsd: 0,
      orderCount: 1,
      fillCount: 1,
      notionalUsd: 100,
    });
  });

  it("adds unrealized PnL to trade PnL for unfinished trades", () => {
    expect(
      calculateJournalTradePnlSummary(
        [
          {
            ...baseOrder,
            id: "order-1",
            closedPnl: 12.34,
            realizedPnlBasisUsd: 100,
          },
        ],
        100.1,
        5000.5,
        false,
        98.7654,
        null,
        4900.4,
      ),
    ).toMatchObject({
      pnlUsd: 112.44,
      pnlPercent: 2.25,
      realizedPnlUsd: 12.34,
      realizedPnlPercent: 12.34,
      realizedPnlBasisUsd: 100,
      unrealizedPnlUsd: 100.1,
      unrealizedPnlPercent: 2.04,
      entryPriceUsd: 98.7654,
      positionValueUsd: 5000.5,
      positionCostBasisUsd: 4900.4,
    });
  });

  it("uses unrealized PnL when there is no realized trade PnL", () => {
    expect(
      calculateJournalTradePnlSummary(
        [baseOrder],
        -25.5,
        974.5,
        false,
        null,
        null,
        1000,
      ),
    ).toMatchObject({
      pnlUsd: -25.5,
      pnlPercent: -2.55,
      realizedPnlUsd: null,
      realizedPnlPercent: null,
      unrealizedPnlUsd: -25.5,
      unrealizedPnlPercent: -2.55,
      entryPriceUsd: null,
      positionValueUsd: 974.5,
      positionCostBasisUsd: 1000,
    });
  });

  it("uses all order PnL for finished trades", () => {
    expect(
      calculateJournalTradePnlSummary(
        [
          {
            ...baseOrder,
            id: "order-1",
            closedPnl: 12.34,
            realizedPnlBasisUsd: 100,
          },
          {
            ...baseOrder,
            id: "order-2",
            closedPnl: -2.1,
            realizedPnlBasisUsd: 100,
          },
        ],
        100.1,
        5000.5,
        true,
      ),
    ).toMatchObject({
      pnlUsd: 10.24,
      pnlPercent: 5.12,
      realizedPnlUsd: 10.24,
      realizedPnlPercent: 5.12,
      unrealizedPnlPercent: null,
    });
  });
});
