import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  HyperliquidCandle,
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
