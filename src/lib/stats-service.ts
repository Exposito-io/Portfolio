import { fetchHyperliquidFilledOrdersByTime } from "@/lib/hyperliquid";
import type { StatsResponse } from "@/lib/stats";
import type {
  HyperliquidFilledOrder,
  PortfolioAccount,
  SourceError,
} from "@/lib/types";

export async function loadStats(
  accounts: PortfolioAccount[],
  endTime: number,
  fetchOrders = fetchHyperliquidFilledOrdersByTime,
): Promise<StatsResponse> {
  // Settings permits repeated addresses. Count each wallet only once.
  const wallets = new Map<string, PortfolioAccount>();
  for (const account of accounts) {
    if (account.enabled && account.source === "hyperliquid") {
      const address = account.address.toLowerCase();
      if (!wallets.has(address)) wallets.set(address, account);
    }
  }
  const orders: HyperliquidFilledOrder[] = [];
  const sourceErrors: SourceError[] = [];
  await Promise.all(
    [...wallets.values()].map(async (account) => {
      try {
        orders.push(...(await fetchOrders({ account, startTime: 0, endTime })));
      } catch (error) {
        sourceErrors.push({
          source: account.source,
          accountId: account.id,
          accountLabel: account.label,
          message:
            error instanceof Error ? error.message : "Unable to load orders.",
        });
      }
    }),
  );
  return {
    orders: orders.sort(
      (a, b) => b.lastTime - a.lastTime || b.firstTime - a.firstTime || b.id.localeCompare(a.id),
    ),
    accountsCount: wallets.size,
    sourceErrors,
    endTime,
  };
}
