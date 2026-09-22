import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { deleteTrade, getTrade, updateTrade } from "@/lib/journal";
import { findGroupForTrade, getGroup } from "@/lib/journal-groups";
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
    const [trade, membership] = await Promise.all([
      getTrade(db, id),
      findGroupForTrade(db, id),
    ]);

    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    const group = membership ? await getGroup(db, membership.id) : null;
    return NextResponse.json({ trade, group });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const trade = await updateTrade(await getDb(), id, await request.json());

    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    return NextResponse.json({ trade });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const db = await getDb();
    const group = await findGroupForTrade(db, id);
    if (group) {
      return NextResponse.json(
        {
          error: `Remove this journal item from “${group.title}” before deleting it.`,
          group,
        },
        { status: 409 },
      );
    }
    const deleted = await deleteTrade(db, id);

    if (!deleted) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
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
