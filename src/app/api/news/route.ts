import { NextResponse } from "next/server";

import { getOpenJournalsNews } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const news = await getOpenJournalsNews(await getDb());
    return NextResponse.json({ news });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
