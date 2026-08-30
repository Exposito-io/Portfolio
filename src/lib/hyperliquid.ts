import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidCandle,
  HyperliquidFill,
  HyperliquidFilledOrder,
  HyperliquidFundingRate,
  JournalTradeAsset,
  PortfolioAccount,
  PortfolioPosition,
  SourceSummary,
} from "@/lib/types";

type HyperliquidClearinghouseState = {
  marginSummary?: {
    accountValue?: string;
    totalNtlPos?: string;
    totalRawUsd?: string;
    totalMarginUsed?: string;
  };
  withdrawable?: string;
  assetPositions?: Array<{
    position?: {
      coin?: string;
      szi?: string;
      entryPx?: string;
      positionValue?: string;
      unrealizedPnl?: string;
      marginUsed?: string;
    };
  }>;
};

type HyperliquidSpotClearinghouseState = {
  balances?: Array<{
    coin?: string;
    token?: number;
    total?: string;
    hold?: string;
    entryNtl?: string;
  }>;
};

type HyperliquidPerpDex = {
  dex: "" | "xyz";
  label: string;
  positionLabel: string;
};

type HyperliquidPerpMeta = {
  universe?: Array<{
    name?: string;
  }>;
};

type HyperliquidSpotMeta = {
  tokens?: Array<{
    name?: string;
    index?: number;
  }>;
  universe?: Array<{
    name?: string;
    tokens?: number[];
    index?: number;
  }>;
};

type HyperliquidCandleResponse = {
  t?: number;
  T?: number;
  o?: string;
  h?: string;
  l?: string;
  c?: string;
  v?: string;
}[];

type HyperliquidUserFillResponse = Array<{
  coin?: string;
  px?: string;
  sz?: string;
  side?: "A" | "B" | string;
  time?: number;
  dir?: string;
  closedPnl?: string;
  hash?: string;
  oid?: number;
  crossed?: boolean;
  fee?: string;
  feeToken?: string;
  tid?: number;
}>;

type HyperliquidFundingHistoryResponse = Array<{
  coin?: string;
  fundingRate?: string;
  time?: number;
}>;

type HyperliquidMetaAndAssetCtxsResponse = [
  { universe?: Array<{ name?: string }> },
  Array<{ funding?: string }>,
];

export type HyperliquidAccountResult = {
  summary: SourceSummary;
  positions: PortfolioPosition[];
};

export type HyperliquidCandleInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export const HYPERLIQUID_CANDLE_INTERVALS: HyperliquidCandleInterval[] = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
];

const PERP_DEXS: HyperliquidPerpDex[] = [
  {
    dex: "",
    label: "Crypto perps",
    positionLabel: "perpetual position",
  },
  {
    dex: "xyz",
    label: "Trade XYZ",
    positionLabel: "Trade XYZ perpetual position",
  },
];

export async function fetchHyperliquidAccount(
  account: PortfolioAccount,
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidAccountResult> {
  const positions: PortfolioPosition[] = [];
  let totalPositionValueUsd = 0;
  const spotState = await fetchSpotClearinghouseState(account, fetcher);
  const netWorthUsd = getUsdcTotalBalance(spotState);

  for (const perpDex of PERP_DEXS) {
    const state = await fetchClearinghouseState(account, perpDex, fetcher);

    for (const item of state.assetPositions ?? []) {
      const position = item.position;
      if (!position?.coin) continue;

      const valueUsd = parseUsd(position.positionValue);
      if (valueUsd <= 0) continue;
      totalPositionValueUsd += valueUsd;

      positions.push({
        id: `${account.id}:hyperliquid:${perpDex.dex || "default"}:${position.coin}`,
        accountId: account.id,
        accountLabel: account.label,
        source: "hyperliquid",
        symbol: position.coin,
        name: `${position.coin} ${perpDex.positionLabel}`,
        kind: "asset",
        quantity: parseNullableNumber(position.szi),
        valueUsd: roundCurrency(valueUsd),
        debtUsd: 0,
        details: {
          dex: perpDex.dex || "default",
          unrealizedPnl: parseUsd(position.unrealizedPnl),
          marginUsed: parseUsd(position.marginUsed),
        },
      });
    }
  }

  const totalDebtUsd = roundCurrency(
    Math.max(0, totalPositionValueUsd - netWorthUsd),
  );

  if (totalDebtUsd > 0) {
    positions.push({
      id: `${account.id}:hyperliquid:account-debt`,
      accountId: account.id,
      accountLabel: account.label,
      source: "hyperliquid",
      symbol: "USDC",
      name: "Hyperliquid account debt",
      kind: "debt",
      quantity: null,
      valueUsd: 0,
      debtUsd: totalDebtUsd,
      details: {
        formula: "sum(positionValue) - USDC total balance",
        totalPositionValueUsd: roundCurrency(totalPositionValueUsd),
        netWorthUsd: roundCurrency(netWorthUsd),
      },
    });
  }

  return {
    summary: {
      source: "hyperliquid",
      label: account.label,
      netWorthUsd: roundCurrency(netWorthUsd),
      totalInvestmentsUsd: roundCurrency(totalPositionValueUsd),
      totalDebtUsd,
      positionCount: positions.length,
    },
    positions,
  };
}

export async function fetchHyperliquidMarkets(
  fetcher: typeof fetch = fetch,
): Promise<JournalTradeAsset[]> {
  const [perpMeta, spotMeta, tradeXyzMeta] = await Promise.all([
    fetchPerpMeta("", fetcher),
    fetchSpotMeta(fetcher),
    fetchPerpMeta("xyz", fetcher),
  ]);

  const perps = (perpMeta.universe ?? [])
    .map((market) => market.name)
    .filter(isPresent)
    .map<JournalTradeAsset>((coin) => ({
      kind: "perp",
      label: `${coin} perp`,
      coin,
      chartCoin: coin,
    }));

  const spotTokensByIndex = new Map(
    (spotMeta.tokens ?? [])
      .filter((token) => token.index !== undefined && token.name)
      .map((token) => [token.index as number, token.name as string]),
  );
  const spotMarkets = (spotMeta.universe ?? [])
    .map((market) => toSpotAsset(market, spotTokensByIndex))
    .filter(isPresent);

  const tradeXyz = (tradeXyzMeta.universe ?? [])
    .map((market) => market.name)
    .filter(isPresent)
    .map<JournalTradeAsset>((coin) => ({
      kind: "trade-xyz",
      label: `${coin} Trade XYZ perp`,
      coin,
      chartCoin: coin.includes(":") ? coin : `xyz:${coin}`,
      dex: "xyz",
    }));

  return [...perps, ...spotMarkets, ...tradeXyz].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export async function fetchHyperliquidCandles(
  {
    coin,
    interval,
    days,
  }: {
    coin: string;
    interval: HyperliquidCandleInterval;
    days: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidCandle[]> {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const response = await postInfo<HyperliquidCandleResponse>(
    {
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime,
        endTime,
      },
    },
    fetcher,
  );

  return response
    .map((candle) => {
      const time = Number(candle.t ?? candle.T ?? 0);
      return {
        time,
        timeKey: new Date(time).toISOString().slice(0, 10),
        open: Number(candle.o ?? 0),
        high: Number(candle.h ?? 0),
        low: Number(candle.l ?? 0),
        close: Number(candle.c ?? 0),
        volume: Number(candle.v ?? 0),
      };
    })
    .filter((candle) => candle.time > 0 && Number.isFinite(candle.close));
}

export async function fetchHyperliquidFundingHistory(
  {
    coin,
    startTime,
    endTime = Date.now(),
  }: {
    coin: string;
    startTime: number;
    endTime?: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidFundingRate[]> {
  const rates: HyperliquidFundingRate[] = [];
  let nextStartTime = startTime;

  for (let page = 0; page < 5 && nextStartTime <= endTime; page += 1) {
    const response = await postInfo<HyperliquidFundingHistoryResponse>(
      {
        type: "fundingHistory",
        coin,
        startTime: nextStartTime,
        endTime,
      },
      fetcher,
      "Hyperliquid funding history",
    );
    if (!response.length) break;

    const pageRates = response
      .map((rate) => ({
        coin: rate.coin ?? coin,
        fundingRate: Number(rate.fundingRate),
        time: Number(rate.time),
      }))
      .filter(
        (rate) =>
          Number.isFinite(rate.fundingRate) &&
          Number.isFinite(rate.time) &&
          rate.time >= startTime &&
          rate.time <= endTime,
      );
    rates.push(...pageRates);

    const latestTime = Math.max(...response.map((rate) => Number(rate.time ?? 0)));
    if (!Number.isFinite(latestTime) || latestTime < nextStartTime) break;
    nextStartTime = latestTime + 1;
  }

  return rates.sort((left, right) => left.time - right.time);
}

export async function fetchHyperliquidCurrentFundingRate(
  {
    coin,
    dex,
  }: {
    coin: string;
    dex?: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const [meta, contexts] = await postInfo<HyperliquidMetaAndAssetCtxsResponse>(
    {
      type: "metaAndAssetCtxs",
      ...(dex ? { dex } : {}),
    },
    fetcher,
    "Hyperliquid current funding rate",
  );
  const index = (meta.universe ?? []).findIndex((market) => market.name === coin);
  if (index < 0) return null;

  const fundingRate = Number(contexts[index]?.funding);
  return Number.isFinite(fundingRate) ? fundingRate : null;
}

export async function fetchHyperliquidUserFillsByTime(
  {
    account,
    startTime,
    endTime,
    coinAliases,
  }: {
    account: PortfolioAccount;
    startTime: number;
    endTime: number;
    coinAliases: string[];
  },
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidFill[]> {
  const aliases = new Set(coinAliases);
  const fills: HyperliquidFill[] = [];
  let nextStartTime = startTime;

  for (let page = 0; page < 5 && nextStartTime <= endTime; page += 1) {
    const response = await postInfo<HyperliquidUserFillResponse>(
      {
        type: "userFillsByTime",
        user: account.address,
        startTime: nextStartTime,
        endTime,
        aggregateByTime: true,
      },
      fetcher,
      `Hyperliquid fills for ${account.label}`,
    );
    const pageFills = response
      .filter((fill) => fill.coin && aliases.has(fill.coin))
      .map((fill) => normalizeFill(fill, account));

    fills.push(...pageFills);

    if (response.length < 2000) break;
    const lastTime = Math.max(...response.map((fill) => Number(fill.time ?? 0)));
    if (!Number.isFinite(lastTime) || lastTime < nextStartTime) break;
    nextStartTime = lastTime + 1;
  }

  return fills.sort((a, b) => b.time - a.time);
}

export async function fetchHyperliquidFilledOrdersByTime(
  {
    account,
    startTime,
    endTime,
    coinAliases,
  }: {
    account: PortfolioAccount;
    startTime: number;
    endTime: number;
    coinAliases: string[];
  },
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidFilledOrder[]> {
  const fills = await fetchHyperliquidUserFillsByTime(
    {
      account,
      startTime,
      endTime,
      coinAliases,
    },
    fetcher,
  );

  return aggregateFillsToOrders(fills);
}

type HyperliquidOpenPositionSummary = {
  entryPriceUsd: number | null;
  positionSize: number;
  positionValueUsd: number;
  positionCostBasisUsd: number;
  unrealizedPnlUsd: number;
};

export async function fetchHyperliquidOpenPositionSummary(
  {
    account,
    asset,
    coinAliases = getHyperliquidCoinAliases(asset),
  }: {
    account: PortfolioAccount;
    asset: JournalTradeAsset;
    coinAliases?: string[];
  },
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidOpenPositionSummary | null> {
  if (asset.kind === "spot") {
    return null;
  }

  const dex = asset.kind === "trade-xyz" ? "xyz" : "";
  const state = await postInfo<HyperliquidClearinghouseState>(
    {
      type: "clearinghouseState",
      user: account.address,
      ...(dex ? { dex } : {}),
    },
    fetcher,
    dex ? `Hyperliquid ${dex} position PnL` : "Hyperliquid position PnL",
  );
  const aliases = new Set(coinAliases);
  const matchingPositions = (state.assetPositions ?? [])
    .map((item) => item.position)
    .filter((position) => position?.coin && aliases.has(position.coin));

  if (!matchingPositions.length) {
    return null;
  }

  let entryPriceWeightedSize = 0;
  let positionSize = 0;
  for (const position of matchingPositions) {
    const entryPrice = parseNullableNumber(position?.entryPx);
    const size = Math.abs(parseNullableNumber(position?.szi) ?? 0);
    if (entryPrice === null || size === 0) continue;
    entryPriceWeightedSize += entryPrice * size;
    positionSize += size;
  }

  return {
    entryPriceUsd:
      positionSize > 0 ? entryPriceWeightedSize / positionSize : null,
    positionSize,
    positionValueUsd: roundCurrency(
      matchingPositions.reduce(
        (sum, position) => sum + (parseNullableNumber(position?.positionValue) ?? 0),
        0,
      ),
    ),
    positionCostBasisUsd: roundCurrency(entryPriceWeightedSize),
    unrealizedPnlUsd: roundCurrency(
      matchingPositions.reduce(
        (sum, position) => sum + (parseNullableNumber(position?.unrealizedPnl) ?? 0),
        0,
      ),
    ),
  };
}

export async function fetchHyperliquidOpenPositionPnl(
  params: Parameters<typeof fetchHyperliquidOpenPositionSummary>[0],
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const summary = await fetchHyperliquidOpenPositionSummary(params, fetcher);
  return summary?.unrealizedPnlUsd ?? null;
}

export function getHyperliquidCoinAliases(asset: JournalTradeAsset) {
  const aliases = new Set([asset.coin, asset.chartCoin]);

  if (asset.kind === "trade-xyz") {
    const withoutPrefix = asset.chartCoin.replace(/^xyz:/, "");
    aliases.add(withoutPrefix);
    aliases.add(`xyz:${withoutPrefix}`);
  }

  return [...aliases].filter(Boolean);
}

async function fetchSpotClearinghouseState(
  account: PortfolioAccount,
  fetcher: typeof fetch,
) {
  return postInfo<HyperliquidSpotClearinghouseState>(
    {
      type: "spotClearinghouseState",
      user: account.address,
    },
    fetcher,
    "Hyperliquid balances",
  );
}

async function fetchPerpMeta(dex: "" | "xyz", fetcher: typeof fetch) {
  return postInfo<HyperliquidPerpMeta>(
    {
      type: "meta",
      ...(dex ? { dex } : {}),
    },
    fetcher,
    dex ? `Hyperliquid ${dex} markets` : "Hyperliquid perp markets",
  );
}

async function fetchSpotMeta(fetcher: typeof fetch) {
  return postInfo<HyperliquidSpotMeta>(
    {
      type: "spotMeta",
    },
    fetcher,
    "Hyperliquid spot markets",
  );
}

async function postInfo<T>(
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  label = "Hyperliquid info",
): Promise<T> {
  const response = await fetcher("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchClearinghouseState(
  account: PortfolioAccount,
  perpDex: HyperliquidPerpDex,
  fetcher: typeof fetch,
) {
  return postInfo<HyperliquidClearinghouseState>(
    {
      type: "clearinghouseState",
      user: account.address,
      ...(perpDex.dex ? { dex: perpDex.dex } : {}),
    },
    fetcher,
    `Hyperliquid ${perpDex.label}`,
  );
}

function getUsdcTotalBalance(state: HyperliquidSpotClearinghouseState) {
  const usdcBalance = state.balances?.find((balance) => balance.coin === "USDC");
  return parseUsd(usdcBalance?.total);
}

function parseUsd(value: string | undefined) {
  return roundCurrency(Number(value ?? 0));
}

function parseNullableNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFill(
  fill: HyperliquidUserFillResponse[number],
  account: PortfolioAccount,
): HyperliquidFill {
  const price = Number(fill.px ?? 0);
  const size = Number(fill.sz ?? 0);
  const time = Number(fill.time ?? 0);
  const orderId = fill.oid ?? null;
  const tradeId = fill.tid ?? `${time}:${orderId ?? "unknown"}`;

  const notionalUsd = roundCurrency(price * size);
  const closedPnl = parseNullableNumber(fill.closedPnl);

  return {
    id: `${account.id}:${tradeId}`,
    accountId: account.id,
    accountLabel: account.label,
    coin: fill.coin ?? "",
    side: toFillSide(fill.side),
    direction: fill.dir ?? "",
    price,
    size,
    notionalUsd,
    fee: parseNullableNumber(fill.fee),
    feeToken: fill.feeToken ?? null,
    closedPnl,
    realizedPnlBasisUsd: calculateRealizedPnlBasisUsd(
      fill.dir,
      notionalUsd,
      closedPnl,
    ),
    time,
    timeKey: new Date(time).toISOString(),
    hash: fill.hash ?? null,
    orderId,
    crossed: fill.crossed ?? null,
  };
}

function aggregateFillsToOrders(
  fills: HyperliquidFill[],
): HyperliquidFilledOrder[] {
  const groups = new Map<
    string,
    {
      accountId: string;
      accountLabel: string;
      coin: string;
      side: HyperliquidFill["side"];
      directions: Set<string>;
      notionalUsd: number;
      totalSize: number;
      fee: number | null;
      feeTokens: Set<string>;
      closedPnl: number | null;
      realizedPnlBasisUsd: number | null;
      firstTime: number;
      lastTime: number;
      orderId: number | null;
      fillCount: number;
    }
  >();

  for (const fill of fills) {
    const key = `${fill.accountId}:${fill.orderId ?? fill.id}:${fill.coin}:${fill.side}`;
    const group = groups.get(key) ?? {
      accountId: fill.accountId,
      accountLabel: fill.accountLabel,
      coin: fill.coin,
      side: fill.side,
      directions: new Set<string>(),
      notionalUsd: 0,
      totalSize: 0,
      fee: null,
      feeTokens: new Set<string>(),
      closedPnl: null,
      realizedPnlBasisUsd: null,
      firstTime: fill.time,
      lastTime: fill.time,
      orderId: fill.orderId,
      fillCount: 0,
    };

    if (fill.direction) group.directions.add(fill.direction);
    group.notionalUsd += fill.notionalUsd;
    group.totalSize += fill.size;
    group.fee = fill.fee === null ? group.fee : (group.fee ?? 0) + fill.fee;
    if (fill.feeToken) group.feeTokens.add(fill.feeToken);
    group.closedPnl =
      fill.closedPnl === null
        ? group.closedPnl
        : (group.closedPnl ?? 0) + fill.closedPnl;
    group.realizedPnlBasisUsd =
      fill.realizedPnlBasisUsd === null
        ? group.realizedPnlBasisUsd
        : (group.realizedPnlBasisUsd ?? 0) + fill.realizedPnlBasisUsd;
    group.firstTime = Math.min(group.firstTime, fill.time);
    group.lastTime = Math.max(group.lastTime, fill.time);
    group.fillCount += 1;

    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      accountId: group.accountId,
      accountLabel: group.accountLabel,
      coin: group.coin,
      side: group.side,
      direction: [...group.directions].join(", "),
      averagePrice:
        group.totalSize === 0
          ? 0
          : roundCurrency(group.notionalUsd / group.totalSize),
      totalSize: group.totalSize,
      notionalUsd: roundCurrency(group.notionalUsd),
      fee: group.fee === null ? null : roundCurrency(group.fee),
      feeToken:
        group.feeTokens.size === 1 ? [...group.feeTokens][0] : "Multiple",
      closedPnl:
        group.closedPnl === null ? null : roundCurrency(group.closedPnl),
      realizedPnlBasisUsd:
        group.realizedPnlBasisUsd === null
          ? null
          : roundCurrency(group.realizedPnlBasisUsd),
      firstTime: group.firstTime,
      lastTime: group.lastTime,
      orderId: group.orderId,
      fillCount: group.fillCount,
    }))
    .sort((a, b) => b.lastTime - a.lastTime);
}

function calculateRealizedPnlBasisUsd(
  direction: string | undefined,
  notionalUsd: number,
  closedPnl: number | null,
) {
  if (closedPnl === null) return null;

  const normalizedDirection = direction?.trim().toLocaleLowerCase();
  const basis = normalizedDirection?.startsWith("close long")
    ? notionalUsd - closedPnl
    : normalizedDirection?.startsWith("close short")
      ? notionalUsd + closedPnl
      : null;

  return basis !== null && Number.isFinite(basis) && basis > 0
    ? roundCurrency(basis)
    : null;
}

function toFillSide(side: string | undefined): HyperliquidFill["side"] {
  if (side === "B") return "Buy";
  if (side === "A") return "Sell";
  return "Unknown";
}

function toSpotAsset(
  market: NonNullable<HyperliquidSpotMeta["universe"]>[number],
  tokensByIndex: Map<number, string>,
): JournalTradeAsset | null {
  if (!market.name) return null;
  const baseTokenIndex = market.tokens?.[0];
  const quoteTokenIndex = market.tokens?.[1];
  const base = baseTokenIndex === undefined ? null : tokensByIndex.get(baseTokenIndex);
  const quote =
    quoteTokenIndex === undefined ? "USDC" : (tokensByIndex.get(quoteTokenIndex) ?? "USDC");
  const label = base ? `${base}/${quote}` : market.name;

  return {
    kind: "spot",
    label,
    coin: market.name,
    chartCoin: market.name,
  };
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && value !== "";
}
