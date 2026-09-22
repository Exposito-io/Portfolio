import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { getJournalTradeFilledOrders } from "@/lib/journal-filled-orders";
import { getGroup } from "@/lib/journal-groups";
import { aggregateJournalTradePnlSummaries } from "@/lib/journal-pnl";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const db = await getDb();
    const group = await getGroup(db, id);
    if (!group) return NextResponse.json({ error: "Journal group not found." }, { status: 404 });
    if (group.kind === "idea") return NextResponse.json({ error: "Trade idea groups do not have filled orders or PnL." }, { status: 400 });
    const settled = await Promise.allSettled(
      group.members.map(async (trade) => ({ tradeId: trade.id, result: await getJournalTradeFilledOrders(db, trade) })),
    );
    const positions = settled.map((item, index) =>
      item.status === "fulfilled"
        ? item.value
        : { tradeId: group.members[index].id, error: item.reason instanceof Error ? item.reason.message : "Unable to load position orders." },
    );
    const successful = positions.filter((position): position is Extract<typeof position, { result: unknown }> => "result" in position);
    const summaries = successful.map((position) => position.result.summary);
    const fundingValues = successful.map((position) => position.result.netFundingUsd).filter((value): value is number => value !== null);
    return NextResponse.json({
      positions,
      summary: aggregateJournalTradePnlSummaries(summaries),
      netFundingUsd: fundingValues.length ? fundingValues.reduce((sum, value) => sum + value, 0) : null,
      partial: settled.some((item) => item.status === "rejected"),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
  }
}
