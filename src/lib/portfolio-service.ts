import type { Db } from "mongodb";

import { PORTFOLIO_TIMEZONE } from "@/lib/config";
import { getDateKey, getYearFromDateKey } from "@/lib/date";
import { extractAaveReserveHints, fetchAaveAccount } from "@/lib/aave";
import {
  getAaveReserveHints,
  saveAaveReserveHints,
} from "@/lib/aave-reserve-cache";
import { fetchHyperliquidAccount } from "@/lib/hyperliquid";
import { listAccounts } from "@/lib/accounts";
import {
  findSnapshotByDate,
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

const LIVE_CACHE_TTL_MS = 15 * 60_000;

type LivePortfolioCacheEntry = {
  key: string;
  capturedAtMs: number;
  snapshot: PortfolioSnapshot;
};

let livePortfolioCache: LivePortfolioCacheEntry | null = null;

export async function getPortfolio(
  db: Db,
  selectedDateKey?: string,
  options: { refresh?: boolean } = {},
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

  if (!options.refresh) {
    const todaySnapshot = await findSnapshotByDate(db, todayKey);
    if (todaySnapshot) {
      const snapshotWithPnl = withYearlyPnl(
        todaySnapshot,
        await findEarliestSnapshotInYear(db, todayKey),
      );

      return {
        mode: "cached",
        selectedDateKey: todayKey,
        effectiveDateKey: todayKey,
        timezone: PORTFOLIO_TIMEZONE,
        snapshot: snapshotWithPnl,
        accountsCount: accounts.length,
      };
    }
  }

  const liveSnapshot = await getCachedOrRefreshPortfolio(
    db,
    accounts,
    todayKey,
    Boolean(options.refresh),
  );
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
  db: Db,
  accounts: PortfolioAccount[],
  dateKey: string,
  forceRefresh = false,
) {
  const cacheKey = getLiveCacheKey(accounts, dateKey);
  const now = Date.now();

  if (
    !forceRefresh &&
    livePortfolioCache?.key === cacheKey &&
    now - livePortfolioCache.capturedAtMs < LIVE_CACHE_TTL_MS
  ) {
    return livePortfolioCache.snapshot;
  }

  const snapshot = await refreshPortfolio(db, accounts, dateKey);
  livePortfolioCache = {
    key: cacheKey,
    capturedAtMs: now,
    snapshot,
  };

  return snapshot;
}

async function refreshPortfolio(
  db: Db,
  accounts: PortfolioAccount[],
  dateKey: string,
): Promise<PortfolioSnapshot> {
  const sourceSummaries: SourceSummary[] = [];
  const positions = [];
  const sourceErrors: SourceError[] = [];

  for (const account of accounts) {
    try {
      const result = await fetchAccount(db, account);

      sourceSummaries.push(result.summary);
      positions.push(...result.positions);
    } catch (error) {
      logSourceRefreshError(account, error);
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

async function fetchAccount(db: Db, account: PortfolioAccount) {
  if (account.source !== "aave") {
    return fetchHyperliquidAccount(account);
  }

  const reserveHints = await getAaveReserveHints(
    db,
    account.id,
    account.address,
  );
  const result = await fetchAaveAccount(account, undefined, reserveHints);

  if (!reserveHints?.length) {
    await saveAaveReserveHints(
      db,
      account.id,
      account.address,
      extractAaveReserveHints(result.positions),
    );
  }

  return result;
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
  const firstLine =
    error.message.split("\n")[0]?.replace(/:\s*$/, "") ||
    "Unable to refresh this account.";

  if (status === "429") {
    return "RPC provider rate limit reached while reading this account. Try again in a minute or use a higher-limit Ethereum RPC URL.";
  }

  if (status) {
    return `RPC request failed with status ${status}${details ? `: ${details}` : ""}.`;
  }

  return details ? `${firstLine}: ${details}` : firstLine;
}

function logSourceRefreshError(account: PortfolioAccount, error: unknown) {
  console.warn(
    [
      "[portfolio] Source refresh failed",
      `source=${account.source}`,
      `accountId=${account.id}`,
      `accountLabel=${JSON.stringify(account.label)}`,
      "--- full error start ---",
      formatErrorForLog(error),
      "--- full error end ---",
    ].join("\n"),
  );
}

function formatErrorForLog(error: unknown) {
  if (!(error instanceof Error)) {
    return redactRpcUrls(String(error));
  }

  return redactRpcUrls(formatErrorWithCauses(error));
}

function formatErrorWithCauses(error: Error, depth = 0): string {
  const prefix = depth ? `Caused by (${depth}): ` : "";
  const current = error.stack || `${error.name}: ${error.message}`;
  const cause = error.cause;

  if (!(cause instanceof Error)) {
    return `${prefix}${current}`;
  }

  return `${prefix}${current}\n\n${formatErrorWithCauses(cause, depth + 1)}`;
}

function redactRpcUrls(message: string) {
  return message.replace(/^URL:\s*.+$/gm, "URL: [redacted]");
}
