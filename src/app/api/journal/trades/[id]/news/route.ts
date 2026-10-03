import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { getJournalNews, JournalNewsHttpError } from "@/lib/journal-news";
import { getCacheDb, getDb } from "@/lib/mongodb";

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
    const [db, cacheDb] = await Promise.all([getDb(), getCacheDb()]);
    const news = await getJournalNews(
      db,
      id,
      fetch,
      "journalTrades",
      cacheDb,
    );

    if (!news) {
      return NextResponse.json({ error: "Journal not found." }, { status: 404 });
    }

    return NextResponse.json({ news });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof JournalNewsHttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 500 },
  );
}
