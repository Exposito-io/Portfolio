import type {
  StatsHistoryQuery,
  StatsHistoryResult,
} from "@/lib/hyperliquid-stats-cache";
import type { StatsResponse } from "@/lib/stats";
import type {
  PortfolioAccount,
  SourceError,
} from "@/lib/types";

export type StatsHistorySource = {
  syncAccount(account: PortfolioAccount, endTime: number): Promise<void>;
  getStats(query: StatsHistoryQuery): Promise<StatsHistoryResult>;
};

export type LoadStatsOptions = {
  page?: number;
  pageSize?: number;
  includeOrders?: boolean;
};

export async function loadStats(
  accounts: PortfolioAccount[],
  endTime: number,
  source: StatsHistorySource,
  {
    page = 0,
    pageSize = 50,
    includeOrders = true,
  }: LoadStatsOptions = {},
): Promise<StatsResponse> {
  // Settings permits repeated addresses. Count each wallet only once.
  const wallets = new Map<string, PortfolioAccount>();
  for (const account of accounts) {
    if (account.enabled && account.source === "hyperliquid") {
      const address = account.address.toLowerCase();
      if (!wallets.has(address)) wallets.set(address, account);
    }
  }
  const sourceErrors: SourceError[] = [];
  const successfulAccounts = (
    await Promise.all(
      [...wallets.values()].map(async (account) => {
        try {
          await source.syncAccount(account, endTime);
          return account;
        } catch (error) {
          sourceErrors.push({
            source: account.source,
            accountId: account.id,
            accountLabel: account.label,
            message:
              error instanceof Error
                ? error.message
                : "Unable to load orders.",
          });
          return null;
        }
      }),
    )
  ).filter((account): account is PortfolioAccount => account !== null);
  const history = await source.getStats({
    accounts: successfulAccounts,
    page,
    pageSize,
    includeOrders,
  });
  return {
    ...history,
    page,
    pageSize,
    accountsCount: wallets.size,
    sourceErrors,
    endTime,
  };
}
