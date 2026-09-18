import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OrderMarkerTooltip,
  buildChartMarkers,
} from "@/components/journal-chart";
import type {
  HyperliquidCandle,
  HyperliquidFilledOrder,
} from "@/lib/types";

const candleHour = 60 * 60 * 1_000;
const candles: HyperliquidCandle[] = [
  {
    time: 0,
    timeKey: new Date(0).toISOString(),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 10,
  },
  {
    time: candleHour,
    timeKey: new Date(candleHour).toISOString(),
    open: 105,
    high: 120,
    low: 100,
    close: 115,
    volume: 20,
  },
];

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

describe("buildChartMarkers", () => {
  it("quantity-weights buy prices while preserving the candle total", () => {
    const result = buildChartMarkers({
      orders: [
        baseOrder,
        {
          ...baseOrder,
          id: "order-2",
          averagePrice: 130,
          totalSize: 3,
          notionalUsd: 390,
        },
      ],
      entries: [],
      candles,
    });

    expect(result.details.get("0:Buy")).toMatchObject({
      side: "Buy",
      notionalUsd: 490,
      averagePrice: 122.5,
      orderCount: 2,
    });
  });

  it("calculates a sell-only candle average", () => {
    const result = buildChartMarkers({
      orders: [
        {
          ...baseOrder,
          side: "Sell",
          direction: "Close Long",
          averagePrice: 120,
          totalSize: 2,
          notionalUsd: 240,
          lastTime: candleHour + 1,
        },
        {
          ...baseOrder,
          id: "order-2",
          side: "Sell",
          direction: "Close Long",
          averagePrice: 150,
          totalSize: 1,
          notionalUsd: 150,
          lastTime: candleHour + 2,
        },
      ],
      entries: [],
      candles,
    });

    expect(result.details.get(`${candleHour / 1000}:Sell`)).toMatchObject({
      side: "Sell",
      averagePrice: 130,
      notionalUsd: 390,
      orderCount: 2,
    });
  });

  it("keeps buy and sell averages separate in a mixed candle", () => {
    const result = buildChartMarkers({
      orders: [
        baseOrder,
        {
          ...baseOrder,
          id: "order-2",
          side: "Sell",
          direction: "Close Long",
          averagePrice: 120,
          totalSize: 2,
          notionalUsd: 240,
        },
        {
          ...baseOrder,
          id: "order-3",
          side: "Sell",
          direction: "Close Long",
          averagePrice: 150,
          totalSize: 1,
          notionalUsd: 150,
        },
      ],
      entries: [],
      candles,
    });

    expect(result.details.get("0:Buy")).toMatchObject({
      averagePrice: 100,
      notionalUsd: 100,
    });
    expect(result.details.get("0:Sell")).toMatchObject({
      averagePrice: 130,
      notionalUsd: 390,
      orderCount: 2,
    });
  });

  it("ignores missing and zero quantities without dropping their totals", () => {
    const result = buildChartMarkers({
      orders: [
        { ...baseOrder, totalSize: 0, notionalUsd: 25 },
        {
          ...baseOrder,
          id: "order-2",
          totalSize: undefined as unknown as number,
          notionalUsd: 30,
        },
      ],
      entries: [],
      candles,
    });

    expect(result.details.get("0:Buy")).toMatchObject({
      averagePrice: null,
      notionalUsd: 55,
      orderCount: 2,
    });
  });
});

describe("OrderMarkerTooltip", () => {
  it("renders the average price alongside the existing total and order count", () => {
    const markup = renderToStaticMarkup(
      createElement(OrderMarkerTooltip, {
        marker: {
          kind: "order",
          id: "0:Sell",
          side: "Sell",
          notionalUsd: 390,
          averagePrice: 130.12345678,
          orderCount: 2,
        },
      }),
    );

    expect(markup).toContain("Sell");
    expect(markup).toContain("$390.00");
    expect(markup).toContain("Avg price $130.12345678");
    expect(markup).toContain("2 orders");
  });

  it("renders N/A when no positive quantity can price the group", () => {
    const markup = renderToStaticMarkup(
      createElement(OrderMarkerTooltip, {
        marker: {
          kind: "order",
          id: "0:Buy",
          side: "Buy",
          notionalUsd: 55,
          averagePrice: null,
          orderCount: 2,
        },
      }),
    );

    expect(markup).toContain("Avg price N/A");
    expect(markup).not.toContain("NaN");
  });
});
