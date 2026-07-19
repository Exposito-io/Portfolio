import type { Db } from "mongodb";

import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getDateKey, getYearFromDateKey } from "@/lib/date";
import { fetchAaveAccount } from "@/lib/aave";
import { fetchHyperliquidAccount } from "@/lib/hyperliquid";
import { listAccounts } from "@/lib/accounts";
import {
  findEarliestSnapshotInYear,
  findSnapshotOnOrBefore,
  upsertDailySnapshot,
} from "@/lib/snapshots";
import { sumPortfolio, withYearlyPnl } from "@/lib/portfolio-calculations";
import type {
  PortfolioAccount,
  PortfolioResponse,
  PortfolioSnapshot,
  SourceError,
  SourceSummary,
} from "@/lib/types";

export async function getPortfolio(
  db: Db,
  selectedDateKey?: string,
): Promise<PortfolioResponse> {
  const todayKey = getDateKey(new Date(), PORTFOLIO_TIMEZONE);
  const dateKey = selectedDateKey || todayKey;
  const accounts = await listAccounts(db, true);

  if (dateKey !== todayKey) {
    const snapshot = await findSnapshotOnOrBefore(db, dateKey);
    const snapshotWithPnl = snapshot
      ? withYearlyPnl(
          snapshot,
          await findEarliestSnapshotInYear(db, snapshot.dateKey),
        )
      : null;

    return {
      mode: "snapshot",
      selectedDateKey: dateKey,
      effectiveDateKey: snapshotWithPnl?.dateKey ?? null,
      timezone: PORTFOLIO_TIMEZONE,
      snapshot: snapshotWithPnl,
      accountsCount: accounts.length,
    };
  }

  const liveSnapshot = await refreshPortfolio(accounts, todayKey);
  const savedSnapshot = accounts.length
    ? await upsertDailySnapshot(db, liveSnapshot)
    : liveSnapshot;
  const snapshotWithPnl = withYearlyPnl(
    savedSnapshot ?? liveSnapshot,
    await findEarliestSnapshotInYear(db, todayKey),
  );

  return {
    mode: "live",
    selectedDateKey: todayKey,
    effectiveDateKey: todayKey,
    timezone: PORTFOLIO_TIMEZONE,
    snapshot: snapshotWithPnl,
    accountsCount: accounts.length,
  };
}

async function refreshPortfolio(
  accounts: PortfolioAccount[],
  dateKey: string,
): Promise<PortfolioSnapshot> {
  const sourceSummaries: SourceSummary[] = [];
  const positions = [];
  const sourceErrors: SourceError[] = [];

  for (const account of accounts) {
    try {
      const result =
        account.source === "aave"
          ? await fetchAaveAccount(account)
          : await fetchHyperliquidAccount(account);

      sourceSummaries.push(result.summary);
      positions.push(...result.positions);
    } catch (error) {
      sourceErrors.push({
        source: account.source,
        accountId: account.id,
        accountLabel: account.label,
        message:
          error instanceof Error
            ? error.message
            : "Unable to refresh this account.",
      });
    }
  }

  return {
    dateKey,
    timezone: PORTFOLIO_TIMEZONE,
    capturedAt: new Date().toISOString(),
    totals: sumPortfolio(positions, sourceSummaries),
    sourceSummaries,
    positions,
    sourceErrors,
  };
}

export function yearOfPortfolio(response: PortfolioResponse) {
  return getYearFromDateKey(response.selectedDateKey);
}
