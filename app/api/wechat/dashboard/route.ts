import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { WechatDashboardData } from "@/lib/data";

const MOCK_DATA: WechatDashboardData = {
  account: {
    name: "AI增长实验室",
    avatar_url: null,
  },
  summary: {
    article_count: 24,
    total_reads: 38420,
    avg_reads: 1601,
    avg_likes: 43,
    avg_shares: 18,
    avg_comments: 7,
    peak_reads: 8923,
  },
  articles: [
    {
      id: "art_1",
      title: "用 Claude Code 写公众号，效率提升 5 倍的实操方法",
      read_num: 8923,
      like_num: 186,
      share_num: 94,
      comment_num: 32,
      publish_time: "2026-04-18T08:00:00Z",
    },
    {
      id: "art_2",
      title: "冷启动公众号，前 100 篇文章该怎么选题",
      read_num: 4217,
      like_num: 89,
      share_num: 41,
      comment_num: 15,
      publish_time: "2026-04-12T08:00:00Z",
    },
    {
      id: "art_3",
      title: "对标分析实操：3 步拆解爆款公众号的内容策略",
      read_num: 3156,
      like_num: 67,
      share_num: 29,
      comment_num: 11,
      publish_time: "2026-04-05T08:00:00Z",
    },
    {
      id: "art_4",
      title: "公众号数据复盘模板：每周 10 分钟找到增长信号",
      read_num: 2840,
      like_num: 58,
      share_num: 22,
      comment_num: 8,
      publish_time: "2026-03-29T08:00:00Z",
    },
    {
      id: "art_5",
      title: "从 0 到 1000 粉，我的公众号增长复盘",
      read_num: 2190,
      like_num: 47,
      share_num: 18,
      comment_num: 6,
      publish_time: "2026-03-22T08:00:00Z",
    },
  ],
  ai_insights:
    "过去 30 天内容表现整体呈上升趋势，平均阅读量环比增长 12%。\"实操方法\"类文章的阅读和分享数据显著高于其他类型，建议继续深耕教程型内容。标题中带有具体数字的文章（如\"5 倍\"、\"3 步\"）点击率更高，可在后续选题中保持这一命名模式。",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const journeyId = searchParams.get("journey_id");

  if (!journeyId) {
    return NextResponse.json({ error: "Missing journey_id" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(MOCK_DATA);
}
