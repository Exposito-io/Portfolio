import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { getApiAuthorizationError } from "@/lib/authorization";
import { findJournalImage } from "@/lib/journal-images";
import { getDb } from "@/lib/mongodb";

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
    const image = await findJournalImage(await getDb(), id);

    if (!image) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }

    return new Response(Readable.toWeb(image.stream) as ReadableStream, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(image.file.length),
        "Content-Type": image.contentType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
