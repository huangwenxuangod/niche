import { type SupabaseClient } from "@supabase/supabase-js";
import { runProjectMemoryCaptureChain } from "@/lib/agent/chains/project-memory-capture";
import { runRoundSummaryChain } from "@/lib/agent/chains/round-summary";

export type IdentityProfile = {
  about: string;
  niche: string;
  targetPlatform: string;
  targetUser: string;
  currentGoal: string;
  stylePreference: string;
};

export type ProjectCard = {
  project_name: string;
  niche: string;
  platform: string;
  positioning: string;
  target_user: string;
  core_value: string;
  current_stage: string;
  current_goal: string;
  success_metric: string;
  content_style: string;
  distribution_channels: string[];
};

export type JourneyStrategyState = {
  confirmed_benchmarks: string[];
  confirmed_directions: string[];
  current_content_strategy: string;
  last_generated_asset: string;
  last_publish_state: string;
  current_blockers: string[];
  current_todos: string[];
  next_best_action: string;
  current_problem: string;
  current_focus_keyword: string;
  focus_confidence: number;
  current_benchmark_name: string;
  last_search_mode: string;
  last_successful_keyword: string;
  next_best_question: string;
};

export type RoundSummary = {
  user_intent: string;
  confirmed_decisions: string[];
  produced_outputs: string[];
  open_questions: string[];
  next_action: string;
  created_at: string;
};

export type JourneyProjectMemory = {
  project_card: ProjectCard;
  strategy_state: JourneyStrategyState;
  recent_summaries: RoundSummary[];
};

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

export async function getJourneyProjectMemory(supabase: SupabaseClient, journeyId: string) {
  const { data, error } = await supabase
    .from("journey_project_memories")
    .select("project_card, strategy_state, recent_summaries")
    .eq("journey_id", journeyId)
    .single();

  if (error || !data) {
    return buildDefaultJourneyProjectMemory();
  }

  return {
    project_card: normalizeProjectCard(data.project_card),
    strategy_state: normalizeJourneyStrategyState(data.strategy_state),
    recent_summaries: normalizeRoundSummaries(data.recent_summaries),
  };
}

export async function saveJourneyProjectMemory(
  supabase: SupabaseClient,
  journeyId: string,
  userId: string,
  memory: JourneyProjectMemory
) {
  await supabase.from("journey_project_memories").upsert(
    {
      journey_id: journeyId,
      user_id: userId,
      project_card: memory.project_card,
      strategy_state: memory.strategy_state,
      recent_summaries: memory.recent_summaries,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "journey_id" }
  );
}

export async function ensureJourneyProjectMemory(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    projectName?: string;
    platform?: string;
    nicheLevel1?: string;
    nicheLevel2?: string;
    nicheLevel3?: string;
  }
) {
  const { data, error } = await supabase
    .from("journey_project_memories")
    .select("journey_id")
    .eq("journey_id", params.journeyId)
    .single();

  if (data?.journey_id && !error) {
    return getJourneyProjectMemory(supabase, params.journeyId);
  }

  const memory = buildDefaultJourneyProjectMemory({
    projectName: params.projectName,
    platform: params.platform,
    nicheLevel1: params.nicheLevel1,
    nicheLevel2: params.nicheLevel2,
    nicheLevel3: params.nicheLevel3,
  });
  await saveJourneyProjectMemory(supabase, params.journeyId, params.userId, memory);
  return memory;
}

export async function updateProjectCard(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    patch: Partial<ProjectCard>;
  }
) {
  const current = await getJourneyProjectMemory(supabase, params.journeyId);
  const next: JourneyProjectMemory = {
    ...current,
    project_card: normalizeProjectCard({
      ...current.project_card,
      ...params.patch,
      distribution_channels:
        params.patch.distribution_channels ?? current.project_card.distribution_channels,
    }),
  };
  await saveJourneyProjectMemory(supabase, params.journeyId, params.userId, next);
  return next;
}

export async function updateJourneyStrategyState(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    patch: Partial<JourneyStrategyState>;
  }
) {
  const current = await getJourneyProjectMemory(supabase, params.journeyId);
  const strategy = current.strategy_state;
  const next: JourneyProjectMemory = {
    ...current,
    strategy_state: normalizeJourneyStrategyState({
      ...strategy,
      ...params.patch,
      confirmed_benchmarks: mergeUniqueStrings(strategy.confirmed_benchmarks, params.patch.confirmed_benchmarks),
      confirmed_directions: mergeUniqueStrings(strategy.confirmed_directions, params.patch.confirmed_directions),
      current_blockers: mergeUniqueStrings(strategy.current_blockers, params.patch.current_blockers),
      current_todos: mergeUniqueStrings(strategy.current_todos, params.patch.current_todos),
    }),
  };
  await saveJourneyProjectMemory(supabase, params.journeyId, params.userId, next);
  return next;
}

export async function appendRoundSummary(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    summary: Omit<RoundSummary, "created_at"> & { created_at?: string };
  }
) {
  const current = await getJourneyProjectMemory(supabase, params.journeyId);
  const summary: RoundSummary = {
    user_intent: params.summary.user_intent.trim(),
    confirmed_decisions: sanitizeStringList(params.summary.confirmed_decisions),
    produced_outputs: sanitizeStringList(params.summary.produced_outputs),
    open_questions: sanitizeStringList(params.summary.open_questions),
    next_action: params.summary.next_action.trim(),
    created_at: params.summary.created_at || new Date().toISOString(),
  };

  const recent = [summary, ...current.recent_summaries].slice(0, 8);
  const next: JourneyProjectMemory = {
    ...current,
    recent_summaries: recent,
  };

  await saveJourneyProjectMemory(supabase, params.journeyId, params.userId, next);
  return next;
}

export async function appendStructuredRoundSummary(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    summary: Omit<RoundSummary, "created_at"> & { created_at?: string };
  }
) {
  try {
    const structured = await runRoundSummaryChain({
      journeyId: params.journeyId,
      userId: params.userId,
      userIntent: params.summary.user_intent,
      confirmedDecisions: params.summary.confirmed_decisions,
      producedOutputs: params.summary.produced_outputs,
      openQuestions: params.summary.open_questions,
      nextAction: params.summary.next_action,
    });

    return appendRoundSummary(supabase, {
      ...params,
      summary: {
        ...structured,
        created_at: params.summary.created_at,
      },
    });
  } catch {
    return appendRoundSummary(supabase, params);
  }
}

export async function captureProjectMemoryFromMessage(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    content: string;
  }
) {
  const text = params.content.replace(/\s+/g, " ").trim();
  if (!text) return;

  try {
    const structured = await runProjectMemoryCaptureChain({
      journeyId: params.journeyId,
      userId: params.userId,
      content: text,
    });

    const projectPatch = removeEmptyFields(structured.project_card_patch);
    const strategyPatch = removeEmptyFields(structured.strategy_patch);

    if (Object.keys(projectPatch).length) {
      await updateProjectCard(supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: projectPatch,
      });
    }

    if (Object.keys(strategyPatch).length) {
      await updateJourneyStrategyState(supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: strategyPatch,
      });
    }

    if (Object.keys(projectPatch).length || Object.keys(strategyPatch).length) {
      return;
    }
  } catch {
    // Fall back to rule-based extraction below.
  }

  const projectPatch: Partial<ProjectCard> = {};
  const strategyPatch: Partial<JourneyStrategyState> = {};

  if (/AI内容增长教练|内容增长教练/.test(text)) {
    projectPatch.positioning = "AI 内容增长教练";
  }

  if (/冷启动\s*KOC|普通\s*KOC|普通创作者/.test(text)) {
    projectPatch.target_user = "冷启动 KOC";
  }

  if (/社媒通用/.test(text)) {
    projectPatch.platform = "社媒通用";
    projectPatch.distribution_channels = mergeUniqueStrings([], ["社媒通用"]);
  }

  if (/公众号先落地|公众号优先|先做公众号/.test(text)) {
    projectPatch.distribution_channels = mergeUniqueStrings(
      projectPatch.distribution_channels ?? [],
      ["公众号"]
    );
  }

  if (/更懂用户痛点|用户痛点/.test(text)) {
    projectPatch.current_goal = "更懂冷启动 KOC 的真实痛点";
  } else if (/涨粉|增长/.test(text)) {
    projectPatch.current_goal = "帮助冷启动 KOC 找到增长路径并产出优质内容";
  }

  if (/比赛|评审|提交物|Demo|录屏/.test(text)) {
    projectPatch.current_stage = "比赛打磨";
  }

  const benchmarkMatches = text.match(/数字生命卡兹克|Claude Code|GPT5\.5|GPT-5\.5/g);
  if (benchmarkMatches?.length) {
    strategyPatch.confirmed_benchmarks = benchmarkMatches;
    strategyPatch.current_benchmark_name = benchmarkMatches[0];
  }

  if (/对标|差距|内容策略/.test(text)) {
    strategyPatch.current_content_strategy = "先做对标分析，再反推内容策略与选题";
  }

  if (/想做|想写|想讲|卡在|不知道怎么/.test(text)) {
    strategyPatch.current_problem = text.slice(0, 120);
  }

  if (/下一步|先做|先改|优先/.test(text)) {
    strategyPatch.next_best_action = text.slice(0, 120);
  }

  if (Object.keys(projectPatch).length) {
    await updateProjectCard(supabase, {
      journeyId: params.journeyId,
      userId: params.userId,
      patch: projectPatch,
    });
  }

  if (Object.keys(strategyPatch).length) {
    await updateJourneyStrategyState(supabase, {
      journeyId: params.journeyId,
      userId: params.userId,
      patch: strategyPatch,
    });
  }
}

export function formatJourneyProjectMemoryForPrompt(memory: JourneyProjectMemory) {
  const card = memory.project_card;
  const strategy = memory.strategy_state;
  const latest = memory.recent_summaries[0];

  return [
    "【项目档案卡】",
    `- 项目名称：${card.project_name || "未命名项目"}`,
    `- 赛道定位：${card.niche || "待确认"}`,
    `- 平台策略：${card.platform || "待确认"}`,
    `- 产品定位：${card.positioning || "待确认"}`,
    `- 目标用户：${card.target_user || "待确认"}`,
    `- 当前阶段：${card.current_stage || "待确认"}`,
    `- 当前目标：${card.current_goal || "待确认"}`,
    `- 内容风格：${card.content_style || "待确认"}`,
    "",
    "【旅程策略状态】",
    `- 已确认对标：${strategy.confirmed_benchmarks.join("、") || "暂无"}`,
    `- 已确认方向：${strategy.confirmed_directions.join("、") || "暂无"}`,
    `- 当前内容策略：${strategy.current_content_strategy || "待确认"}`,
    `- 当前问题：${strategy.current_problem || "待确认"}`,
    `- 当前焦点词：${strategy.current_focus_keyword || "待确认"}`,
    `- 焦点置信度：${strategy.focus_confidence ? `${Math.round(strategy.focus_confidence * 100)}%` : "待确认"}`,
    `- 当前对标号：${strategy.current_benchmark_name || "待确认"}`,
    `- 最近产出：${strategy.last_generated_asset || "暂无"}`,
    `- 发布状态：${strategy.last_publish_state || "暂无"}`,
    `- 最近搜索模式：${strategy.last_search_mode || "暂无"}`,
    `- 最近成功关键词：${strategy.last_successful_keyword || "暂无"}`,
    `- 当前阻塞：${strategy.current_blockers.join("；") || "暂无"}`,
    `- 当前待办：${strategy.current_todos.join("；") || "暂无"}`,
    `- 下一步：${strategy.next_best_action || "待确认"}`,
    `- 建议追问：${strategy.next_best_question || "待确认"}`,
    "",
    "【本轮结论】",
    latest
      ? `- 用户意图：${latest.user_intent}
- 已确认：${latest.confirmed_decisions.join("；") || "暂无"}
- 产出结果：${latest.produced_outputs.join("；") || "暂无"}
- 下一步：${latest.next_action || "待确认"}`
      : "- 暂无",
  ].join("\n");
}

export function parseIdentityMemo(identityMemo: string): IdentityProfile {
  const text = identityMemo.trim();
  const fields = {
    about: readIdentityField(text, "我是谁"),
    niche: readIdentityField(text, "我的赛道"),
    targetPlatform: readIdentityField(text, "目标平台"),
    targetUser: readIdentityField(text, "目标用户"),
    currentGoal: readIdentityField(text, "当前目标"),
    stylePreference: readIdentityField(text, "表达风格"),
  };

  if (!Object.values(fields).some(Boolean) && text) {
    fields.about = text.replace(/^#\s*我是谁\s*/m, "").trim();
  }

  return fields;
}

export function buildIdentityMemo(profile: IdentityProfile) {
  return [
    "# 我是谁",
    "",
    `- 我是谁：${profile.about.trim() || "（暂未填写）"}`,
    `- 我的赛道：${profile.niche.trim() || "（暂未填写）"}`,
    `- 目标平台：${profile.targetPlatform.trim() || "（暂未填写）"}`,
    `- 目标用户：${profile.targetUser.trim() || "（暂未填写）"}`,
    `- 当前目标：${profile.currentGoal.trim() || "（暂未填写）"}`,
    `- 表达风格：${profile.stylePreference.trim() || "（暂未填写）"}`,
  ].join("\n");
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

function buildDefaultJourneyProjectMemory(params?: {
  projectName?: string;
  platform?: string;
  nicheLevel1?: string;
  nicheLevel2?: string;
  nicheLevel3?: string;
}): JourneyProjectMemory {
  const niche = [params?.nicheLevel1, params?.nicheLevel2, params?.nicheLevel3]
    .filter(Boolean)
    .join(" > ");

  return {
    project_card: normalizeProjectCard({
      project_name: params?.projectName || "Niche",
      niche,
      platform: params?.platform || "待确认",
      positioning: "AI 内容增长教练",
      target_user: "冷启动 KOC",
      core_value: "帮助用户找方向、拆对标、补差距，并快速产出可发布内容",
      current_stage: "对话启动",
      current_goal: "通过对话理解用户问题并收敛可执行方向",
      success_metric: "找到方向、产出内容、形成稳定发布闭环",
      content_style: "直接、克制、有据可查",
      distribution_channels: params?.platform ? [params.platform] : ["公众号"],
    }),
    strategy_state: normalizeJourneyStrategyState({}),
    recent_summaries: [],
  };
}

function normalizeProjectCard(value: unknown): ProjectCard {
  const source = isRecord(value) ? value : {};
  return {
    project_name: stringValue(source.project_name, "Niche"),
    niche: stringValue(source.niche, ""),
    platform: stringValue(source.platform, "待确认"),
    positioning: stringValue(source.positioning, "AI 内容增长教练"),
    target_user: stringValue(source.target_user, "冷启动 KOC"),
    core_value: stringValue(source.core_value, ""),
    current_stage: stringValue(source.current_stage, "待确认"),
    current_goal: stringValue(source.current_goal, ""),
    success_metric: stringValue(source.success_metric, ""),
    content_style: stringValue(source.content_style, ""),
    distribution_channels: sanitizeStringList(source.distribution_channels),
  };
}

function normalizeJourneyStrategyState(value: unknown): JourneyStrategyState {
  const source = isRecord(value) ? value : {};
  return {
    confirmed_benchmarks: sanitizeStringList(source.confirmed_benchmarks),
    confirmed_directions: sanitizeStringList(source.confirmed_directions),
    current_content_strategy: stringValue(source.current_content_strategy, ""),
    last_generated_asset: stringValue(source.last_generated_asset, ""),
    last_publish_state: stringValue(source.last_publish_state, ""),
    current_blockers: sanitizeStringList(source.current_blockers),
    current_todos: sanitizeStringList(source.current_todos),
    next_best_action: stringValue(source.next_best_action, ""),
    current_problem: stringValue(source.current_problem, ""),
    current_focus_keyword: stringValue(source.current_focus_keyword, ""),
    focus_confidence: numberValue(source.focus_confidence, 0),
    current_benchmark_name: stringValue(source.current_benchmark_name, ""),
    last_search_mode: stringValue(source.last_search_mode, ""),
    last_successful_keyword: stringValue(source.last_successful_keyword, ""),
    next_best_question: stringValue(source.next_best_question, ""),
  };
}

function normalizeRoundSummaries(value: unknown): RoundSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      return {
        user_intent: stringValue(item.user_intent, ""),
        confirmed_decisions: sanitizeStringList(item.confirmed_decisions),
        produced_outputs: sanitizeStringList(item.produced_outputs),
        open_questions: sanitizeStringList(item.open_questions),
        next_action: stringValue(item.next_action, ""),
        created_at: stringValue(item.created_at, new Date().toISOString()),
      };
    })
    .filter((item): item is RoundSummary => Boolean(item && item.user_intent));
}

function sanitizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function mergeUniqueStrings(current: string[] = [], incoming: unknown) {
  return Array.from(new Set([...current, ...sanitizeStringList(incoming)]));
}

function stringValue(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function numberValue(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeEmptyFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => {
      if (Array.isArray(fieldValue)) return fieldValue.length > 0;
      return String(fieldValue ?? "").trim().length > 0;
    })
  ) as Partial<T>;
}

function readIdentityField(text: string, label: string) {
  const match = text.match(new RegExp(`^-\\s*${escapeRegex(label)}：\\s*(.+)$`, "m"));
  return match?.[1]?.trim() || "";
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
