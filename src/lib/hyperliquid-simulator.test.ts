import { describe, expect, it } from "vitest";

import {
  calculateMaintenanceMargin,
  createHyperliquidSimulationDraft,
  simulateHyperliquidPositions,
} from "@/lib/hyperliquid-simulator";
import type {
  HyperliquidSimulatorPosition,
  HyperliquidSimulatorSnapshot,
} from "@/lib/types";

const account = {
  id: "hl1",
  source: "hyperliquid" as const,
  label: "Main Hyperliquid",
  address: "0x0000000000000000000000000000000000000000",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

const market = {
  id: "default:BTC",
  dex: "",
  coin: "BTC",
  label: "BTC",
  markPrice: 100,
  sizeDecimals: 2,
  maxLeverage: 10,
  marginMode: "cross" as const,
  marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
};

function position(
  overrides: Partial<HyperliquidSimulatorPosition> = {},
): HyperliquidSimulatorPosition {
  return {
    id: "default:BTC",
    marketId: "default:BTC",
    dex: "",
    coin: "BTC",
    signedSize: 5,
    entryPrice: 90,
    markPrice: 100,
    liquidationPrice: 42.11,
    positionValue: 500,
    unrealizedPnl: 50,
    marginMode: "cross",
    leverage: 5,
    isolatedRawUsd: null,
    marginUsed: 100,
    maxLeverage: 10,
    accruedFunding: -4.5,
    sizeDecimals: 2,
    marginTiers: market.marginTiers,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<HyperliquidSimulatorSnapshot> = {},
): HyperliquidSimulatorSnapshot {
  return {
    account,
    accountMode: "unifiedAccount",
    capturedAt: "2026-09-28T12:00:00.000Z",
    accountEquity: 300,
    spotUsdcBalance: 300,
    crossMaintenance: 25,
    isolatedMargin: 0,
    positions: [position()],
    markets: [market],
    unsupportedPositionCount: 0,
    ...overrides,
  };
}

describe("Hyperliquid simulator", () => {
  it("blends an increased same-side entry and applies fill-price equity impact", () => {
    const source = snapshot();
    const draft = createHyperliquidSimulationDraft(source);
    draft.positions[0].targetSize = 8;
    draft.positions[0].fillPrice = 110;

    const result = simulateHyperliquidPositions(source, draft);

    expect(result.positions[0].simulatedEntryPrice).toBeCloseTo(97.5);
    expect(result.metrics.simulatedAccountEquity).toBe(270);
    expect(result.positions[0].simulatedLiquidationPrice).toBeCloseTo(
      69.736842,
      5,
    );
    expect(result.trades[0].description).toContain("Increase BTC long by 3");
    expect(result.positions[0].accruedFunding).toBe(-4.5);
  });

  it("retains entry on reduction, removes liquidation on close, and resets entry on flip", () => {
    const source = snapshot();
    const reduced = createHyperliquidSimulationDraft(source);
    reduced.positions[0].targetSize = 2;
    expect(
      simulateHyperliquidPositions(source, reduced).positions[0]
        .simulatedEntryPrice,
    ).toBe(90);

    const closed = createHyperliquidSimulationDraft(source);
    closed.positions[0].targetSize = 0;
    const closedResult = simulateHyperliquidPositions(source, closed);
    expect(closedResult.positions[0].simulatedLiquidationPrice).toBeNull();
    expect(closedResult.trades[0].description).toBe("Close BTC long");

    const flipped = createHyperliquidSimulationDraft(source);
    flipped.positions[0].targetSide = "short";
    flipped.positions[0].targetSize = 3;
    flipped.positions[0].fillPrice = 105;
    const flippedResult = simulateHyperliquidPositions(source, flipped);
    expect(flippedResult.positions[0].simulatedEntryPrice).toBe(105);
    expect(flippedResult.trades[0].description).toBe("Flip BTC to short");
  });

  it("shares collateral between cross positions and recalculates every liquidation", () => {
    const ethMarket = {
      ...market,
      id: "xyz:xyz:ETH",
      dex: "xyz",
      coin: "xyz:ETH",
      label: "xyz:ETH",
      markPrice: 50,
    };
    const source = snapshot({ markets: [market, ethMarket] });
    const draft = createHyperliquidSimulationDraft(source);
    draft.positions.push({
      id: "new:eth",
      marketId: ethMarket.id,
      targetSide: "short",
      targetSize: 2,
      fillPrice: 50,
      marginMode: "cross",
      leverage: 5,
      isolatedMarginAdjustment: 0,
    });

    const result = simulateHyperliquidPositions(source, draft);

    expect(result.positions).toHaveLength(2);
    expect(result.metrics.simulatedCrossMaintenance).toBe(30);
    expect(result.positions[0].simulatedLiquidationPrice).toBeGreaterThan(42);
    expect(result.positions[1].simulatedLiquidationPrice).not.toBeNull();
  });

  it("uses isolated equity instead of the shared cross pool", () => {
    const isolatedPosition = position({
      signedSize: 2,
      positionValue: 200,
      marginMode: "isolated",
      leverage: 5,
      marginUsed: 60,
    });
    const source = snapshot({
      accountEquity: 500,
      spotUsdcBalance: 500,
      crossMaintenance: 0,
      isolatedMargin: 60,
      positions: [isolatedPosition],
    });
    const draft = createHyperliquidSimulationDraft(source);
    draft.positions[0].leverage = 4;
    const result = simulateHyperliquidPositions(source, draft);

    expect(result.positions[0].simulatedLiquidationPrice).toBeCloseTo(
      73.68421,
      5,
    );
    expect(result.metrics.simulatedMarginBuffer).toBe(440);
  });

  it("applies tier deductions continuously at maintenance boundaries", () => {
    const tiers = [
      { lowerBound: 0, maxLeverage: 10 },
      { lowerBound: 1000, maxLeverage: 5 },
    ];
    expect(calculateMaintenanceMargin(999, tiers)).toBeCloseTo(49.95);
    expect(calculateMaintenanceMargin(1000, tiers)).toBeCloseTo(50);
    expect(calculateMaintenanceMargin(1500, tiers)).toBeCloseTo(100);
  });

  it("warns about precision, leverage, isolated-only markets, and unsafe margin", () => {
    const isolatedOnly = {
      ...market,
      marginMode: "noCross" as const,
      maxLeverage: 3,
      sizeDecimals: 1,
    };
    const source = snapshot({
      accountEquity: 40,
      spotUsdcBalance: 40,
      markets: [isolatedOnly],
      positions: [position({ maxLeverage: 3 })],
    });
    const draft = createHyperliquidSimulationDraft(source);
    draft.collateralAdjustment = -20;
    draft.positions[0].targetSize = 5.55;
    draft.positions[0].leverage = 5;

    const codes = simulateHyperliquidPositions(source, draft).warnings.map(
      (warning) => warning.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "invalid-size",
        "invalid-leverage",
        "unsupported-margin-mode",
        "insufficient-initial-margin",
        "unsafe-collateral-removal",
      ]),
    );
  });
});
