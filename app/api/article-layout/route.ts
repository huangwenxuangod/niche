import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  applyDefaultWechatLayout,
  normalizeLayoutMarkdown,
  renderWechatHtml,
  sanitizeArticlePreviewMarkdown,
} from "@/lib/article-layout";

type LayoutStatus = "draft" | "published";

function summarizeMarkdown(markdown: string, max = 180) {
  const compact = markdown.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function renderBasicHtml(markdown: string) {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 18px;line-height:1.85;color:#222222;">${block.replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `<section style="padding:0 0 32px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.85;color:#222222;">${paragraphs}</section>`;
}

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
  const requestId =
    req.headers.get("x-request-id") ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `layout_${Date.now()}`);

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const mode = String(body.mode || "save");

    if (mode === "optimize") {
      const sourceMarkdown = normalizeLayoutMarkdown(
        sanitizeArticlePreviewMarkdown(String(body.source_markdown || ""))
      );
      if (!sourceMarkdown) {
        return NextResponse.json({ error: "source_markdown is required" }, { status: 400 });
      }

      try {
        const renderedMarkdown = applyDefaultWechatLayout(sourceMarkdown);
        const renderedHtml = renderWechatHtml(renderedMarkdown);

        return NextResponse.json({
          rendered_markdown: renderedMarkdown,
          rendered_html: renderedHtml,
        });
      } catch (error) {
        console.error("[article-layout] optimize failed, fallback to basic layout", {
          requestId,
          mode,
          userId: user.id,
          title: String(body.title || "").slice(0, 120),
          summaryPreview: summarizeMarkdown(String(body.summary || ""), 120),
          sourceLength: sourceMarkdown.length,
          sourcePreview: summarizeMarkdown(sourceMarkdown),
          error: serializeError(error),
        });
        return NextResponse.json({
          rendered_markdown: sourceMarkdown,
          rendered_html: renderBasicHtml(sourceMarkdown),
          fallback: true,
          request_id: requestId,
        });
      }
    }

    const conversationId = String(body.conversation_id || "");
    const journeyId = String(body.journey_id || "");
    const messageId = String(body.message_id || "");
    const sourceMarkdown = normalizeLayoutMarkdown(
      sanitizeArticlePreviewMarkdown(String(body.source_markdown || ""))
    );
    const renderedMarkdown = normalizeLayoutMarkdown(
      sanitizeArticlePreviewMarkdown(String(body.rendered_markdown || ""))
    );
    const renderedHtml = String(body.rendered_html || "");
    const status = (body.status === "published" ? "published" : "draft") as LayoutStatus;

    if (!conversationId || !journeyId || !messageId || !sourceMarkdown || !renderedMarkdown || !renderedHtml) {
      console.error("[article-layout] save rejected: missing required fields", {
        requestId,
        mode,
        userId: user.id,
        conversationId,
        journeyId,
        messageId,
        sourceLength: sourceMarkdown.length,
        renderedLength: renderedMarkdown.length,
        htmlLength: renderedHtml.length,
      });
      return NextResponse.json({ error: "Missing required fields", request_id: requestId }, { status: 400 });
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, journey_id, user_id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (!conversation || conversation.journey_id !== journeyId) {
      console.error("[article-layout] save rejected: forbidden", {
        requestId,
        mode,
        userId: user.id,
        conversationId,
        journeyId,
        conversationJourneyId: conversation?.journey_id ?? null,
      });
      return NextResponse.json({ error: "Forbidden", request_id: requestId }, { status: 403 });
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
      console.error("[article-layout] draft upsert failed", {
        requestId,
        mode,
        userId: user.id,
        conversationId,
        journeyId,
        messageId,
        status,
        sourceLength: sourceMarkdown.length,
        renderedLength: renderedMarkdown.length,
        htmlLength: renderedHtml.length,
        sourcePreview: summarizeMarkdown(sourceMarkdown, 120),
        renderedPreview: summarizeMarkdown(renderedMarkdown, 120),
        error: serializeError(error),
      });
      return NextResponse.json({ error: error.message, request_id: requestId }, { status: 500 });
    }

    return NextResponse.json({ draft: data });
  } catch (error) {
    console.error("[article-layout] route failed", {
      requestId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { error: "排版服务暂时不可用，请稍后重试。", request_id: requestId },
      { status: 500 }
    );
  }
}
