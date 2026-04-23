import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  decryptWechatSecret,
  fetchWechatAccessToken,
  saveWechatDraft,
  uploadWechatImageFromUrl,
} from "@/lib/wechat-publish";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const draftId = String(body.draft_id || "").trim();
  const messageId = String(body.message_id || "").trim();
  const title = String(body.title || "").trim();
  const summary = String(body.summary || "").trim();
  const coverImageUrl = String(body.cover_image_url || "").trim();
  const authorOverride = String(body.author || "").trim();

  if (!draftId || !messageId || !title || !coverImageUrl) {
    return NextResponse.json({ error: "请填写完整的发布信息。" }, { status: 400 });
  }

  const { data: config, error: configError } = await supabase
    .from("wechat_publish_configs")
    .select("account_name, app_id, app_secret_encrypted, default_author")
    .eq("user_id", user.id)
    .single();

  if (configError || !config) {
    return NextResponse.json({ error: "请先填写并保存公众号配置。" }, { status: 404 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("article_layout_drafts")
    .select("id, user_id, message_id, rendered_html")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .single();

  if (draftError || !draft || draft.message_id !== messageId) {
    return NextResponse.json({ error: "排版草稿不存在或无权限访问。" }, { status: 404 });
  }

  try {
    const appSecret = decryptWechatSecret(config.app_secret_encrypted);
    const accessToken = await fetchWechatAccessToken(config.app_id, appSecret);
    const thumbMediaId = await uploadWechatImageFromUrl(coverImageUrl, accessToken);
    const mediaId = await saveWechatDraft({
      accessToken,
      title,
      author: authorOverride || config.default_author || "",
      summary,
      html: draft.rendered_html,
      thumbMediaId,
    });

    const { data: job, error: jobError } = await supabase
      .from("wechat_publish_jobs")
      .insert({
        user_id: user.id,
        article_layout_draft_id: draft.id,
        message_id: messageId,
        title,
        summary: summary || null,
        cover_image_url: coverImageUrl,
        status: "draft_saved",
        draft_media_id: mediaId,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    await supabase
      .from("article_layout_drafts")
      .update({ status: "published", updated_at: new Date().toISOString() })
      .eq("id", draft.id);

    return NextResponse.json({
      success: true,
      job,
      media_id: mediaId,
      account_name: config.account_name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布失败";
    await supabase.from("wechat_publish_jobs").insert({
      user_id: user.id,
      article_layout_draft_id: draftId,
      message_id: messageId,
      title,
      summary: summary || null,
      cover_image_url: coverImageUrl,
      status: "error",
      error_message: message,
      updated_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
