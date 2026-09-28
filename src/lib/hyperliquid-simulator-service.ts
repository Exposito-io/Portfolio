import { getHyperliquidInfoClient } from "@/lib/hyperliquid-info";
import type {
  HyperliquidMarginTier,
  HyperliquidSimulatorMarket,
  HyperliquidSimulatorPosition,
  HyperliquidSimulatorSnapshot,
  PortfolioAccount,
} from "@/lib/types";

type RawSpotMeta = {
  tokens?: Array<{ index?: number; name?: string }>;
};

type RawSpotState = {
  balances?: Array<{ coin?: string; total?: string }>;
};

type RawPerpDex = null | { name?: string };

type RawPerpMeta = {
  collateralToken?: number;
  universe?: Array<{
    name?: string;
    szDecimals?: number;
    maxLeverage?: number;
    marginTableId?: number;
    onlyIsolated?: boolean;
    marginMode?: "strictIsolated" | "noCross";
    isDelisted?: boolean;
  }>;
  marginTables?: Array<
    [
      number,
      {
        marginTiers?: Array<{ lowerBound?: string; maxLeverage?: number }>;
      },
    ]
  >;
};

type RawAssetContext = {
  markPx?: string;
};

type RawClearinghouseState = {
  crossMaintenanceMarginUsed?: string;
  assetPositions?: Array<{
    position?: {
      coin?: string;
      szi?: string;
      entryPx?: string;
      liquidationPx?: string | null;
      positionValue?: string;
      unrealizedPnl?: string;
      marginUsed?: string;
      maxLeverage?: number;
      leverage?: {
        type?: "cross" | "isolated";
        value?: number;
        rawUsd?: string;
      };
      cumFunding?: { sinceOpen?: string };
    };
  }>;
};

type DexSnapshot = {
  dex: string;
  meta: RawPerpMeta;
  contexts: RawAssetContext[];
  state: RawClearinghouseState;
  isUsdc: boolean;
};

export class UnsupportedHyperliquidAccountModeError extends Error {
  constructor(readonly mode: string) {
    super(
      `The simulator currently supports unified Hyperliquid accounts. This account uses ${mode}.`,
    );
  }
}

export async function fetchHyperliquidSimulatorSnapshot(
  account: PortfolioAccount,
  fetcher: typeof fetch = fetch,
): Promise<HyperliquidSimulatorSnapshot> {
  const client = getHyperliquidInfoClient(fetcher);
  const request = <T>(body: Record<string, unknown>, label: string) =>
    client.request<T>(body, label);

  const [accountMode, perpDexs, allPerpMetas, spotMeta, spotState] =
    await Promise.all([
      request<string>(
        { type: "userAbstraction", user: account.address },
        `Hyperliquid account mode for ${account.label}`,
      ),
      request<RawPerpDex[]>({ type: "perpDexs" }, "Hyperliquid perp DEXs"),
      request<RawPerpMeta[]>(
        { type: "allPerpMetas" },
        "Hyperliquid perpetual metadata",
      ),
      request<RawSpotMeta>({ type: "spotMeta" }, "Hyperliquid spot metadata"),
      request<RawSpotState>(
        { type: "spotClearinghouseState", user: account.address },
        `Hyperliquid balances for ${account.label}`,
      ),
    ]);

  if (accountMode !== "unifiedAccount") {
    throw new UnsupportedHyperliquidAccountModeError(accountMode || "unknown mode");
  }

  const usdcTokenIndex =
    spotMeta.tokens?.find((token) => token.name === "USDC")?.index ?? 0;
  const dexSnapshots = await Promise.all(
    allPerpMetas.map(async (meta, index): Promise<DexSnapshot> => {
      const dex = index === 0 ? "" : (perpDexs[index]?.name ?? "");
      const isUsdc = (meta.collateralToken ?? 0) === usdcTokenIndex;
      const [state, metaAndContexts] = await Promise.all([
        request<RawClearinghouseState>(
          {
            type: "clearinghouseState",
            user: account.address,
            ...(dex ? { dex } : {}),
          },
          `Hyperliquid ${dex || "default"} account state`,
        ),
        isUsdc
          ? request<[RawPerpMeta, RawAssetContext[]]>(
              { type: "metaAndAssetCtxs", ...(dex ? { dex } : {}) },
              `Hyperliquid ${dex || "default"} market contexts`,
            )
          : Promise.resolve<[RawPerpMeta, RawAssetContext[]]>([meta, []]),
      ]);

      return {
        dex,
        meta: metaAndContexts[0] ?? meta,
        contexts: metaAndContexts[1] ?? [],
        state,
        isUsdc,
      };
    }),
  );

  const markets: HyperliquidSimulatorMarket[] = [];
  const positions: HyperliquidSimulatorPosition[] = [];
  let crossMaintenance = 0;
  let isolatedMargin = 0;
  let unsupportedPositionCount = 0;

  for (const dexSnapshot of dexSnapshots) {
    const openPositions = (dexSnapshot.state.assetPositions ?? []).filter(
      (item) => Math.abs(toNumber(item.position?.szi)) > 0,
    );
    if (!dexSnapshot.isUsdc) {
      unsupportedPositionCount += openPositions.length;
      continue;
    }

    crossMaintenance += toNumber(
      dexSnapshot.state.crossMaintenanceMarginUsed,
    );
    const marginTables = buildMarginTables(dexSnapshot.meta);
    const marketsByCoin = new Map<string, HyperliquidSimulatorMarket>();

    for (const [index, asset] of (
      dexSnapshot.meta.universe ?? []
    ).entries()) {
      if (!asset.name || asset.isDelisted) continue;
      const maxLeverage = asset.maxLeverage ?? 1;
      const market: HyperliquidSimulatorMarket = {
        id: marketId(dexSnapshot.dex, asset.name),
        dex: dexSnapshot.dex,
        coin: asset.name,
        label: asset.name,
        markPrice: toNumber(dexSnapshot.contexts[index]?.markPx),
        sizeDecimals: asset.szDecimals ?? 0,
        maxLeverage,
        marginMode:
          asset.marginMode === "strictIsolated"
            ? "strictIsolated"
            : asset.marginMode === "noCross" || asset.onlyIsolated
              ? "noCross"
              : "cross",
        marginTiers: marginTables.get(asset.marginTableId ?? maxLeverage) ?? [
          { lowerBound: 0, maxLeverage },
        ],
      };
      markets.push(market);
      marketsByCoin.set(asset.name, market);
    }

    for (const item of openPositions) {
      const position = item.position;
      if (!position?.coin) continue;
      const market = marketsByCoin.get(position.coin);
      if (!market) {
        unsupportedPositionCount += 1;
        continue;
      }
      const marginMode = position.leverage?.type ?? "cross";
      const marginUsed = toNumber(position.marginUsed);
      const signedSize = toNumber(position.szi);
      const positionValue = toNumber(position.positionValue);
      const reportedMarkPrice =
        Math.abs(signedSize) > 0
          ? positionValue / Math.abs(signedSize)
          : market.markPrice;
      if (marginMode === "isolated") isolatedMargin += marginUsed;

      positions.push({
        id: market.id,
        marketId: market.id,
        dex: dexSnapshot.dex,
        coin: position.coin,
        signedSize,
        entryPrice: toNumber(position.entryPx),
        markPrice: reportedMarkPrice,
        liquidationPrice: toNullableNumber(position.liquidationPx),
        positionValue,
        unrealizedPnl: toNumber(position.unrealizedPnl),
        marginMode,
        leverage: position.leverage?.value ?? 1,
        isolatedRawUsd: toNullableNumber(position.leverage?.rawUsd),
        marginUsed,
        maxLeverage: position.maxLeverage ?? market.maxLeverage,
        accruedFunding: negateNullable(position.cumFunding?.sinceOpen),
        sizeDecimals: market.sizeDecimals,
        marginTiers: market.marginTiers,
      });
    }
  }

  const spotUsdcBalance = toNumber(
    spotState.balances?.find((balance) => balance.coin === "USDC")?.total,
  );

  return {
    account,
    accountMode: "unifiedAccount",
    capturedAt: new Date().toISOString(),
    accountEquity: spotUsdcBalance,
    spotUsdcBalance,
    crossMaintenance,
    isolatedMargin,
    positions: positions.sort((a, b) =>
      Math.abs(b.positionValue) - Math.abs(a.positionValue),
    ),
    markets: markets.sort((a, b) => a.label.localeCompare(b.label)),
    unsupportedPositionCount,
  };
}

function buildMarginTables(meta: RawPerpMeta) {
  const tables = new Map<number, HyperliquidMarginTier[]>();
  for (const [id, table] of meta.marginTables ?? []) {
    const tiers = (table.marginTiers ?? [])
      .map((tier) => ({
        lowerBound: toNumber(tier.lowerBound),
        maxLeverage: tier.maxLeverage ?? 1,
      }))
      .sort((a, b) => a.lowerBound - b.lowerBound);
    if (tiers.length) tables.set(id, tiers);
  }
  return tables;
}

function marketId(dex: string, coin: string) {
  return `${dex || "default"}:${coin}`;
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function negateNullable(value: string | undefined) {
  const number = toNullableNumber(value);
  return number === null ? null : -number;
}
