import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { applyDefaultWechatLayout, normalizeLayoutMarkdown, renderWechatHtml } from "@/lib/article-layout";

type LayoutStatus = "draft" | "published";

export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("message_id");
  if (!messageId) {
    return NextResponse.json({ error: "message_id is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("article_layout_drafts")
    .select("*")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const mode = String(body.mode || "save");

  if (mode === "optimize") {
    const sourceMarkdown = normalizeLayoutMarkdown(String(body.source_markdown || ""));
    if (!sourceMarkdown) {
      return NextResponse.json({ error: "source_markdown is required" }, { status: 400 });
    }

    const renderedMarkdown = applyDefaultWechatLayout(sourceMarkdown);
    const renderedHtml = renderWechatHtml(renderedMarkdown);

    return NextResponse.json({
      rendered_markdown: renderedMarkdown,
      rendered_html: renderedHtml,
    });
  }

  const conversationId = String(body.conversation_id || "");
  const journeyId = String(body.journey_id || "");
  const messageId = String(body.message_id || "");
  const sourceMarkdown = normalizeLayoutMarkdown(String(body.source_markdown || ""));
  const renderedMarkdown = normalizeLayoutMarkdown(String(body.rendered_markdown || ""));
  const renderedHtml = String(body.rendered_html || "");
  const status = (body.status === "published" ? "published" : "draft") as LayoutStatus;

  if (!conversationId || !journeyId || !messageId || !sourceMarkdown || !renderedMarkdown || !renderedHtml) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, journey_id, user_id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (!conversation || conversation.journey_id !== journeyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("article_layout_drafts")
    .upsert({
      conversation_id: conversationId,
      journey_id: journeyId,
      message_id: messageId,
      user_id: user.id,
      source_markdown: sourceMarkdown,
      rendered_markdown: renderedMarkdown,
      rendered_html: renderedHtml,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: "message_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}
