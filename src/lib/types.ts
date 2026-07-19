export type AccountSource = "aave" | "hyperliquid";

export type PortfolioAccount = {
  id: string;
  source: AccountSource;
  label: string;
  address: string;
  enabled: boolean;
  notes: string;
  metadata: {
    chain?: "ethereum";
  };
  createdAt: string;
  updatedAt: string;
};

export type PositionKind = "asset" | "debt";

export type PortfolioPosition = {
  id: string;
  accountId: string;
  accountLabel: string;
  source: AccountSource;
  symbol: string;
  name: string;
  kind: PositionKind;
  quantity: number | null;
  valueUsd: number;
  debtUsd: number;
  details?: Record<string, string | number | boolean | null>;
};

export type SourceSummary = {
  source: AccountSource;
  label: string;
  netWorthUsd: number;
  totalInvestmentsUsd: number;
  totalDebtUsd: number;
  healthFactor?: number | null;
  positionCount: number;
};

export type PortfolioTotals = {
  netWorthUsd: number;
  totalInvestmentsUsd: number;
  totalDebtUsd: number;
  yearlyPnlUsd: number | null;
  aaveHealthFactor: number | null;
};

export type PortfolioSnapshot = {
  id?: string;
  dateKey: string;
  timezone: string;
  capturedAt: string;
  totals: PortfolioTotals;
  sourceSummaries: SourceSummary[];
  positions: PortfolioPosition[];
  sourceErrors: SourceError[];
};

export type SourceError = {
  source: AccountSource;
  accountId: string;
  accountLabel: string;
  message: string;
};

export type PortfolioResponse = {
  mode: "live" | "snapshot";
  selectedDateKey: string;
  effectiveDateKey: string | null;
  timezone: string;
  snapshot: PortfolioSnapshot | null;
  accountsCount: number;
};
