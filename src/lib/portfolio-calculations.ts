import { getYearFromDateKey } from "@/lib/date";
import type {
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioTotals,
  SourceSummary,
} from "@/lib/types";

export function sumPortfolio(
  positions: PortfolioPosition[],
  sourceSummaries: SourceSummary[],
): PortfolioTotals {
  const totalInvestmentsUsd = positions.reduce(
    (sum, position) => sum + Math.max(0, position.valueUsd),
    0,
  );
  const totalDebtUsd = positions.reduce(
    (sum, position) => sum + Math.max(0, position.debtUsd),
    0,
  );
  const netWorthUsd = sourceSummaries.reduce(
    (sum, summary) => sum + summary.netWorthUsd,
    0,
  );
  const healthFactors = sourceSummaries
    .map((summary) => summary.healthFactor)
    .filter((value): value is number => typeof value === "number");

  return {
    netWorthUsd: roundCurrency(netWorthUsd),
    totalInvestmentsUsd: roundCurrency(totalInvestmentsUsd),
    totalDebtUsd: roundCurrency(totalDebtUsd),
    yearlyPnlUsd: null,
    aaveHealthFactor: healthFactors.length ? Math.min(...healthFactors) : null,
  };
}

export function withYearlyPnl(
  snapshot: PortfolioSnapshot,
  earliestYearSnapshot: PortfolioSnapshot | null,
): PortfolioSnapshot {
  if (!earliestYearSnapshot) {
    return snapshot;
  }

  return {
    ...snapshot,
    totals: {
      ...snapshot.totals,
      yearlyPnlUsd: roundCurrency(
        snapshot.totals.netWorthUsd -
          earliestYearSnapshot.totals.netWorthUsd,
      ),
    },
  };
}

export function isSameCalendarYear(dateKey: string, year: number) {
  return getYearFromDateKey(dateKey) === year;
}

export function roundCurrency(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}
