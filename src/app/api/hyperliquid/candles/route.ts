import { NextResponse } from "next/server";

import {
  fetchHyperliquidCandles,
  HYPERLIQUID_CANDLE_INTERVALS,
  type HyperliquidCandleInterval,
} from "@/lib/hyperliquid";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const coin = url.searchParams.get("coin")?.trim();
    const interval = url.searchParams.get("interval")?.trim() || "1d";
    const days = Number(url.searchParams.get("days") || 90);

    if (!coin) {
      return NextResponse.json({ error: "Coin is required." }, { status: 400 });
    }

    if (!HYPERLIQUID_CANDLE_INTERVALS.includes(interval as HyperliquidCandleInterval)) {
      return NextResponse.json(
        { error: "Unsupported candle interval." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return NextResponse.json(
        { error: "Days must be between 1 and 3650." },
        { status: 400 },
      );
    }

    const candles = await fetchHyperliquidCandles({
      coin,
      interval: interval as HyperliquidCandleInterval,
      days,
    });

    return NextResponse.json({ candles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
