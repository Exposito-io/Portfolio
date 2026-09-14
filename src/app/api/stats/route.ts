import { NextResponse } from "next/server";

import { listAccounts } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import { getHyperliquidSnapshotTime } from "@/lib/hyperliquid-info";
import { getDb } from "@/lib/mongodb";
import { getHyperliquidFillCache } from "@/lib/hyperliquid-fill-cache";
import { loadStats } from "@/lib/stats-service";

export async function GET() {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const db = await getDb();
    const accounts = await listAccounts(db, true);
    return NextResponse.json(
      await loadStats(accounts, getHyperliquidSnapshotTime(), (query) =>
        getHyperliquidFillCache(db).getOrders(query),
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
