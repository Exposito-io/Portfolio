import { describe, expect, it } from "vitest";

import { sumPortfolio, withYearlyPnl } from "@/lib/portfolio-calculations";
import type { PortfolioPosition, PortfolioSnapshot, SourceSummary } from "@/lib/types";

const sourceSummaries: SourceSummary[] = [
  {
    source: "aave",
    label: "Aave",
    netWorthUsd: 800,
    totalInvestmentsUsd: 1000,
    totalDebtUsd: 200,
    healthFactor: 2.2,
    positionCount: 2,
  },
  {
    source: "hyperliquid",
    label: "HL",
    netWorthUsd: 3000,
    totalInvestmentsUsd: 3000,
    totalDebtUsd: 0,
    positionCount: 1,
  },
];

const positions: PortfolioPosition[] = [
  {
    id: "eth",
    accountId: "1",
    accountLabel: "Aave",
    source: "aave",
    symbol: "ETH",
    name: "ETH supplied",
    kind: "asset",
    quantity: 1,
    valueUsd: 1000,
    debtUsd: 0,
  },
  {
    id: "usdc",
    accountId: "1",
    accountLabel: "Aave",
    source: "aave",
    symbol: "USDC",
    name: "USDC borrowed",
    kind: "debt",
    quantity: 200,
    valueUsd: 0,
    debtUsd: 200,
  },
  {
    id: "sol",
    accountId: "2",
    accountLabel: "HL",
    source: "hyperliquid",
    symbol: "SOL",
    name: "SOL perp",
    kind: "asset",
    quantity: 12,
    valueUsd: 3000,
    debtUsd: 0,
  },
];

describe("portfolio calculations", () => {
  it("calculates net worth, gross investments, debt, and Aave health", () => {
    expect(sumPortfolio(positions, sourceSummaries)).toEqual({
      netWorthUsd: 3800,
      totalInvestmentsUsd: 4000,
      totalDebtUsd: 200,
      yearlyPnlUsd: null,
      aaveHealthFactor: 2.2,
    });
  });

  it("calculates yearly PnL from the earliest same-year snapshot", () => {
    const snapshot = snapshotWithNetWorth("2026-07-19", 3800);
    const earliest = snapshotWithNetWorth("2026-01-03", 3200);

    expect(withYearlyPnl(snapshot, earliest).totals.yearlyPnlUsd).toBe(600);
  });
});

function snapshotWithNetWorth(
  dateKey: string,
  netWorthUsd: number,
): PortfolioSnapshot {
  return {
    dateKey,
    timezone: "America/Toronto",
    capturedAt: new Date().toISOString(),
    totals: {
      netWorthUsd,
      totalInvestmentsUsd: netWorthUsd,
      totalDebtUsd: 0,
      yearlyPnlUsd: null,
      aaveHealthFactor: null,
    },
    sourceSummaries: [],
    positions: [],
    sourceErrors: [],
  };
}
