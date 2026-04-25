import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ensureJourneyMemory, ensureJourneyProjectMemory, syncUserIdentityMemory } from "@/lib/memory";

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
  const { platform, identity_memo } = body;
  if (!platform) {
    return NextResponse.json({ error: "platform is required" }, { status: 400 });
  }

  const platformLabel = platform === "wechat_mp" ? "公众号" : platform;

  // Deactivate all previous journeys
  await supabase.from("journeys").update({ is_active: false }).eq("user_id", user.id);

  // Create journey
  const { data: journey, error } = await supabase
    .from("journeys")
    .insert({
      user_id: user.id,
      name: `${platformLabel}内容增长旅程`,
      platform,
      niche_level1: null,
      niche_level2: null,
      niche_level3: null,
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

  // Save identity memo if provided
  if (identity_memo) {
    await supabase.from("user_profiles").upsert(
      { user_id: user.id, identity_memo, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    await syncUserIdentityMemory(supabase, user.id, identity_memo);
  }

  await ensureJourneyMemory(supabase, {
    journeyId: journey.id,
    platform: platform === "wechat_mp" ? "公众号" : platform,
    nicheLevel1: "",
    nicheLevel2: "",
    nicheLevel3: "",
  });
  await ensureJourneyProjectMemory(supabase, {
    journeyId: journey.id,
    userId: user.id,
    projectName: journey.name,
    platform: platformLabel,
    nicheLevel1: "",
    nicheLevel2: "",
    nicheLevel3: "",
  });

  // Create initial conversation
  const { data: conv } = await supabase
    .from("conversations")
    .insert({ journey_id: journey.id, user_id: user.id, title: "第一次对话" })
    .select()
    .single();

  return NextResponse.json({ journey_id: journey.id, conversation_id: conv?.id });
}
