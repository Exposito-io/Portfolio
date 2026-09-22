import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { getTrade } from "@/lib/journal";
import { getJournalTradeFilledOrders } from "@/lib/journal-filled-orders";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const db = await getDb();
    const trade = await getTrade(db, id);

    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    if (trade.kind === "idea") {
      return NextResponse.json(
        { error: "Trade ideas do not have filled orders or PnL." },
        { status: 400 },
      );
    }

    return NextResponse.json(await getJournalTradeFilledOrders(db, trade));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
