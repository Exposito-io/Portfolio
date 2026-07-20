import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { deleteEntry, updateEntry } from "@/lib/journal";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
    entryId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, entryId } = await context.params;
    const trade = await updateEntry(
      await getDb(),
      id,
      entryId,
      await request.json(),
    );

    if (!trade) {
      return NextResponse.json(
        { error: "Trade or entry not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ trade });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id, entryId } = await context.params;
    const trade = await deleteEntry(await getDb(), id, entryId);

    if (!trade) {
      return NextResponse.json(
        { error: "Trade or entry not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ trade });
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
