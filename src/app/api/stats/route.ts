import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import { getHyperliquidSnapshotTime } from "@/lib/hyperliquid-info";
import { getCacheDb, getDb } from "@/lib/mongodb";
import { getHyperliquidFillCache } from "@/lib/hyperliquid-fill-cache";
import { getHyperliquidStatsCache } from "@/lib/hyperliquid-stats-cache";
import { loadStats } from "@/lib/stats-service";

const PAGE_SIZE = 50;

export async function GET(
  request: Request = new Request("http://localhost/api/stats"),
) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 0);
    const includeOrders = url.searchParams.get("summary") !== "1";
    if (!Number.isSafeInteger(page) || page < 0) {
      return NextResponse.json(
        { error: "Page must be a non-negative integer." },
        { status: 400 },
      );
    }
    const [db, cacheDb] = await Promise.all([getDb(), getCacheDb()]);
    const accounts = await listAccounts(db, true);
    const fillCache = getHyperliquidFillCache(cacheDb);
    const statsCache = getHyperliquidStatsCache(cacheDb);
    return NextResponse.json(
      await loadStats(
        accounts,
        getHyperliquidSnapshotTime(),
        {
          syncAccount: (account, endTime) =>
            fillCache.syncAccount(account, endTime),
          getStats: (query) => statsCache.getStats(query),
        },
        { page, pageSize: PAGE_SIZE, includeOrders },
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load stats.",
      },
      { status: 500 },
    );
  }
}
