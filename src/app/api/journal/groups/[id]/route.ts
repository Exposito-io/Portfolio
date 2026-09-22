import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { deleteGroup, getGroup, updateGroup } from "@/lib/journal-groups";
import { getDb } from "@/lib/mongodb";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const group = await getGroup(await getDb(), id);
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: "Journal group not found." }, { status: 404 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const group = await updateGroup(await getDb(), id, await request.json());
    return group
      ? NextResponse.json({ group })
      : NextResponse.json({ error: "Journal group not found." }, { status: 404 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;
  try {
    const { id } = await context.params;
    const deleted = await deleteGroup(await getDb(), id);
    return deleted
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Journal group not found." }, { status: 404 });
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
