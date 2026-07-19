import { NextResponse } from "next/server";

import { isValidDateKey } from "@/lib/date";
import { getDb } from "@/lib/mongodb";
import { getPortfolio } from "@/lib/portfolio-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || undefined;

    if (date && !isValidDateKey(date)) {
      return NextResponse.json(
        { error: "Date must use YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    const portfolio = await getPortfolio(await getDb(), date);
    return NextResponse.json(portfolio);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed." },
      { status: 500 },
    );
  }
}
