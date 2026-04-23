import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource, Journey } from "@/lib/data";
import { dajiala } from "@/lib/dajiala";

// GET: Search KOCs from dajiala API
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

  try {
    let results = await dajiala.searchAccounts(keyword, 1, 30);

    // Filter by fan count: 500-10000 first, then relax if needed
    let filtered = results.filter(k => k.fans >= 500 && k.fans <= 10000);
    if (filtered.length === 0) {
      filtered = results.filter(k => k.fans >= 100 && k.fans <= 50000);
    }

    // Return top 12
    return NextResponse.json(filtered.slice(0, 12));
  } catch (err) {
    console.error("Search failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
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
    .single() as { data: Journey | null };

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let accountData: any = {
    journey_id,
    platform: "wechat_mp",
    account_name: account_name || "未命名",
    account_id: ghid,
    ghid,
    is_manually_added: true,
  };

  // Try to fetch account info from dajiala if ghid is provided
  if (ghid) {
    try {
      const results = await dajiala.searchAccounts(account_name || ghid, 1, 10);
      const match = results.find((r: any) => r.ghid === ghid || r.name === account_name);
      if (match) {
        accountData = {
          ...accountData,
          account_name: match.name,
          ghid: match.ghid,
          biz: match.biz,
          fans_count: match.fans,
          avg_top_read: match.avg_top_read,
          avg_top_like: match.avg_top_like,
          week_articles_count: match.week_articles,
          avatar_url: match.avatar,
        };
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
