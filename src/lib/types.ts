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

export type JournalDescriptionTemplate = {
  id: string;
  title: string;
  descriptionMarkdown: string;
};

export type ApplicationSettings = {
  journalDescriptionTemplates: JournalDescriptionTemplate[];
  createdAt: string | null;
  updatedAt: string | null;
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
export type JournalTradeKind = "trade" | "idea";
export type JournalTradeDirection = "long" | "short";

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
  tags: string[];
  descriptionMarkdown: string;
  createdAt: string;
  updatedAt: string;
};

export type JournalTradingViewChart = {
  id: string;
  name?: string;
  source?: "tradingview" | "hyperliquid";
  symbol: string;
};

export type JournalTrade = {
  id: string;
  kind: JournalTradeKind;
  direction: JournalTradeDirection | null;
  title: string;
  descriptionMarkdown: string;
  metricsMarkdown: string;
  startDate: string;
  endDate: string | null;
  asset: JournalTradeAsset;
  tradingViewCharts: JournalTradingViewChart[];
  entries: JournalEntry[];
  createdAt: string;
  updatedAt: string;
};

export type JournalTradeGroupEntry = {
  id: string;
  date: string;
  tradeIds: string[];
  tags: string[];
  descriptionMarkdown: string;
  createdAt: string;
  updatedAt: string;
};

export type JournalTradeGroup = {
  id: string;
  kind: JournalTradeKind;
  title: string;
  descriptionMarkdown: string;
  metricsMarkdown: string;
  primaryTradeId: string;
  members: JournalTrade[];
  entries: JournalTradeGroupEntry[];
  tradingViewCharts: JournalTradingViewChart[];
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JournalItem =
  | { itemType: "trade"; trade: JournalTrade }
  | { itemType: "group"; group: JournalTradeGroup };

type JournalDocumentBase = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type JournalMarkdownDocument = JournalDocumentBase & {
  kind: "markdown";
  contentMarkdown: string;
};

export type JournalPdfDocument = JournalDocumentBase & {
  kind: "pdf";
  contentType: "application/pdf";
  sizeBytes: number;
  contentUrl: string;
  downloadUrl: string;
};

export type JournalDocument = JournalMarkdownDocument | JournalPdfDocument;

export type JournalNewsFeed = {
  id: string;
  kind: "google" | "rss";
  keywords: string;
  url?: string;
  createdAt: string;
  unreadCount: number;
  error?: string;
};

export type JournalNewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  feedIds: string[];
  feedKeywords: string[];
};

export type JournalNewsResponse = {
  feeds: JournalNewsFeed[];
  items: JournalNewsItem[];
  fetchedAt: string;
};

export type OpenJournalNews = {
  id: string;
  title: string;
  news: JournalNewsResponse;
};

export type OpenJournalNewsResponse = {
  journals: OpenJournalNews[];
  fetchedAt: string;
};

export type JournalTradePnlSummary = {
  pnlUsd: number | null;
  pnlPercent: number | null;
  realizedPnlUsd: number | null;
  realizedPnlPercent: number | null;
  realizedPnlBasisUsd: number;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPercent: number | null;
  entryPriceUsd: number | null;
  closingPriceUsd: number | null;
  positionValueUsd: number | null;
  positionCostBasisUsd: number;
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

export type HyperliquidFundingRate = {
  coin: string;
  fundingRate: number;
  time: number;
};

export type HyperliquidMarginTier = {
  lowerBound: number;
  maxLeverage: number;
};

export type HyperliquidSimulatorMarket = {
  id: string;
  dex: string;
  coin: string;
  label: string;
  markPrice: number;
  sizeDecimals: number;
  maxLeverage: number;
  marginMode: "cross" | "noCross" | "strictIsolated";
  marginTiers: HyperliquidMarginTier[];
};

export type HyperliquidSimulatorPosition = {
  id: string;
  marketId: string;
  dex: string;
  coin: string;
  signedSize: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  positionValue: number;
  unrealizedPnl: number;
  marginMode: "cross" | "isolated";
  leverage: number;
  isolatedRawUsd: number | null;
  marginUsed: number;
  maxLeverage: number;
  accruedFunding: number | null;
  sizeDecimals: number;
  marginTiers: HyperliquidMarginTier[];
};

export type HyperliquidSimulatorSnapshot = {
  account: PortfolioAccount;
  accountMode: "unifiedAccount";
  capturedAt: string;
  accountEquity: number;
  spotUsdcBalance: number;
  crossMaintenance: number;
  isolatedMargin: number;
  positions: HyperliquidSimulatorPosition[];
  markets: HyperliquidSimulatorMarket[];
  unsupportedPositionCount: number;
};

export type HyperliquidSimulationPositionDraft = {
  id: string;
  marketId: string;
  targetSide: "long" | "short";
  targetSize: number;
  fillPrice: number;
  marginMode: "cross" | "isolated";
  leverage: number;
  isolatedMarginAdjustment: number;
  orders: HyperliquidSimulationOrder[];
};

export type HyperliquidSimulationOrder = {
  id: string;
  marketId: string;
  side: "buy" | "sell";
  requestedNotional: number;
  effectiveNotional: number;
  size: number;
  fillPrice: number;
  marginMode: "cross" | "isolated";
  leverage: number;
  additionalInitialMargin: number;
  marginImpact: number;
};

export type HyperliquidSimulationOrderInput = {
  id: string;
  marketId: string;
  side: "buy" | "sell";
  requestedNotional: number;
  fillPrice: number;
  marginMode: "cross" | "isolated";
  leverage: number;
};

export type HyperliquidSimulationOrderPreview = {
  order: HyperliquidSimulationOrder | null;
  draft: HyperliquidSimulationDraft | null;
  result: HyperliquidSimulationResult | null;
  currentSignedSize: number;
  resultingSignedSize: number;
  liquidationPriceBefore: number | null;
  liquidationPriceAfter: number | null;
  marginBefore: number;
  marginAfter: number;
  marginChange: number;
  errors: string[];
};

export type HyperliquidSimulationDraft = {
  collateralAdjustment: number;
  positions: HyperliquidSimulationPositionDraft[];
};

export type HyperliquidSimulationWarning = {
  code:
    | "invalid-fill"
    | "invalid-leverage"
    | "invalid-size"
    | "unsupported-margin-mode"
    | "missing-market"
    | "insufficient-initial-margin"
    | "unsafe-collateral-removal"
    | "liquidatable";
  message: string;
  positionId?: string;
};

export type HyperliquidDerivedTrade = {
  positionId: string;
  marketId: string;
  coin: string;
  deltaSize: number;
  fillPrice: number;
  description: string;
  orderId: string | null;
  requestedNotional: number | null;
  effectiveNotional: number;
  additionalInitialMargin: number;
  marginImpact: number;
};

export type HyperliquidSimulatedPosition = {
  id: string;
  marketId: string;
  dex: string;
  coin: string;
  currentSignedSize: number;
  targetSignedSize: number;
  currentEntryPrice: number | null;
  simulatedEntryPrice: number | null;
  markPrice: number;
  fillPrice: number;
  currentLiquidationPrice: number | null;
  simulatedLiquidationPrice: number | null;
  currentPositionValue: number;
  simulatedPositionValue: number;
  currentMarginUsed: number;
  simulatedMarginUsed: number;
  marginMode: "cross" | "isolated";
  leverage: number;
  accruedFunding: number | null;
  changed: boolean;
};

export type HyperliquidSimulationResult = {
  metrics: {
    currentAccountEquity: number;
    simulatedAccountEquity: number;
    currentCrossMaintenance: number;
    simulatedCrossMaintenance: number;
    currentMarginBuffer: number;
    simulatedMarginBuffer: number;
    nearestLiquidation: {
      coin: string;
      price: number;
      distancePercent: number;
    } | null;
  };
  positions: HyperliquidSimulatedPosition[];
  trades: HyperliquidDerivedTrade[];
  warnings: HyperliquidSimulationWarning[];
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
  realizedPnlBasisUsd: number | null;
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
  realizedPnlBasisUsd: number | null;
  firstTime: number;
  lastTime: number;
  orderId: number | null;
  fillCount: number;
};
