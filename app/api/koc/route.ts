import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource, Journey } from "@/lib/data";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const journeyId = searchParams.get("journey_id");
  const keyword = searchParams.get("keyword");

  if (!journeyId || !keyword) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(
    { error: "KOC 搜索能力已下线，不再调用按条收费接口" },
    { status: 410 }
  );
}

// POST: Add KOC manually (for KOC management page)
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { journey_id, ghid, account_name } = await req.json();

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journey_id)
    .eq("user_id", user.id)
    .single() as { data: Pick<Journey, "id"> | null };

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accountData = {
    journey_id,
    platform: "wechat_mp",
    account_name: account_name || "未命名",
    account_id: ghid,
    ghid,
    is_manually_added: true,
  };

  const { data: koc, error } = await supabase
    .from("koc_sources")
    .insert(accountData)
    .select()
    .single() as { data: KOCSource | null; error: { message: string } | null };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(koc);
}
