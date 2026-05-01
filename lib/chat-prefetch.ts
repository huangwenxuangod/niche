import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import { retrieveSemanticCompetitorContent } from "@/lib/agent/retrievers/semantic-knowledge";
import { searchWebContext } from "@/lib/web-search";
import { recordStep } from "@/lib/agent/memory/session-memory";
import type { ToolExecutionContext } from "@/lib/agent/tools/types";
import { runAnalyzeJourneyData } from "@/lib/agent/tools/analyze-journey-data";
import { runAnalyzeWxvideoData } from "@/lib/agent/tools/analyze-wxvideo-data";
import { runAnalyzePublishTiming } from "@/lib/agent/tools/analyze-publish-timing";
import { runImportKocByName } from "@/lib/agent/tools/import-koc-by-name";
import type { ChatIntent, ConfirmationContext } from "./chat-intent-router";
import { extractExplicitAccountName } from "./chat-intent-router";
import type { DeterministicToolName, PerfLogger, PrefetchedContext } from "./chat-runtime";
import { trimText } from "./chat-runtime";

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
      const [journeyAnalysis, webContext] = await Promise.all([
        runObservedTool(
          "analyze_journey_data",
          { focus: "topic_generation" },
          context,
          send
        ),
        shouldAutoWebSearch(userContent, context.journey?.keywords ?? [])
          ? runObservedTool("web_search", { query: userContent }, context, send)
          : Promise.resolve(null),
      ]);
      return { intent, data: { journeyAnalysis, webContext } };
    }
    case "full_article": {
      sendStatus(send, "准备写作素材中", perf);
      const topic = resolveArticleTopic(userContent, confirmationContext, context.journey?.keywords ?? []);
      const [journeyAnalysis, knowledge, semanticReferences, webContext] = await Promise.all([
        runObservedTool("analyze_journey_data", { focus: "viral_patterns" }, context, send),
        searchJourneyKnowledge(context.supabase, context.journeyId, topic.title, 5),
        retrieveSemanticCompetitorContent(context.supabase, {
          journeyId: context.journeyId,
          query: [topic.title, topic.angle].filter(Boolean).join("\n"),
          limit: 6,
        }).catch(() => []),
        shouldAutoWebSearch(userContent, context.journey?.keywords ?? [])
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
      const [journeyAnalysis, wxvideoAnalysis, publishTiming] = await Promise.all([
        runObservedTool("analyze_journey_data", { focus: "viral_patterns" }, context, send),
        runObservedTool("analyze_wxvideo_data", { focus: "viral_patterns" }, context, send),
        runObservedTool("analyze_publish_timing", { scope: "auto" }, context, send),
      ]);
      return { intent, data: { journeyAnalysis, wxvideoAnalysis, publishTiming } };
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
      if (shouldAutoWebSearch(userContent, context.journey?.keywords ?? [])) {
        const webContext = await runObservedTool(
          "web_search",
          { query: userContent },
          context,
          send
        );
        return { intent: "general", data: { webContext } };
      }
      return { intent: "general", data: {} };
  }
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

function shouldAutoWebSearch(userContent: string, journeyKeywords: string[]) {
  const text = userContent.trim();
  const normalized = text.toLowerCase();

  if (!text) return false;
  if (/https?:\/\//i.test(text)) return true;
  if (/(最近|最新|刚刚|今天|这周|本周|发布|上线|新功能|更新|是什么|谁是|没见过|不了解|不认识)/.test(text)) {
    return true;
  }
  if (/[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(text)) {
    return true;
  }

  const compactKeywords = (journeyKeywords ?? [])
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
