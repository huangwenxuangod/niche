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
    "## 我的公众号",
    "（暂无）",
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

  const prompt = `你是一个创作者认知记忆助手。请把这一轮对话里值得长期保留的用户认知，合并到现有的用户记忆文档中。

你维护的不是资料库，而是“这个用户是谁、反复在意什么、已经形成了哪些判断”的认知母本。

规则：
1. 只记录长期有效的认知资产：反复在意的问题、已经形成的判断、还没想透的问题、关键经历、长期主题、当前核心对标、从核心对标学到的可迁移资产
2. 优先保留用户自己的判断、经历、反对意见、价值偏好；不要把 AI 为了成稿而补的套话、模板话、空泛方法论写进去
3. 不记录一次性工具结果、临时安排、表层闲聊、未确认猜测
4. 如果本轮只有成稿，没有新增认知，就尽量保持原文档不动
5. 允许把散乱表达提炼成更稳定的一两句判断，但不要改写到失去原意
6. 保持现有 Markdown 结构，不要新增奇怪层级
7. 只输出更新后的 Markdown 文档本身，不要解释

【现有用户记忆】
${current || defaultUserMemory()}

【本轮对话】
${conversationMarkdown}`;

  try {
    const updated = await chat({
      systemPrompt: "你是创作者认知记忆助手，只输出更新后的 Markdown 用户记忆文档。",
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

  const prompt = `你是一个项目记忆助手。请把这一轮对话里已经相对明确的项目级信息，合并到现有的项目记忆文档中。

规则：
1. 只记录项目级内容：我的公众号、当前策略卡片、已验证选题模式、当前增长假设、当前对标观察
2. 优先记录对写作和长期产出真的有帮助的东西，而不是把整轮回答搬进来
3. 不记录用户全局身份信息，不记录一次性工具报错，不记录未确认猜测
4. 如果这一轮只是继续写稿、没有新的项目级信息，就尽量保持原文档不动
5. 可以把零散信息压缩成简洁条目，但不要凭空补结论
6. 保持 Markdown 结构清晰
7. 只输出更新后的 Markdown 文档本身，不要解释

【现有项目记忆】
${current}

【本轮对话 / 工具摘要】
${conversationMarkdown}`;

  try {
    const updated = await chat({
      systemPrompt: "你是项目记忆助手，只输出更新后的 Markdown 项目记忆文档。",
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
  const headingIndex = lines.findIndex((line) => line.trim() === "## 我目前形成的判断");
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
  const headingIndex = lines.findIndex((line) => line.trim() === "## 我目前形成的判断");
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

export function extractOwnedWechatAccountNameFromProjectMemory(projectMemory: string): string {
  if (!projectMemory.trim()) return "";

  const lines = projectMemory.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 我的公众号");
  if (headingIndex === -1) return "";

  const content: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("## ")) break;
    content.push(line);
  }

  const merged = content.join("\n").trim();
  return merged === "（暂无）" ? "" : merged;
}

export function mergeOwnedWechatAccountNameIntoProjectMemory(
  projectMemory: string,
  accountName: string
): string {
  const source = projectMemory.trim() || defaultJourneyProjectMemory();
  const lines = source.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === "## 我的公众号");
  if (headingIndex === -1) return source;

  let nextHeadingIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("## ")) {
      nextHeadingIndex = i;
      break;
    }
  }

  const replacement = (accountName.trim() || "（暂无）").split(/\r?\n/);
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
    "# 用户认知",
    "",
    "## 我反复在意的问题",
    "（暂无）",
    "",
    "## 我目前形成的判断",
    "（暂无）",
    "",
    "## 我还没想透的问题",
    "（暂无）",
    "",
    "## 我的关键经历",
    "（暂无）",
    "",
    "## 我的长期主题",
    "（暂无）",
    "",
    "## 当前核心对标",
    "（暂无）",
    "",
    "## 我从核心对标学到的可迁移资产",
    "（暂无）",
  ].join("\n");
}

function defaultJourneyProjectMemory() {
  return [
    "# 项目记忆",
    "",
    "## 我的公众号",
    "（暂无）",
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
