import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { createGroup, createGroupWithNewTrades, ensureJournalTradeGroupIndexes, listGroups } from "@/lib/journal-groups";
import { getDb, getMongoClient } from "@/lib/mongodb";

const requestSchema = z.object({
  newTrades: z.array(z.object({
    clientId: z.string().trim().regex(/^new:/).max(100),
    trade: z.record(z.string(), z.unknown()),
  })).max(12).default([]),
}).passthrough();

export async function GET() {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    return NextResponse.json({ groups: await listGroups(await getDb()) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const input = requestSchema.parse(await request.json());
    const { newTrades, ...groupPayload } = input;
    const db = await getDb();
    await ensureJournalTradeGroupIndexes(db);
    let group;
    if (newTrades.length) {
      const session = (await getMongoClient()).startSession();
      try {
        await session.withTransaction(async () => {
          group = await createGroupWithNewTrades(db, groupPayload, newTrades, session);
        });
      } finally {
        await session.endSession();
      }
    } else {
      group = await createGroup(db, groupPayload);
    }
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
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
