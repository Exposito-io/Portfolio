import { NextResponse } from "next/server";

import { getAccount } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import {
  fetchHyperliquidSimulatorSnapshot,
  UnsupportedHyperliquidAccountModeError,
} from "@/lib/hyperliquid-simulator-service";
import { getDb } from "@/lib/mongodb";

export async function GET(request: Request) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  if (!accountId) {
    return NextResponse.json(
      { error: "Account is required." },
      { status: 400 },
    );
  }

  try {
    const account = await getAccount(await getDb(), accountId);
    if (!account || account.source !== "hyperliquid") {
      return NextResponse.json(
        { error: "Hyperliquid account not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      snapshot: await fetchHyperliquidSimulatorSnapshot(account),
    });
  } catch (error) {
    if (error instanceof UnsupportedHyperliquidAccountModeError) {
      return NextResponse.json(
        { error: error.message, accountMode: error.mode },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Hyperliquid simulator data.",
      },
      { status: 502 },
    );
  }
}
