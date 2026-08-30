import { NextResponse } from "next/server";

import { removeJournalNewsFeed } from "@/lib/journal-news";
import { getDb } from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{
    id: string;
    feedId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id, feedId } = await context.params;
    const removed = await removeJournalNewsFeed(await getDb(), id, feedId);

    if (!removed) {
      return NextResponse.json(
        { error: "Journal or news feed not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
