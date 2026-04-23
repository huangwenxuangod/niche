import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * 获取用户记忆
 */
export async function getUserMemory(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("user_memories")
    .select("content")
    .eq("user_id", userId)
    .single();
  return data?.content || "";
}

/**
 * 获取旅程记忆
 */
export async function getJourneyMemory(supabase: SupabaseClient, journeyId: string) {
  const { data } = await supabase
    .from("journey_memories")
    .select("content")
    .eq("journey_id", journeyId)
    .single();
  return data?.content || "";
}

/**
 * 保存用户记忆
 */
export async function saveUserMemory(supabase: SupabaseClient, userId: string, markdown: string) {
  await supabase.from("user_memories").upsert(
    {
      user_id: userId,
      content: markdown.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

/**
 * 保存旅程记忆
 */
export async function saveJourneyMemory(supabase: SupabaseClient, journeyId: string, markdown: string) {
  await supabase.from("journey_memories").upsert(
    {
      journey_id: journeyId,
      content: markdown.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "journey_id" }
  );
}

/**
 * 同步用户身份记忆
 */
export async function syncUserIdentityMemory(supabase: SupabaseClient, userId: string, identityMemo: string) {
  const current = await getUserMemory(supabase, userId);
  const next = upsertSection(
    current || defaultUserMemory(),
    "我是谁",
    identityMemo.trim() || "（暂未填写）"
  );
  await saveUserMemory(supabase, userId, next);
  return next;
}

/**
 * 确保旅程记忆存在（不存在则初始化）
 */
export async function ensureJourneyMemory(supabase: SupabaseClient, params: {
  journeyId: string;
  platform: string;
  nicheLevel1: string;
  nicheLevel2: string;
  nicheLevel3: string;
}) {
  const existing = await getJourneyMemory(supabase, params.journeyId);
  if (existing) return existing;

  const markdown = [
    "# 旅程记忆",
    "",
    "## 当前赛道",
    `${params.platform} | ${params.nicheLevel1} > ${params.nicheLevel2} > ${params.nicheLevel3}`,
    "",
    "## 选题偏好",
    "- 待沉淀",
    "",
    "## 风格偏好",
    "- 待沉淀",
    "",
    "## 已确认选题",
    "- 暂无",
    "",
    "## 用户反馈",
    "- 暂无",
  ].join("\n");

  await saveJourneyMemory(supabase, params.journeyId, markdown);
  return markdown;
}

/**
 * 从消息中捕获记忆
 */
export async function captureMessageMemory(supabase: SupabaseClient, params: {
  userId: string;
  journeyId: string;
  content: string;
}) {
  const entries = inferMemoryEntries(params.content);
  if (!entries.length) return;

  let userMemory = (await getUserMemory(supabase, params.userId)) || defaultUserMemory();
  let journeyMemory = (await getJourneyMemory(supabase, params.journeyId)) || defaultJourneyMemory();

  for (const entry of entries) {
    if (entry.scope === "user") {
      userMemory = appendBullet(userMemory, entry.section, entry.text);
    } else {
      journeyMemory = appendBullet(journeyMemory, entry.section, entry.text);
    }
  }

  await Promise.all([
    saveUserMemory(supabase, params.userId, userMemory),
    saveJourneyMemory(supabase, params.journeyId, journeyMemory),
  ]);
}

/**
 * 追加旅程记忆
 */
export async function appendJourneyMemory(supabase: SupabaseClient, journeyId: string, section: string, text: string) {
  const current = (await getJourneyMemory(supabase, journeyId)) || defaultJourneyMemory();
  const next = appendBullet(current, section, text);
  await saveJourneyMemory(supabase, journeyId, next);
  return next;
}

/**
 * 从消息内容推断记忆条目
 */
function inferMemoryEntries(content: string) {
  const text = content.trim();
  const entries: Array<{
    scope: "user" | "journey";
    section: string;
    text: string;
  }> = [];

  if (!text) return entries;

  if (/(以后|之后|接下来).*(风格|语气|写法)|我(更)?喜欢.*(风格|语气|写法)|按.*风格写/.test(text)) {
    entries.push({
      scope: "user",
      section: "风格偏好",
      text,
    });
  }

  if (/(选题|方向|主题).*(喜欢|优先|偏好|想做)|我(更)?喜欢.*(选题|方向|主题)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "选题偏好",
      text,
    });
  }

  if (/(这个选题不错|这个方向可以|采用这个选题|就写这个|这个可以写)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "已确认选题",
      text,
    });
  }

  if (/(太空了|不要这种|太像别人了|这个不错|这个很好|这个不行|不喜欢这个)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "用户反馈",
      text,
    });
  }

  return entries;
}

/**
 * 追加项目符号
 */
function appendBullet(markdown: string, section: string, text: string) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const current = ensureSection(markdown, section, "- 暂无");
  const marker = `- ${cleanText}`;
  if (current.includes(marker)) return current;

  const regex = new RegExp(`(## ${escapeRegex(section)}\\n)([\\s\\S]*?)(\\n## |$)`);
  const match = current.match(regex);
  if (!match) return current;

  const body = match[2]
    .split("\n")
    .filter((line) => line.trim() && line.trim() !== "- 暂无");
  const nextBody = [...body, marker].join("\n");

  return current.replace(regex, `$1${nextBody}$3`);
}

/**
 * 更新或插入章节
 */
function upsertSection(markdown: string, section: string, body: string) {
  const current = ensureSection(markdown, section, "（暂未填写）");
  const regex = new RegExp(`(## ${escapeRegex(section)}\\n)([\\s\\S]*?)(\\n## |$)`);
  return current.replace(regex, `$1${body.trim() || "（暂未填写）"}$3`);
}

/**
 * 确保章节存在
 */
function ensureSection(markdown: string, section: string, defaultBody: string) {
  if (markdown.includes(`## ${section}`)) {
    return markdown;
  }

  return `${markdown.trim()}\n\n## ${section}\n${defaultBody}`;
}

/**
 * 默认用户记忆
 */
function defaultUserMemory() {
  return [
    "# 用户记忆",
    "",
    "## 我是谁",
    "（暂未填写）",
    "",
    "## 风格偏好",
    "- 暂无",
    "",
    "## 选题偏好",
    "- 暂无",
  ].join("\n");
}

/**
 * 默认旅程记忆
 */
function defaultJourneyMemory() {
  return [
    "# 旅程记忆",
    "",
    "## 当前赛道",
    "（暂未初始化）",
    "",
    "## 选题偏好",
    "- 暂无",
    "",
    "## 风格偏好",
    "- 暂无",
    "",
    "## 已确认选题",
    "- 暂无",
    "",
    "## 用户反馈",
    "- 暂无",
  ].join("\n");
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
