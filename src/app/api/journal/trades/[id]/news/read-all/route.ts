import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { markJournalNewsItemsRead } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const marked = await markJournalNewsItemsRead(
      await getDb(),
      id,
      await request.json(),
    );

    if (!marked) {
      return NextResponse.json({ error: "Journal not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
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
