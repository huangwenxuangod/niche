import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { runOwnedWechatAnalysis } from "@/lib/wechat-owned-analysis";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const journeyId = String(body.journey_id || "").trim();

  if (!journeyId) {
    return NextResponse.json({ error: "缺少 journey_id。" }, { status: 400 });
  }

  const { data: journey, error: journeyError } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (journeyError || !journey) {
    return NextResponse.json({ error: "旅程不存在或无权限访问。" }, { status: 404 });
  }

  try {
    const result = await runOwnedWechatAnalysis({
      supabase,
      userId: user.id,
      journeyId,
    });

    return NextResponse.json({
      success: true,
      job_id: result.jobId,
      report_id: result.reportId,
      article_count: result.articleCount,
      metric_count: result.metricCount,
      report: result.report,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公众号分析失败" },
      { status: 400 }
    );
  }
}
