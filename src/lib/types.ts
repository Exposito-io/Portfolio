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

export type AaveReserveHint = {
  symbol: string;
  address: string;
  decimals: number;
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
  mode: "live" | "snapshot" | "cached";
  selectedDateKey: string;
  effectiveDateKey: string | null;
  timezone: string;
  snapshot: PortfolioSnapshot | null;
  accountsCount: number;
};

export type JournalAssetKind = "perp" | "spot" | "trade-xyz";

export type JournalTradeAsset = {
  kind: JournalAssetKind;
  label: string;
  coin: string;
  chartCoin: string;
  dex?: string;
};

export type JournalEntry = {
  id: string;
  date: string;
  descriptionMarkdown: string;
  createdAt: string;
  updatedAt: string;
};

export type JournalTrade = {
  id: string;
  title: string;
  descriptionMarkdown: string;
  startDate: string;
  endDate: string | null;
  asset: JournalTradeAsset;
  entries: JournalEntry[];
  createdAt: string;
  updatedAt: string;
};

export type JournalTradePnlSummary = {
  pnlUsd: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  orderCount: number;
  fillCount: number;
  notionalUsd: number;
};

export type HyperliquidCandle = {
  time: number;
  timeKey: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HyperliquidFill = {
  id: string;
  accountId: string;
  accountLabel: string;
  coin: string;
  side: "Buy" | "Sell" | "Unknown";
  direction: string;
  price: number;
  size: number;
  notionalUsd: number;
  fee: number | null;
  feeToken: string | null;
  closedPnl: number | null;
  time: number;
  timeKey: string;
  hash: string | null;
  orderId: number | null;
  crossed: boolean | null;
};

export type HyperliquidFilledOrder = {
  id: string;
  accountId: string;
  accountLabel: string;
  coin: string;
  side: "Buy" | "Sell" | "Unknown";
  direction: string;
  averagePrice: number;
  totalSize: number;
  notionalUsd: number;
  fee: number | null;
  feeToken: string | null;
  closedPnl: number | null;
  firstTime: number;
  lastTime: number;
  orderId: number | null;
  fillCount: number;
};
