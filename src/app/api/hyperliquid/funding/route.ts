import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import {
  fetchHyperliquidCurrentFundingRate,
  fetchHyperliquidFundingHistory,
} from "@/lib/hyperliquid";
import { calculateJournalFundingSummary } from "@/lib/journal-funding";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const searchParams = new URL(request.url).searchParams;
    const coin = searchParams.get("coin")?.trim();
    const dex = searchParams.get("dex")?.trim() || undefined;
    if (!coin) {
      return NextResponse.json({ error: "Coin is required." }, { status: 400 });
    }

    const endTime = Date.now();
    const [rates, currentHourlyRate] = await Promise.all([
      fetchHyperliquidFundingHistory({
        coin,
        startTime: endTime - THIRTY_DAYS_MS,
        endTime,
      }),
      fetchHyperliquidCurrentFundingRate({ coin, dex }),
    ]);

    return NextResponse.json({
      summary: calculateJournalFundingSummary(rates, endTime, currentHourlyRate),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
