import { type SupabaseClient } from "@supabase/supabase-js";
import { llm } from "@/lib/llm";

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function getUserMemory(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("user_memories")
    .select("content")
    .eq("user_id", userId)
    .single();
  return data?.content ?? "";
}

export async function saveUserMemory(
  supabase: SupabaseClient,
  userId: string,
  markdown: string
) {
  await supabase
    .from("user_memories")
    .upsert(
      { user_id: userId, content: markdown.trim(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}

// ---------------------------------------------------------------------------
// Append facts extracted by LLM (called after each turn)
// ---------------------------------------------------------------------------

export async function compactAndSaveMemory(
  supabase: SupabaseClient,
  userId: string,
  conversationMarkdown: string
) {
  const current = await getUserMemory(supabase, userId);

  const prompt = `你是一个记忆管理助手。根据下面这段对话，提炼出值得长期记录的用户事实，并合并进现有的用户记忆文档中。

规则：
1. 只记录确认过的事实（赛道、变现模式、风格偏好、已确认的对标账号、已确认的选题方向等）
2. 不记录临时的问题、工具调用结果、或未确认的猜测
3. 如果对话中没有新的值得记录的事实，原样返回现有记忆，不做任何修改
4. 用 Markdown 格式输出，保持现有章节结构，可以追加新 section
5. 只输出记忆文档本身，不要任何解释

【现有用户记忆】
${current || defaultUserMemory()}

【本轮对话】
${conversationMarkdown}`;

  try {
    const updated = await llm.chat("你是记忆管理助手，只输出更新后的 Markdown 记忆文档。", prompt);
    if (updated?.trim()) {
      await saveUserMemory(supabase, userId, updated.trim());
    }
  } catch {
    // 记忆压缩失败不影响主流程
  }
}

// ---------------------------------------------------------------------------
// Format for system prompt injection
// ---------------------------------------------------------------------------

export function formatMemoryForPrompt(userMemory: string): string {
  if (!userMemory.trim()) return "（暂无用户记忆）";
  return userMemory.trim();
}

// ---------------------------------------------------------------------------
// Default template
// ---------------------------------------------------------------------------

function defaultUserMemory() {
  return [
    "# 用户记忆",
    "",
    "## 身份与背景",
    "（暂无）",
    "",
    "## 赛道与变现",
    "（暂无）",
    "",
    "## 风格偏好",
    "（暂无）",
    "",
    "## 已确认对标账号",
    "（暂无）",
    "",
    "## 历史决策",
    "（暂无）",
  ].join("\n");
}
