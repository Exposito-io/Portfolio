import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createAccount, listAccounts } from "@/lib/accounts";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const accounts = await listAccounts(await getDb());
    return NextResponse.json({ accounts });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const account = await createAccount(await getDb(), await request.json());
    return NextResponse.json({ account }, { status: 201 });
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
