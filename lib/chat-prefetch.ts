import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import { retrieveSemanticCompetitorContent } from "@/lib/agent/retrievers/semantic-knowledge";
import { retrieveOwnedContent } from "@/lib/agent/retrievers/owned-content";
import { searchWebContext } from "@/lib/web-search";
import { recordStep } from "@/lib/agent/memory/session-memory";
import type { ToolExecutionContext } from "@/lib/agent/tools/types";
import { runAnalyzeJourneyData } from "@/lib/agent/tools/analyze-journey-data";
import { runAnalyzeWxvideoData } from "@/lib/agent/tools/analyze-wxvideo-data";
import { runAnalyzePublishTiming } from "@/lib/agent/tools/analyze-publish-timing";
import { runImportKocByName } from "@/lib/agent/tools/import-koc-by-name";
import type { ToolContextJourney } from "@/lib/agent/tools/types";
import type { ChatIntent, ConfirmationContext } from "./chat-intent-router";
import { extractExplicitAccountName } from "./chat-intent-router";
import type { DeterministicToolName, PerfLogger, PrefetchedContext } from "./chat-runtime";
import { trimText } from "./chat-runtime";
import { detectArticleMode } from "./cognitive-gap";

export async function prefetchIntentContext(params: {
  intent: ChatIntent;
  userContent: string;
  confirmationContext: ConfirmationContext;
  context: ToolExecutionContext;
  send: (payload: Record<string, unknown>) => void;
  perf: PerfLogger;
}): Promise<PrefetchedContext> {
  const { intent, userContent, confirmationContext, context, send, perf } = params;

  switch (intent) {
    case "topics": {
      sendStatus(send, "准备选题素材中", perf);
      const webQuery = buildWebSearchQuery(intent, userContent, context.journey);
      const [journeyAnalysis, ownedContent, webContext] = await Promise.all([
        runObservedTool(
          "analyze_journey_data",
          { focus: "topic_generation" },
          context,
          send
        ),
        retrieveOwnedContent(context.supabase, {
          journeyId: context.journeyId,
          limit: 8,
        }).catch(() => []),
        shouldAutoWebSearchForIntent(intent, userContent, context.journey)
          ? runObservedTool("web_search", { query: webQuery }, context, send)
          : Promise.resolve(null),
      ]);
      return { intent, data: { journeyAnalysis, ownedContent, webContext } };
    }
    case "full_article": {
      sendStatus(send, "准备写作素材中", perf);
      const topic = resolveArticleTopic(userContent, confirmationContext, context.journey?.keywords ?? []);
      const [journeyAnalysis, knowledge, ownedContent, semanticReferences, webContext] = await Promise.all([
        runObservedTool("analyze_journey_data", { focus: "viral_patterns" }, context, send),
        searchJourneyKnowledge(context.supabase, context.journeyId, topic.title, 5),
        retrieveOwnedContent(context.supabase, {
          journeyId: context.journeyId,
          limit: 8,
        }).catch(() => []),
        retrieveSemanticCompetitorContent(context.supabase, {
          journeyId: context.journeyId,
          query: [topic.title, topic.angle].filter(Boolean).join("\n"),
          limit: 6,
        }).catch(() => []),
        shouldAutoWebSearchForIntent(intent, userContent, context.journey)
          ? runObservedTool("web_search", { query: [topic.title, topic.angle].filter(Boolean).join(" ") }, context, send)
          : Promise.resolve(null),
      ]);
      return {
        intent,
        topicTitle: topic.title,
        topicAngle: topic.angle,
        data: {
          journeyAnalysis,
          knowledge,
          ownedContent,
          webContext,
          semanticReferences: semanticReferences.map((item) => ({
            article_title: item.article_title,
            account_name: item.account_name,
            similarity: Number(item.similarity.toFixed(2)),
            chunk_text: trimText(item.chunk_text, 180),
          })),
        },
      };
    }
    case "publish_timing": {
      sendStatus(send, "分析发布时间中", perf);
      const publishTiming = await runObservedTool(
        "analyze_publish_timing",
        { scope: "auto" },
        context,
        send
      );
      return { intent, data: { publishTiming } };
    }
    case "growth_analysis": {
      sendStatus(send, "准备增长样本中", perf);
      const webQuery = buildWebSearchQuery(intent, userContent, context.journey);
      const [journeyAnalysis, ownedContent, wxvideoAnalysis, publishTiming, webContext] = await Promise.all([
        runObservedTool("analyze_journey_data", { focus: "viral_patterns" }, context, send),
        retrieveOwnedContent(context.supabase, {
          journeyId: context.journeyId,
          limit: 12,
        }).catch(() => []),
        runObservedTool("analyze_wxvideo_data", { focus: "viral_patterns" }, context, send),
        runObservedTool("analyze_publish_timing", { scope: "auto" }, context, send),
        shouldAutoWebSearchForIntent(intent, userContent, context.journey)
          ? runObservedTool("web_search", { query: webQuery }, context, send)
          : Promise.resolve(null),
      ]);
      return {
        intent,
        data: { journeyAnalysis, ownedContent, wxvideoAnalysis, publishTiming, webContext },
      };
    }
    case "wxvideo_analysis": {
      sendStatus(send, "准备视频号样本中", perf);
      const [wxvideoAnalysis, publishTiming] = await Promise.all([
        runObservedTool("analyze_wxvideo_data", { focus: "viral_patterns" }, context, send),
        runObservedTool("analyze_publish_timing", { scope: "wechat_channels" }, context, send),
      ]);
      return { intent, data: { wxvideoAnalysis, publishTiming } };
    }
    case "video_script": {
      sendStatus(send, "准备视频脚本素材中", perf);
      const wxvideoAnalysis = await runObservedTool(
        "analyze_wxvideo_data",
        { focus: "content_migration" },
        context,
        send
      );
      return { intent, data: { wxvideoAnalysis } };
    }
    case "import_koc_analysis": {
      sendStatus(send, "导入并分析中", perf);
      const accountName = extractExplicitAccountName(userContent);
      if (!accountName) {
        return { intent: "general", data: {} };
      }
      const importResult = await runObservedTool(
        "import_koc_by_name",
        { account_name: accountName },
        context,
        send
      );
      const [journeyAnalysis, publishTiming] = await Promise.all([
        runObservedTool("analyze_journey_data", { focus: "viral_patterns" }, context, send),
        runObservedTool("analyze_publish_timing", { scope: "wechat_mp" }, context, send),
      ]);
      return {
        intent,
        keyword: accountName,
        data: { importResult, journeyAnalysis, publishTiming },
      };
    }
    case "general":
    default:
      if (shouldAutoWebSearchForIntent(intent, userContent, context.journey)) {
        const webQuery = buildWebSearchQuery(intent, userContent, context.journey);
        const webContext = await runObservedTool(
          "web_search",
          { query: webQuery },
          context,
          send
        );
        const ownedContent = await retrieveOwnedContent(context.supabase, {
          journeyId: context.journeyId,
          limit: 6,
        }).catch(() => []);
        return { intent: "general", data: { ownedContent, webContext } };
      }
      const ownedContent = await retrieveOwnedContent(context.supabase, {
        journeyId: context.journeyId,
        limit: 6,
      }).catch(() => []);
      return { intent: "general", data: { ownedContent } };
  }
}

function buildWebSearchQuery(
  intent: ChatIntent,
  userContent: string,
  journey: ToolContextJourney | null
) {
  const keywords = (journey?.keywords ?? [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const searchIntent = extractSearchIntentFromUserText(userContent, intent);
  const benchmarkProfile = inferBenchmarkProfile(journey);
  const domainHints = inferDomainHints(journey, benchmarkProfile);

  const cleaned = userContent
    .replace(/帮我|给我|请|麻烦|重新搜索一下|重新搜一下|重新搜索|重新搜|再搜一下|再搜|搜一下|搜索一下|查一下|找一下|找找/g, " ")
    .replace(/现在|最近|最新|当前/g, " ")
    .replace(/有什么|有啥|哪些|哪个/g, " ")
    .replace(/值得写|好玩的|能写的|可写的/g, " ")
    .replace(/选题|题目|方向|写什么/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const keywordPart = keywords.join(" ");
  const domainPart = domainHints.join(" ");
  const anglePart = benchmarkProfile.angles.join(" ");
  const intentPart = searchIntent.queryHints.join(" ");
  const base = [keywordPart, domainPart, anglePart, intentPart, cleaned]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (searchIntent.type === "news_lookup") {
    const seedTerms = compressSearchTerms([
      cleaned,
      ...keywords,
      ...domainHints.slice(0, 2),
    ]);
    const uniqueTerms = seedTerms.slice(0, 4).join(" ");
    return `${uniqueTerms || cleaned || keywordPart || domainPart} 官方 博客 发布 更新 新闻`;
  }

  if (intent === "topics") {
    const topicTerms = compressSearchTerms([
      cleaned,
      ...keywords,
      ...domainHints.slice(0, 2),
      ...benchmarkProfile.angles.slice(0, 2),
      ...searchIntent.queryHints.slice(0, 2),
    ]);
    const uniqueTopicTerms = topicTerms.slice(0, 5).join(" ");
    return `${uniqueTopicTerms || keywordPart || domainPart || anglePart || "内容"} 最新更新 值得写选题`;
  }

  if (intent === "growth_analysis") {
    const analysisTerms = compressSearchTerms([
      cleaned,
      ...keywords,
      ...domainHints.slice(0, 2),
      ...benchmarkProfile.angles.slice(0, 2),
    ]);
    return `${analysisTerms.slice(0, 5).join(" ") || base || keywordPart || domainPart || anglePart || "内容"} 最新讨论 趋势`;
  }

  return base || userContent.trim();
}

export async function runObservedTool(
  toolName: DeterministicToolName,
  rawArgs: Record<string, unknown>,
  context: ToolExecutionContext,
  send: (payload: Record<string, unknown>) => void
) {
  const label = getToolLabel(toolName);
  send({ type: "tool_start", toolName, label });

  const stepId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  if (context.conversationId) {
    await recordStep(context.supabase, context.conversationId, {
      id: `${stepId}-call`,
      type: "tool_call",
      content: {
        tool: toolName,
        args: rawArgs,
        stepId,
      },
    });
  }

  try {
    const result = await executeDeterministicTool(toolName, rawArgs, context);
    send({
      type: "tool_result",
      toolName,
      label,
      payload: sanitizePayload(result),
    });

    if (context.conversationId) {
      await recordStep(context.supabase, context.conversationId, {
        id: `${stepId}-result`,
        type: "observation",
        content: {
          tool: toolName,
          stepId,
          result,
        },
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    send({
      type: "tool_error",
      toolName,
      label,
      error: message,
    });

    if (context.conversationId) {
      await recordStep(context.supabase, context.conversationId, {
        id: `${stepId}-error`,
        type: "observation",
        content: {
          tool: toolName,
          stepId,
          error: message,
        },
      });
    }

    return { error: message };
  }
}

async function executeDeterministicTool(
  toolName: DeterministicToolName,
  rawArgs: Record<string, unknown>,
  context: ToolExecutionContext
) {
  switch (toolName) {
    case "web_search":
      return searchWebContext({
        query: String(rawArgs.query || ""),
        maxResults: 4,
        days: 30,
      });
    case "analyze_journey_data":
      return runAnalyzeJourneyData(
        rawArgs as { focus?: "viral_patterns" | "koc_summary" | "topic_generation" },
        context
      );
    case "analyze_wxvideo_data":
      return runAnalyzeWxvideoData(
        rawArgs as { focus?: "viral_patterns" | "content_migration" },
        context
      );
    case "analyze_publish_timing":
      return runAnalyzePublishTiming(
        rawArgs as { scope?: "auto" | "wechat_mp" | "wechat_channels" },
        context
      );
    case "import_koc_by_name":
      return runImportKocByName(rawArgs as { account_name: string }, context);
    default:
      throw new Error(`Unsupported deterministic tool: ${toolName satisfies never}`);
  }
}

export function resolveArticleTopic(
  userContent: string,
  confirmationContext: ConfirmationContext,
  journeyKeywords: string[]
) {
  if (confirmationContext.selectedTopic?.title) {
    return {
      title: confirmationContext.selectedTopic.title,
      angle: confirmationContext.selectedTopic.angle ?? "",
    };
  }

  const quoted = userContent.match(/[《“"']([^》《“”"']{4,80})[》”"']/);
  if (quoted?.[1]) {
    return {
      title: quoted[1].trim(),
      angle: "",
    };
  }

  const cleaned = userContent
    .replace(/^(帮我|给我|请|直接|现在)?(写|生成|出一篇|做一篇)?/, "")
    .replace(/(完整稿|文章|公众号稿|成稿|写出来|写一篇)$/g, "")
    .trim();

  if (cleaned.length >= 4 && cleaned.length <= 80) {
    return {
      title: cleaned,
      angle: "",
    };
  }

  return {
    title: `${journeyKeywords[0] || "AI工具"}实操指南`,
    angle: "",
  };
}

export function sanitizePayload(result: unknown) {
  if (!result || typeof result !== "object") {
    return { value: result as string | number | boolean | null };
  }

  const json = JSON.stringify(result);
  if (json.length <= 4000) {
    return result as Record<string, unknown>;
  }

  return {
    preview: json.slice(0, 4000),
    truncated: true,
  };
}

export function getToolLabel(toolName: string) {
  switch (toolName) {
    case "web_search":
      return "搜索网页资料";
    case "analyze_journey_data":
      return "分析对标样本";
    case "analyze_wxvideo_data":
      return "分析视频号样本";
    case "analyze_publish_timing":
      return "分析发布时间";
    case "import_koc_by_name":
      return "导入对标账号";
    default:
      return toolName;
  }
}

function shouldAutoWebSearch(userContent: string, journey: ToolContextJourney | null) {
  const text = userContent.trim();
  const normalized = text.toLowerCase();

  if (!text) return false;
  if (/https?:\/\//i.test(text)) return true;
  if (
    /(最近|最新|刚刚|今天|这周|本周|现在|发布|上线|新功能|更新|是什么|谁是|没见过|不了解|不认识|重新搜索|重新搜|再搜|搜一下|查一下|找一下|找找)/.test(
      text
    )
  ) {
    return true;
  }
  if (/[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(text)) {
    return true;
  }

  if (/(选题|题目|方向|写什么).*(现在|最近|最新|值得写|机会|热点)|现在.*(选题|题目|方向|写什么)/.test(text)) {
    return true;
  }

  const compactKeywords = (journey?.keywords ?? [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  if (
    compactKeywords.length &&
    compactKeywords.every((keyword) => !normalized.includes(keyword))
  ) {
    return true;
  }

  return false;
}

function shouldAutoWebSearchForIntent(
  intent: ChatIntent,
  userContent: string,
  journey: ToolContextJourney | null
) {
  if (
    intent === "topics" &&
    /(选题|题目|方向|写什么|涨粉选题)/.test(userContent) &&
    ((journey?.keywords ?? []).length > 0 || Boolean(journey?.primaryBenchmarkName))
  ) {
    return true;
  }

  if (shouldAutoWebSearch(userContent, journey)) {
    return true;
  }

  const articleMode = detectArticleMode(userContent, intent);

  if (articleMode === "high_leverage_article" && /(发布|更新|上线|新功能|模型|发布会|最新|最近)/.test(userContent)) {
    return true;
  }

  return false;
}

function inferDomainHints(
  journey: ToolContextJourney | null,
  benchmarkProfile: { domain: string[]; angles: string[] }
) {
  const seed = [
    ...(journey?.keywords ?? []),
    ...benchmarkProfile.domain,
  ]
    .join(" ")
    .toLowerCase();

  const hints: string[] = [];

  if (
    /(ai|gpt|claude|kimi|gemini|openai|模型|大模型|科技|技术|智能体|agent|数字生命卡兹克|量子位|机器之心|硅星人)/.test(
      seed
    )
  ) {
    hints.push("AI", "模型", "工具");
  }

  if (/(职场|求职|面试|简历|副业|效率|打工|运营)/.test(seed)) {
    hints.push("职场", "效率");
  }

  if (/(教育|学习|留学|考研|英语|编程教育)/.test(seed)) {
    hints.push("教育", "成长");
  }

  if (/(生活|穿搭|旅行|美食|家居|健身|运动|情绪)/.test(seed)) {
    hints.push("生活方式", "经验");
  }

  if (/(财经|投资|创业|商业|理财|独立开发)/.test(seed)) {
    hints.push("商业", "创业");
  }

  if (!hints.length && journey?.platform === "wechat_mp") {
    hints.push("公众号");
  }

  return Array.from(new Set(hints)).slice(0, 3);
}

function inferBenchmarkProfile(journey: ToolContextJourney | null) {
  const name = String(journey?.primaryBenchmarkName ?? "").trim();
  const seed = [name, ...(journey?.keywords ?? [])].join(" ").toLowerCase();

  const domain: string[] = [];
  const angles: string[] = [];

  if (
    /(数字生命卡兹克|量子位|机器之心|硅星人|openai|gpt|claude|kimi|gemini|模型|大模型|ai|科技|技术|agent|智能体)/.test(
      seed
    )
  ) {
    domain.push("AI", "模型", "工具");
    angles.push("工具实测", "模型更新", "行业判断");
  }

  if (/(职场|求职|面试|副业|效率|打工|运营)/.test(seed)) {
    domain.push("职场", "成长", "效率");
    angles.push("实操经验", "方法清单");
  }

  if (/(教育|学习|留学|考研|英语|编程教育)/.test(seed)) {
    domain.push("教育", "学习", "成长");
    angles.push("方法拆解", "实操教程");
  }

  if (/(生活|穿搭|旅行|美食|家居|健身|运动|情绪)/.test(seed)) {
    domain.push("生活方式", "体验", "趋势");
    angles.push("真实体验", "场景内容");
  }

  if (/(财经|投资|创业|商业|理财|独立开发)/.test(seed)) {
    domain.push("商业", "创业", "趋势");
    angles.push("行业判断", "机会分析");
  }

  if (!domain.length && journey?.platform === "wechat_mp") {
    domain.push("公众号");
    angles.push("选题", "内容");
  }

  return {
    domain: Array.from(new Set(domain)).slice(0, 3),
    angles: Array.from(new Set(angles)).slice(0, 3),
  };
}

function extractSearchIntentFromUserText(userContent: string, intent: ChatIntent) {
  const text = userContent.trim();
  const normalized = text.toLowerCase();
  const queryHints: string[] = [];
  let type: "topic_discovery" | "deep_test" | "industry_judgment" | "tutorial" | "news_lookup" | "general" =
    "general";

  if (/(新闻|资讯|动态|最新消息|最新新闻|更新日志|release|changelog|官方博客|官网)/i.test(text)) {
    type = "news_lookup";
    queryHints.push("官方", "发布", "更新", "新闻");
  }

  if (/(选题|题目|方向|写什么|值得写|最近写什么|现在写什么|热点)/.test(text) || intent === "topics") {
    type = "topic_discovery";
    queryHints.push("值得写", "话题", "热点");
  }

  if (/(实测|评测|横评|对比|测评|试试|深度测试)/.test(text)) {
    type = "deep_test";
    queryHints.push("实测", "评测", "对比");
  }

  if (/(创业|机会|行业|趋势|影响|会不会凉|天塌了|护城河|判断)/.test(text)) {
    type = "industry_judgment";
    queryHints.push("行业趋势", "机会", "影响");
  }

  if (/(教程|工作流|实操|怎么用|提效|指南|步骤)/.test(text)) {
    type = "tutorial";
    queryHints.push("实操", "教程", "工作流");
  }

  if (!queryHints.length && /(最新|最近|当前|现在|发布|上线|更新)/.test(text)) {
    queryHints.push("最新", "更新", "趋势");
  }

  if (!queryHints.length && normalized) {
    queryHints.push("趋势");
  }

  return {
    type,
    queryHints: Array.from(new Set(queryHints)).slice(0, 4),
  };
}

function compressSearchTerms(parts: string[]) {
  const stopWords = /^(帮我|给我|请|麻烦|搜索|搜|查|找|一下|现在|最近|最新|当前|有什么|有啥|哪些|哪个|值得写|好玩的|能写的|可写的|选题|题目|方向|写什么|3|三个|个|涨粉|话题|热点|趋势|内容)$/;

  const rawTerms = parts
    .flatMap((part) => String(part || "").split(/\s+/))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !stopWords.test(item));

  const compact: string[] = [];
  for (const term of rawTerms) {
    if (compact.some((existing) => existing === term || existing.includes(term) || term.includes(existing))) {
      continue;
    }
    compact.push(term);
  }

  return compact;
}

function sendStatus(
  send: (payload: Record<string, unknown>) => void,
  label: string,
  perf: PerfLogger
) {
  send({
    type: "assistant_status",
    label,
    elapsed: perf.elapsed(),
  });
}
