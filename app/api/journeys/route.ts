import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ensureJourneyProjectMemory } from "@/lib/memory";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("journeys")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { platform } = body;
  const resolvedPlatform = platform || "wechat_mp";
  const platformLabel = resolvedPlatform === "wechat_mp" ? "公众号" : resolvedPlatform;

  // Deactivate all previous journeys
  await supabase.from("journeys").update({ is_active: false }).eq("user_id", user.id);

  // Create journey
  const { data: journey, error } = await supabase
    .from("journeys")
    .insert({
      user_id: user.id,
      name: `${platformLabel}内容增长旅程`,
      platform: resolvedPlatform,
      keywords: [],
      is_active: true,
      knowledge_initialized: false,
      init_status: "pending",
    })
    .select()
    .single();

  if (error || !journey) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }

  await ensureJourneyProjectMemory(supabase, journey.id);

  // Create initial conversation
  const { data: conv } = await supabase
    .from("conversations")
    .insert({ journey_id: journey.id, user_id: user.id, title: "新对话" })
    .select()
    .single();

  return NextResponse.json({ journey_id: journey.id, conversation_id: conv?.id });
}
