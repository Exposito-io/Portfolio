import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createEntry } from "@/lib/journal";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const trade = await createEntry(await getDb(), id, await request.json());

    if (!trade) {
      return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    }

    return NextResponse.json({ trade }, { status: 201 });
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
