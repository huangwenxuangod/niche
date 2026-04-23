import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { llm } from "@/lib/llm";
import { ensureJourneyMemory, syncUserIdentityMemory } from "@/lib/memory";

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
  const { platform, niche_level1, niche_level2, niche_level3, identity_memo } = body;

  // Generate journey name + keywords via 豆包
  const nameAndKeywords = await generateJourneyMeta(platform, niche_level1, niche_level2, niche_level3);

  // Deactivate all previous journeys
  await supabase.from("journeys").update({ is_active: false }).eq("user_id", user.id);

  // Create journey
  const { data: journey, error } = await supabase
    .from("journeys")
    .insert({
      user_id: user.id,
      name: nameAndKeywords.name,
      platform,
      niche_level1,
      niche_level2,
      niche_level3,
      keywords: nameAndKeywords.keywords,
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
    await syncUserIdentityMemory(user.id, identity_memo);
  }

  await ensureJourneyMemory({
    journeyId: journey.id,
    platform: platform === "wechat_mp" ? "公众号" : platform,
    nicheLevel1: niche_level1,
    nicheLevel2: niche_level2,
    nicheLevel3: niche_level3,
  });

  // Create initial conversation
  const { data: conv } = await supabase
    .from("conversations")
    .insert({ journey_id: journey.id, user_id: user.id, title: "第一次对话" })
    .select()
    .single();

  return NextResponse.json({ journey_id: journey.id, conversation_id: conv?.id });
}

async function generateJourneyMeta(platform: string, l1: string, l2: string, l3: string) {
  const platformLabel = platform === "wechat_mp" ? "公众号" : platform;
  try {
    const text = await llm.chat(
      "你是一个内容策略助手，只输出 JSON，不要任何解释。",
      `给一个内容创作旅程生成名称和搜索关键词。
平台：${platformLabel}，大方向：${l1}，细分：${l2}，内容类型：${l3}

返回 JSON：
{
  "name": "简短旅程名称，如'公众号×AI产品体验'",
  "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"]
}`
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return {
    name: `${platformLabel}×${l2}`,
    keywords: [l2, `${l1} ${l2}`, `${l2} 公众号`, `${l2} 评测`, `${l2} 2025`],
  };
}
