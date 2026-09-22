import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { closeTrade } from "@/lib/journal";
import { createGroupEntry, getGroup } from "@/lib/journal-groups";
import { getDb, getMongoClient } from "@/lib/mongodb";

const closeSchema = z.object({
  date: z.string().trim().min(1),
  tags: z.array(z.string()).default(["post-mortem"]),
  descriptionMarkdown: z.string().trim().max(12_000).default(""),
  tradeIds: z.array(z.string()).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const input = closeSchema.parse(await request.json());
    const db = await getDb();
    const group = await getGroup(db, id);
    if (!group) {
      return NextResponse.json({ error: "Journal group not found." }, { status: 404 });
    }
    const requested = input.tradeIds ? new Set(input.tradeIds) : null;
    const targets = group.members.filter(
      (member) => !member.endDate && (!requested || requested.has(member.id)),
    );
    if (!targets.length) {
      return NextResponse.json({ error: "No open positions were selected." }, { status: 400 });
    }
    const session = (await getMongoClient()).startSession();
    try {
      await session.withTransaction(async () => {
        for (const trade of targets) {
          await closeTrade(db, trade.id, {
            date: input.date,
            tags: [],
            descriptionMarkdown: "",
          }, session);
        }
        if (input.descriptionMarkdown) {
          await createGroupEntry(db, id, {
            date: input.date,
            tags: input.tags,
            tradeIds: targets.map((trade) => trade.id),
            descriptionMarkdown: input.descriptionMarkdown,
          }, session);
        }
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ group: await getGroup(db, id) });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join(" ") },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
