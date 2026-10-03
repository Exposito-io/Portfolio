import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiAuthorizationError } from "@/lib/authorization";
import { addJournalNewsFeed, JournalNewsHttpError } from "@/lib/journal-news";
import { getCacheDb, getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const { id } = await context.params;
    const [db, cacheDb] = await Promise.all([getDb(), getCacheDb()]);
    const news = await addJournalNewsFeed(
      db,
      id,
      await request.json(),
      fetch,
      "journalTrades",
      cacheDb,
    );

    if (!news) {
      return NextResponse.json({ error: "Journal not found." }, { status: 404 });
    }

    return NextResponse.json({ news }, { status: 201 });
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
  if (error instanceof JournalNewsHttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 500 },
  );
}
