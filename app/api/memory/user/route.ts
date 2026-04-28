import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  extractIdentityMemoFromUserMemory,
  getUserMemory,
  mergeIdentityMemoIntoUserMemory,
  saveUserMemory,
} from "@/lib/memory";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const markdown = await getUserMemory(supabase, user.id);

  return NextResponse.json({
    identity_memo: extractIdentityMemoFromUserMemory(markdown),
    memory_markdown: markdown,
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const identityMemo = String(body.identity_memo ?? "");
  const memoryMarkdown = String(body.memory_markdown ?? "");
  const mergedMarkdown = mergeIdentityMemoIntoUserMemory(memoryMarkdown, identityMemo);

  await saveUserMemory(supabase, user.id, mergedMarkdown);

  return NextResponse.json({ success: true });
}
