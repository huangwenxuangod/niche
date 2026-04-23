import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource, Journey } from "@/lib/data";
import { tikhub } from "@/lib/tikhub";

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
    .single() as { data: Journey | null };

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Use ghid as account_id if provided
  let accountData = {
    journey_id,
    platform: "wechat_mp",
    account_name: account_name || "未命名",
    account_id: ghid,
    is_manually_added: true,
  };

  // Try to fetch account info if ghid is provided
  if (ghid) {
    try {
      const listData = await tikhub.wechatMP.fetchArticleListByGhid(ghid);
      if (listData?.data?.mp_name) {
        accountData.account_name = listData.data.mp_name;
      }
    } catch (err) {
      console.error("Failed to fetch mp info:", err);
    }
  }

  const { data: koc, error } = await supabase
    .from("koc_sources")
    .insert(accountData)
    .select()
    .single() as { data: KOCSource | null; error: any };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(koc);
}
