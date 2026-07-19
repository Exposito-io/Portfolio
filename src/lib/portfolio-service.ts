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

const LIVE_CACHE_TTL_MS = 60_000;

type LivePortfolioCacheEntry = {
  key: string;
  capturedAtMs: number;
  snapshot: PortfolioSnapshot;
};

let livePortfolioCache: LivePortfolioCacheEntry | null = null;

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

  const liveSnapshot = await getCachedOrRefreshPortfolio(accounts, todayKey);
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

async function getCachedOrRefreshPortfolio(
  accounts: PortfolioAccount[],
  dateKey: string,
) {
  const cacheKey = getLiveCacheKey(accounts, dateKey);
  const now = Date.now();

  if (
    livePortfolioCache?.key === cacheKey &&
    now - livePortfolioCache.capturedAtMs < LIVE_CACHE_TTL_MS
  ) {
    return livePortfolioCache.snapshot;
  }

  const snapshot = await refreshPortfolio(accounts, dateKey);
  livePortfolioCache = {
    key: cacheKey,
    capturedAtMs: now,
    snapshot,
  };

  return snapshot;
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
        message: toSourceErrorMessage(error),
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

function getLiveCacheKey(accounts: PortfolioAccount[], dateKey: string) {
  const accountKey = accounts
    .map((account) =>
      [
        account.id,
        account.source,
        account.address,
        account.enabled,
        account.updatedAt,
      ].join(":"),
    )
    .join("|");

  return `${dateKey}:${accountKey}`;
}

function toSourceErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to refresh this account.";
  }

  const status = error.message.match(/Status:\s*(\d+)/)?.[1];
  const details = error.message.match(/Details:\s*([^\n]+)/)?.[1];

  if (status === "429") {
    return "RPC provider rate limit reached while reading this account. Try again in a minute or use a higher-limit Ethereum RPC URL.";
  }

  if (status) {
    return `RPC request failed with status ${status}${details ? `: ${details}` : ""}.`;
  }

  return error.message.split("\n")[0] || "Unable to refresh this account.";
}
