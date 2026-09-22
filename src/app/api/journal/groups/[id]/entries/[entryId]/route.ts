import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { deleteGroupEntry, updateGroupEntry } from "@/lib/journal-groups";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id, entryId } = await context.params;
    const group = await updateGroupEntry(await getDb(), id, entryId, await request.json());
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id, entryId } = await context.params;
    const group = await deleteGroupEntry(await getDb(), id, entryId);
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: "Journal entry not found." }, { status: 404 });
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
