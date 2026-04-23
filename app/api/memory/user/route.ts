import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getUserMemory, saveUserMemory, syncUserIdentityMemory } from "@/lib/memory";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("identity_memo")
    .eq("user_id", user.id)
    .single();

  const markdown = (await getUserMemory(user.id)) || (await syncUserIdentityMemory(user.id, profile?.identity_memo ?? ""));

  return NextResponse.json({
    identity_memo: profile?.identity_memo ?? "",
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

  await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      identity_memo: identityMemo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (memoryMarkdown.trim()) {
    await saveUserMemory(user.id, memoryMarkdown);
  } else {
    await syncUserIdentityMemory(user.id, identityMemo);
  }

  return NextResponse.json({ success: true });
}
