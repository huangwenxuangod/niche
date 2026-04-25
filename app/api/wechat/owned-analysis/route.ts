import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  encryptWechatSecret,
  fetchWechatAccessToken,
} from "@/lib/wechat-publish";
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
  const accountName = String(body.account_name || "").trim();
  const appId = String(body.app_id || "").trim();
  const appSecret = String(body.app_secret || "").trim();

  if (!journeyId) {
    return NextResponse.json({ error: "缺少 journey_id。" }, { status: 400 });
  }

  if (!accountName) {
    return NextResponse.json({ error: "请填写你自己的公众号名称。" }, { status: 400 });
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
    let wechatConfigId: string | null = null;

    if (appId && appSecret) {
      await fetchWechatAccessToken(appId, appSecret);

      const { data: savedConfig, error: configError } = await supabase
        .from("wechat_publish_configs")
        .upsert(
          {
            user_id: user.id,
            account_name: accountName,
            app_id: appId,
            app_secret_encrypted: encryptWechatSecret(appSecret),
            default_author: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        )
        .select("id")
        .single();

      if (configError || !savedConfig) {
        throw new Error(configError?.message || "保存公众号配置失败");
      }

      wechatConfigId = savedConfig.id;
    } else {
      const { data: existingConfig } = await supabase
        .from("wechat_publish_configs")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      wechatConfigId = existingConfig?.id ?? null;
    }

    const result = await runOwnedWechatAnalysis({
      supabase,
      userId: user.id,
      journeyId,
      accountName,
      wechatConfigId,
    });

    return NextResponse.json({
      success: true,
      job_id: result.jobId,
      report_id: result.reportId,
      article_count: result.articleCount,
      metric_count: result.metricCount,
      analysis_meta: {
        source_mode: result.sourceMode,
        official_config_present: result.officialConfigPresent,
        official_metrics_enabled: result.officialMetricsEnabled,
        warnings: result.warnings,
      },
      report: result.report,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公众号分析失败" },
      { status: 400 }
    );
  }
}
