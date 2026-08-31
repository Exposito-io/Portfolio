import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { fetchHyperliquidMarkets } from "@/lib/hyperliquid";

export async function GET() {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

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
