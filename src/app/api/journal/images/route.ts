import { NextResponse } from "next/server";

import { saveJournalImage } from "@/lib/journal-images";
import { getDb } from "@/lib/mongodb";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }

    const image = await saveJournalImage(await getDb(), file);
    const url = `/api/journal/images/${image.id}`;

    return NextResponse.json(
      {
        image: {
          ...image,
          url,
          markdown: `![${escapeMarkdownAlt(image.filename)}](${url})`,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 },
    );
  }
}

function escapeMarkdownAlt(value: string) {
  return value.replace(/[[\]]/g, "").trim() || "journal image";
}
