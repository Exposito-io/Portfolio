import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { addNewGroupMember, getGroup } from "@/lib/journal-groups";
import { getDb, getMongoClient } from "@/lib/mongodb";

const inputSchema = z.object({
  trade: z.record(z.string(), z.unknown()),
  makePrimary: z.boolean().default(false),
});
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const db = await getDb();
    const session = (await getMongoClient()).startSession();
    let created = false;
    try {
      await session.withTransaction(async () => {
        created = Boolean(await addNewGroupMember(db, id, input.trade, input.makePrimary, session));
      });
    } finally {
      await session.endSession();
    }
    if (!created) return NextResponse.json({ error: "Journal group not found." }, { status: 404 });
    return NextResponse.json({ group: await getGroup(db, id) }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
  }
}
