import { type SupabaseClient } from "@supabase/supabase-js";
import { chat } from "@/lib/llm";

// ---------------------------------------------------------------------------
// User Long-term Memory
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
      {
        user_id: userId,
        content: (markdown.trim() || defaultUserMemory()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
}

// ---------------------------------------------------------------------------
// Journey Project Memory
// ---------------------------------------------------------------------------

export async function getJourneyProjectMemory(
  supabase: SupabaseClient,
  journeyId: string
) {
  const { data } = await supabase
    .from("journey_project_memories")
    .select("content")
    .eq("journey_id", journeyId)
    .single();

  return data?.content ?? "";
}

export async function saveJourneyProjectMemory(
  supabase: SupabaseClient,
  journeyId: string,
  markdown: string
) {
  await supabase
    .from("journey_project_memories")
    .upsert(
      {
        journey_id: journeyId,
        content: markdown.trim() || defaultJourneyProjectMemory(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "journey_id" }
    );
}

export async function appendJourneyProjectMemoryItems(
  supabase: SupabaseClient,
  journeyId: string,
  sectionHeading: string,
  items: string[]
) {
  const normalizedItems = items
    .map((item) => item.trim())
    .filter(Boolean);

  if (!normalizedItems.length) {
    return;
  }

  const current = (await ensureJourneyProjectMemory(supabase, journeyId)) || defaultJourneyProjectMemory();
  const lines = current.split(/\r?\n/);
  const headingIndex = lines.findIndex((line: string) => line.trim() === sectionHeading.trim());
  if (headingIndex === -1) {
    return;
  }

  let nextHeadingIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("## ")) {
      nextHeadingIndex = i;
      break;
    }
  }

  const sectionLines = lines.slice(headingIndex + 1, nextHeadingIndex);
  const existingItems = new Set(
    sectionLines
      .map((line: string) => line.trim())
      .filter((line: string) => line.startsWith("- "))
      .map((line: string) => line.slice(2).trim())
  );

  const filteredSectionLines = sectionLines.filter(
    (line: string) => line.trim() !== "- 暂无" && line.trim() !== "- 待建立"
  );
  const pendingItems = normalizedItems.filter((item) => !existingItems.has(item));
  if (!pendingItems.length) {
    return;
  }

  const updated = [
    ...lines.slice(0, headingIndex + 1),
    ...filteredSectionLines,
    ...pendingItems.map((item) => `- ${item}`),
    ...lines.slice(nextHeadingIndex),
  ];

  await saveJourneyProjectMemory(supabase, journeyId, updated.join("\n"));
}

export async function ensureJourneyProjectMemory(
  supabase: SupabaseClient,
  journeyId: string
) {
  const existing = await getJourneyProjectMemory(supabase, journeyId);
  if (existing.trim()) return existing;

  const { data: journey } = await supabase
    .from("journeys")
    .select("name, platform, keywords")
    .eq("id", journeyId)
    .single();

  const markdown = [
    "# 项目记忆",
    "",
    "## 当前旅程",
    journey?.name ?? "未命名旅程",
    "",
    "## 平台与范围",
    `平台：${journey?.platform ?? "未知"}${Array.isArray(journey?.keywords) && journey?.keywords.length ? ` | 关键词：${journey.keywords.join("、")}` : ""}`,
    "",
    "## 当前策略卡片",
    "- 待建立",
    "",
    "## 已验证选题模式",
    "- 暂无",
    "",
    "## 当前增长假设",
    "- 暂无",
    "",
    "## 当前对标观察",
    "- 暂无",
  ].join("\n");

  await saveJourneyProjectMemory(supabase, journeyId, markdown);
  return markdown;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

export async function compactAndSaveUserMemory(
  supabase: SupabaseClient,
  userId: string,
  conversationMarkdown: string
) {
  const current = await getUserMemory(supabase, userId);

  const prompt = `你是一个记忆管理助手。请把对话中值得长期保留的稳定用户事实，合并到现有的用户记忆文档中。

规则：
1. 只记录确认过的长期事实：身份、背景、赛道偏好、风格偏好、明确的长期目标
2. 不记录一次性工具结果、临时问题、未确认猜测
3. 如果没有新的长期事实，原样返回现有记忆
4. 保持 Markdown 结构清晰
5. 只输出记忆文档本身

【现有用户记忆】
${current || defaultUserMemory()}

【本轮对话】
${conversationMarkdown}`;

  try {
    const updated = await chat({
      systemPrompt: "你是记忆管理助手，只输出更新后的 Markdown 用户记忆文档。",
      userContent: prompt,
    });

    if (updated?.trim()) {
      await saveUserMemory(supabase, userId, updated.trim());
    }
  } catch {
    // 记忆压缩失败不影响主流程
  }
}

export async function compactAndSaveJourneyProjectMemory(
  supabase: SupabaseClient,
  journeyId: string,
  conversationMarkdown: string
) {
  const current = (await getJourneyProjectMemory(supabase, journeyId)) || defaultJourneyProjectMemory();

  const prompt = `你是一个项目记忆管理助手。请把对话中已经确认的项目级策略信息，合并到现有的项目记忆文档中。

规则：
1. 只记录项目级信息：当前策略、已验证选题模式、增长假设、对标观察
2. 不记录用户全局身份信息
3. 不记录一次性工具报错和未确认猜测
4. 如果没有新的项目级事实，原样返回现有记忆
5. 保持 Markdown 结构清晰
6. 只输出文档本身

【现有项目记忆】
${current}

【本轮对话 / 工具摘要】
${conversationMarkdown}`;

  try {
    const updated = await chat({
      systemPrompt: "你是项目记忆管理助手，只输出更新后的 Markdown 项目记忆文档。",
      userContent: prompt,
    });

    if (updated?.trim()) {
      await saveJourneyProjectMemory(supabase, journeyId, updated.trim());
    }
  } catch {
    // 项目记忆压缩失败不影响主流程
  }
}

// Backward compatible alias
export async function compactAndSaveMemory(
  supabase: SupabaseClient,
  userId: string,
  conversationMarkdown: string
) {
  return compactAndSaveUserMemory(supabase, userId, conversationMarkdown);
}

// ---------------------------------------------------------------------------
// Prompt Formatting
// ---------------------------------------------------------------------------

export function formatMemoryForPrompt(userMemory: string): string {
  if (!userMemory.trim()) return "（暂无用户记忆）";
  return userMemory.trim();
}

export function formatProjectMemoryForPrompt(projectMemory: string): string {
  if (!projectMemory.trim()) return "（暂无项目记忆）";
  return projectMemory.trim();
}

export function extractIdentityMemoFromUserMemory(userMemory: string): string {
  if (!userMemory.trim()) return "";

  const lines = userMemory.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 身份与背景");
  if (headingIndex === -1) return "";

  const content: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("## ")) break;
    content.push(line);
  }

  return content.join("\n").trim() === "（暂无）" ? "" : content.join("\n").trim();
}

export function mergeIdentityMemoIntoUserMemory(
  userMemory: string,
  identityMemo: string
): string {
  const source = userMemory.trim() || defaultUserMemory();
  const lines = source.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 身份与背景");
  if (headingIndex === -1) return source;

  let nextHeadingIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("## ")) {
      nextHeadingIndex = i;
      break;
    }
  }

  const replacement = (identityMemo.trim() || "（暂无）").split(/\r?\n/);
  const updated = [
    ...lines.slice(0, headingIndex + 1),
    ...replacement,
    ...lines.slice(nextHeadingIndex),
  ];

  return updated.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Templates
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

function defaultJourneyProjectMemory() {
  return [
    "# 项目记忆",
    "",
    "## 当前策略卡片",
    "- 待建立",
    "",
    "## 已验证选题模式",
    "- 暂无",
    "",
    "## 当前增长假设",
    "- 暂无",
    "",
    "## 当前对标观察",
    "- 暂无",
  ].join("\n");
}
