import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
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

export type HyperliquidAccountResult = {
  summary: SourceSummary;
  positions: PortfolioPosition[];
};

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
  let totalInvestmentsUsd = 0;
  const spotState = await fetchSpotClearinghouseState(account, fetcher);
  const netWorthUsd = getUsdcTotalBalance(spotState);

  for (const perpDex of PERP_DEXS) {
    const state = await fetchClearinghouseState(account, perpDex, fetcher);
    const accountValue = parseUsd(state.marginSummary?.accountValue);
    const totalNtlPos = parseUsd(state.marginSummary?.totalNtlPos);
    totalInvestmentsUsd += Math.max(accountValue, totalNtlPos);

    for (const item of state.assetPositions ?? []) {
      const position = item.position;
      if (!position?.coin) continue;

      const valueUsd = parseUsd(position.positionValue);
      if (valueUsd <= 0) continue;

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

  return {
    summary: {
      source: "hyperliquid",
      label: account.label,
      netWorthUsd: roundCurrency(netWorthUsd),
      totalInvestmentsUsd: roundCurrency(totalInvestmentsUsd),
      totalDebtUsd: 0,
      positionCount: positions.length,
    },
    positions,
  };
}

async function fetchSpotClearinghouseState(
  account: PortfolioAccount,
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "spotClearinghouseState",
      user: account.address,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid balances returned HTTP ${response.status}.`);
  }

  return (await response.json()) as HyperliquidSpotClearinghouseState;
}

async function fetchClearinghouseState(
  account: PortfolioAccount,
  perpDex: HyperliquidPerpDex,
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "clearinghouseState",
      user: account.address,
      ...(perpDex.dex ? { dex: perpDex.dex } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid ${perpDex.label} returned HTTP ${response.status}.`,
    );
  }

  return (await response.json()) as HyperliquidClearinghouseState;
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
