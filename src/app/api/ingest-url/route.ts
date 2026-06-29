import { NextResponse } from "next/server";
import { ingestUrl } from "@/lib/url-ingestion";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be JSON." }, { status: 400 });
  }

  const url = typeof body === "object" && body && "url" in body ? (body as { url?: unknown }).url : undefined;
  if (typeof url !== "string") {
    return NextResponse.json({ message: "Request body must include a url string." }, { status: 400 });
  }

  const result = await ingestUrl(url);
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  return NextResponse.json(result.bundle);
}
