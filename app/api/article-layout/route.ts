import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { llm } from "@/lib/llm";
import { normalizeLayoutMarkdown, renderWechatHtml } from "@/lib/article-layout";

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
    const title = String(body.title || "");
    const summary = String(body.summary || "");
    if (!sourceMarkdown) {
      return NextResponse.json({ error: "source_markdown is required" }, { status: 400 });
    }

    const renderedMarkdown = await optimizeArticleLayout({
      title,
      summary,
      sourceMarkdown,
    });
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

async function optimizeArticleLayout(params: {
  title: string;
  summary: string;
  sourceMarkdown: string;
}) {
  const result = await llm.chat(
    "你是公众号排版编辑。你只输出 Markdown，不要解释，不要输出代码块。你负责把文章整理成更适合微信公众号阅读和复制到编辑器的排版稿。",
    `请把下面这篇公众号文章进行一次性排版优化，要求：

1. 保持原意，不要重写观点
2. 自动优化小标题层级
3. 自动识别适合高亮的金句，用 :::highlight 包裹
4. 自动识别适合引用的段落，用 :::quote 包裹
5. 在适合的章节切换处加入 :::divider
6. 在结尾行动引导处整理成 :::cta
7. 如果某一小节明显适合放配图提示，可以插入一个 :::image 块，描述建议配什么图；全文最多 1 个
7. 不要频繁使用块，全文最多：
   - 2 个 :::highlight
   - 1 个 :::quote
   - 2 个 :::divider
   - 1 个 :::cta
   - 1 个 :::image
8. 如果正文缺少明显 CTA，就补一段简洁专业的 CTA
9. 输出必须是可继续编辑的 Markdown，允许使用这些自定义块：
   - :::highlight ... :::
   - :::quote ... :::
   - :::divider ... :::
   - :::cta ... :::
   - :::image ... :::
10. 不要添加任何说明文字

标题：${params.title || "暂无"}
摘要：${params.summary || "暂无"}

原始 Markdown：
${params.sourceMarkdown}`
  );

  return normalizeLayoutMarkdown(result || params.sourceMarkdown);
}
