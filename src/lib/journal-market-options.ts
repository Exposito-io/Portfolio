import type { JournalTradeAsset, PortfolioPosition } from "@/lib/types";

export function getJournalAssetKey(asset: JournalTradeAsset) {
  return `${asset.kind}:${asset.dex ?? ""}:${asset.chartCoin}`;
}

export function getOpenPositionMarketKeys(
  markets: JournalTradeAsset[],
  positions: PortfolioPosition[],
) {
  const openPositions = new Set<string>();

  for (const position of positions) {
    if (position.source !== "hyperliquid" || position.kind !== "asset") continue;

    const dex = position.details?.dex;
    const normalizedDex =
      typeof dex === "string" && dex !== "default" ? dex : "";
    openPositions.add(`${normalizedDex}:${position.symbol}`.toUpperCase());
  }

  return markets.flatMap((market) => {
    const dex = market.dex ?? "";
    const isOpen = [market.coin, market.chartCoin].some((coin) =>
      openPositions.has(`${dex}:${coin}`.toUpperCase()),
    );

    return isOpen ? [getJournalAssetKey(market)] : [];
  });
}
