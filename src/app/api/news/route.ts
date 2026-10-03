import { NextResponse } from "next/server";

import { getApiAuthorizationError } from "@/lib/authorization";
import { getOpenJournalsNews } from "@/lib/journal-news";
import { getCacheDb, getDb } from "@/lib/mongodb";

export async function GET() {
  const authorizationError = await getApiAuthorizationError();
  if (authorizationError) return authorizationError;

  try {
    const [db, cacheDb] = await Promise.all([getDb(), getCacheDb()]);
    const news = await getOpenJournalsNews(db, fetch, cacheDb);
    return NextResponse.json({ news });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
