import { NextResponse } from "next/server";

import { fetchHyperliquidMarkets } from "@/lib/hyperliquid";

export async function GET() {
  try {
    const markets = await fetchHyperliquidMarkets();
    return NextResponse.json({ markets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
