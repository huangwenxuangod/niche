import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserMemory, formatMemoryForPrompt } from "./memory";
import { getSessionSteps, type StepRecord } from "./agent/memory/session-memory";

type PromptKoc = {
  account_name: string;
  max_read_count: number;
  avg_read_count: number;
};

type PromptViralArticle = {
  title: string;
  read_count: number;
  koc_sources: { account_name: string } | { account_name: string }[] | null;
};

/**
 * 从步骤中提取最近执行的工具序列
 */
function extractRecentTools(steps: StepRecord[], limit = 5): string {
  const toolCalls = steps
    .filter((s) => s.type === "tool_call")
    .slice(-limit);

  if (toolCalls.length === 0) return "（本次对话尚未调用工具）";

  return toolCalls
    .map((step) => {
      const content = step.content as { tool: string; args: unknown };
      const args = typeof content.args === "object" && content.args !== null
        ? Object.entries(content.args)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`)
            .join(", ")
        : "";
      return `- ${content.tool}${args ? ` (${args})` : ""}`;
    })
    .join("\n");
}

/**
 * 从步骤中提取最近的结果摘要
 */
function extractRecentResults(steps: StepRecord[], limit = 3): string {
  const results = steps
    .filter((s) => s.type === "observation")
    .slice(-limit);

  if (results.length === 0) return "（暂无工具执行结果）";

  return results
    .map((step) => {
      const content = step.content as { tool: string; result?: unknown; error?: string };
      if (content.error) {
        return `- ${content.tool}: ❌ 失败 - ${content.error.slice(0, 100)}`;
      }
      const summary = typeof content.result === "object" && content.result !== null
        ? JSON.stringify(content.result).slice(0, 150)
        : String(content.result).slice(0, 150);
      return `- ${content.tool}: ✅ ${summary}${summary.length >= 150 ? "..." : ""}`;
    })
    .join("\n");
}

/**
 * 分析是否有工具执行失败
 */
function extractErrors(steps: StepRecord[]): string {
  const errors = steps.filter(
    (s) => s.type === "observation" && (s.content as { error?: string }).error
  );

  if (errors.length === 0) return "";

  return errors
    .map((step) => {
      const content = step.content as { tool: string; error: string };
      return `- ${content.tool}: ${content.error.slice(0, 150)}`;
    })
    .join("\n");
}

export async function buildSystemPrompt(
  journeyId: string,
  userId: string,
  supabase: SupabaseClient,
  conversationId?: string
): Promise<string> {
  const [journeyRes, kocRes, viralRes, userMemory, sessionSteps] = await Promise.all([
    supabase.from("journeys").select("*").eq("id", journeyId).single(),
    supabase
      .from("koc_sources")
      .select("account_name, max_read_count, avg_read_count")
      .eq("journey_id", journeyId)
      .order("max_read_count", { ascending: false })
      .limit(12),
    supabase
      .from("knowledge_articles")
      .select("title, read_count, koc_sources(account_name)")
      .eq("journey_id", journeyId)
      .eq("is_viral", true)
      .order("read_count", { ascending: false })
      .limit(8),
    getUserMemory(supabase, userId),
    getSessionSteps(supabase, conversationId),
  ]);

  const journey = journeyRes.data;
  if (!journey) return "你是 Niche，一个 AI 内容增长教练。";

  const kocList = (kocRes.data ?? []) as PromptKoc[];
  const viralArticles = (viralRes.data ?? []) as PromptViralArticle[];

  // 构建情景记忆摘要
  const recentTools = extractRecentTools(sessionSteps);
  const recentResults = extractRecentResults(sessionSteps);
  const errorLog = extractErrors(sessionSteps);

  return `你是 Niche，一个面向冷启动 KOC 的 AI 内容增长教练。
你专注帮助用户搞清楚靠什么变现、选对赛道、拆对标、补差距，并把增长策略直接变成可发布内容。
风格：直接、有据可查、像一个真正懂增长的内容教练，不讲废话，不贩卖焦虑。
用中文回答。用 **粗体** 标注关键建议或数据。

【用户记忆】（跨对话长期记忆）
${formatMemoryForPrompt(userMemory)}

【本次对话执行历史】（情景记忆）
已执行步骤数：${sessionSteps.length}

最近调用的工具：
${recentTools}

最近获得的结果：
${recentResults}

${errorLog ? `⚠️ 执行错误记录：\n${errorLog}` : ""}

【记忆驱动原则】
1. 每次回复前先读【本次对话执行历史】，了解已完成的工作
2. 如果上一步工具调用失败，先分析原因再决定：重试 / 换参数 / 换工具
3. 不要重复调用已经成功的工具（除非用户明确要求重新执行）
4. 工具调用前，检查依赖是否已满足（例如：导入账号前需要先搜索）

【工具调用原则】
1. 没有账号名时禁止调 import_koc_by_name，先用 search_wechat_hot_articles 找到账号再导入
2. 工具报错时分析原因，换参数或换工具重试，不要直接把错误暴露给用户
3. 多步任务顺序调用，前一个结果作为下一个的输入
4. 需要真实数据时先调工具再回答，不要假设你已经知道最新热点或对标数据

【记忆写入】
每次对话里用户确认了重要事实，在回答末尾用标签标记：
<memory>确认赛道：AI工具 > 效率提升</memory>
<memory>导入对标账号：数字生命卡兹克</memory>
可以有多个 memory 标签，每个标签一条事实。

【可用工具】
1. search_hot_topics：搜索赛道近几天热点
2. search_wechat_hot_articles：用关键词搜索公众号爆文，找优质账号样本
3. import_koc_by_name：导入明确账号名的对标账号到知识库
4. analyze_my_account：分析用户自己的公众号
5. analyze_journey_data：分析已导入的对标账号和爆款文章规律
6. search_knowledge_base：检索已导入的对标文章
7. generate_topics：生成候选选题
8. generate_full_article：生成可发布级公众号完整初稿
9. compliance_check：检查内容合规和限流风险

【通用规则】
- 当工具返回的数据不够时，明确说出局限，不要编造数据
- 最终回答像内容顾问，而不是机械罗列工具结果
- 禁止生成模板话术，不要以"如果你要，我可以继续""我还可以帮你"开头的功能推销句子
- 搜公众号爆文只用一个唯一关键词短语

【已导入的对标账号（${kocList.length} 位）】
${
  kocList.length > 0
    ? kocList
        .map((k) => `- ${k.account_name}：最高阅读 ${fmtNum(k.max_read_count)}，均值 ${fmtNum(k.avg_read_count)}`)
        .join("\n")
    : "（暂无）"
}

【近期赛道爆款内容】
${
  viralArticles.length > 0
    ? viralArticles
        .map((a) => {
          const kocSrc = a.koc_sources;
          const kocName = Array.isArray(kocSrc)
            ? (kocSrc[0]?.account_name ?? "未知")
            : (kocSrc?.account_name ?? "未知");
          return `- 《${a.title}》| ${kocName} | 阅读 ${fmtNum(a.read_count)}`;
        })
        .join("\n")
    : "（暂无）"
}

基于以上情报，帮助用户解决内容创作的具体问题。每次给出建议时，必须结合真实数据，不要泛泛而谈。`;
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}
