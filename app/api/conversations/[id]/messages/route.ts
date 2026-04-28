import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { completeText, completeWithTools, type LlmMessage } from "@/lib/llm";
import {
  appendJourneyProjectMemoryItems,
  compactAndSaveJourneyProjectMemory,
  compactAndSaveUserMemory,
} from "@/lib/memory";
import { buildConversationText, getSessionSteps, recordStep, type StepRecord } from "@/lib/agent/memory";
import { AGENT_TOOL_REGISTRY, AGENT_TOOLS } from "@/lib/agent/tools/registry";
import type { ToolExecutionContext } from "@/lib/agent/tools/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type JourneyRow = {
  id: string;
  platform: string | null;
  keywords: string[] | null;
};

type ConversationRow = {
  id: string;
  title: string;
  journey_id: string;
  journeys: JourneyRow | JourneyRow[] | null;
};

type ToolEventPayload = Record<string, unknown> | undefined;

type GeneratedTopic = {
  index?: number;
  title?: string;
  angle?: string;
  why_fit_user?: string;
  why_now?: string;
  reference_titles?: string[];
};

type ConfirmationContext = {
  selectedTopic: GeneratedTopic | null;
  adoptedArticle: { title: string } | null;
  memoryFacts: string[];
};

type FastPathPlan = {
  steps: Array<{
    toolName: keyof typeof AGENT_TOOL_REGISTRY | "compliance_check";
    args: Record<string, unknown>;
  }>;
};

type ToolLoopOutcome = {
  hadToolCalls: boolean;
  directAnswer: string;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  const startTime = Date.now();
  const { id: conversationId } = await params;
  const { content } = await req.json();

  if (!conversationId || conversationId === "undefined") {
    return new Response("Conversation id is required", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const perf = createPerfLogger(startTime);

      send({
        type: "assistant_status",
        label: "理解问题中",
        elapsed: perf.elapsed(),
      });

      try {
        const cookieStore = await cookies();
        const supabase = createClient(cookieStore);

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        perf.mark("auth_ready");

        if (authError || !user) {
          throw new Error(authError?.message || "Unauthorized");
        }

        const { data: conv, error: convError } = await supabase
          .from("conversations")
          .select("id, title, journey_id, journeys(id, platform, keywords)")
          .eq("id", conversationId)
          .eq("user_id", user.id)
          .single();
        perf.mark("conversation_loaded");

        if (convError) {
          throw new Error(`Conversation query failed: ${convError.message}`);
        }

        if (!conv) {
          throw new Error("Conversation not found");
        }

        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "user",
          content,
        });
        perf.mark("user_message_saved");

        send({
          type: "assistant_status",
          label: "整理上下文中",
          elapsed: perf.elapsed(),
        });

        const [historyRes, sessionStepsBeforeTurn] = await Promise.all([
          supabase
            .from("messages")
            .select("role, content")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(24),
          getSessionSteps(supabase, conversationId),
        ]);
        perf.mark("context_loaded");

        const conversation = conv as ConversationRow;
        const conversationJourney = conversation.journeys;
        const journeyRow = Array.isArray(conversationJourney)
          ? (conversationJourney[0] ?? null)
          : (conversationJourney ?? null);
        const journey = journeyRow
          ? {
              keywords: journeyRow.keywords ?? undefined,
              platform: journeyRow.platform ?? undefined,
            }
          : null;

        const llmMessages: LlmMessage[] = (historyRes.data ?? []).map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));

        const confirmationContext = buildConfirmationContext(
          content,
          sessionStepsBeforeTurn
        );

        const toolContext: ToolExecutionContext = {
          journeyId: conv.journey_id,
          userId: user.id,
          supabase,
          journey,
          conversationId,
        };

        await applyDeterministicMemoryUpdates(
          supabase,
          conv.journey_id,
          conversationId,
          confirmationContext
        );
        perf.mark("deterministic_memory_updates");

        hydrateMessagesWithConfirmation(llmMessages, confirmationContext);

        if (confirmationContext.selectedTopic) {
          await prefetchFullArticleFromConfirmedTopic(
            confirmationContext.selectedTopic,
            llmMessages,
            toolContext,
            send
          );
          perf.mark("confirmed_topic_prefetch");
        }

        const fastPath = detectFastPathPlan(content);
        if (fastPath) {
          send({
            type: "assistant_status",
            label: "执行快捷流程中",
            elapsed: perf.elapsed(),
          });
          await runFastPathPlan(fastPath, llmMessages, toolContext, send, perf);
        } else {
          const planningPrompt = buildPlanningPrompt({
            journey,
            sessionSteps: sessionStepsBeforeTurn,
          });
          const toolLoopOutcome = await runAgentToolLoop({
            planningPrompt,
            llmMessages,
            toolContext,
            send,
            perf,
          });

          if (toolLoopOutcome.directAnswer.trim()) {
            llmMessages.push({
              role: "assistant",
              content: toolLoopOutcome.directAnswer,
            } as LlmMessage);
          }
        }

        send({
          type: "assistant_status",
          label: "组织回答中",
          elapsed: perf.elapsed(),
        });

        const systemPrompt = await buildSystemPrompt(
          conv.journey_id,
          user.id,
          supabase,
          conversationId
        );
        perf.mark("system_prompt_ready");

        let finalAnswer = await completeText({
          systemPrompt,
          messages: llmMessages,
        });
        perf.mark("final_answer_ready");

        if (!finalAnswer.trim()) {
          finalAnswer = buildDeterministicFallbackAnswer(llmMessages, content);
          perf.mark("final_answer_fallback");
        }

        const memoryFacts = [
          ...confirmationContext.memoryFacts,
          ...extractMemoryFacts(finalAnswer),
        ];
        const displayAnswer =
          stripMemoryTags(finalAnswer).trim() ||
          "这轮我拿到了部分数据，但还没成功组织成有效回答。";

        const { data: assistantMessage, error: assistantMessageError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: displayAnswer,
          })
          .select("id")
          .single();

        if (assistantMessageError) {
          throw new Error(`Save assistant message failed: ${assistantMessageError.message}`);
        }

        perf.mark("assistant_message_saved");

        if (assistantMessage?.id) {
          send({ type: "assistant_message", messageId: assistantMessage.id });
        }

        send({
          type: "assistant_status",
          label: "输出答案中",
          elapsed: perf.elapsed(),
        });

        await streamText(send, displayAnswer);
        perf.mark("answer_streamed");

        send({
          type: "assistant_status",
          label: "已完成",
          elapsed: perf.elapsed(),
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));

        void finalizeTurnMemory({
          supabase,
          conversationId,
          userId: user.id,
          journeyId: conv.journey_id,
          userContent: String(content).trim(),
          displayAnswer,
          memoryFacts,
        });
      } catch (error) {
        console.error("[messages.route] request failed", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function runAgentToolLoop({
  planningPrompt,
  llmMessages,
  toolContext,
  send,
  perf,
}: {
  planningPrompt: string;
  llmMessages: LlmMessage[];
  toolContext: ToolExecutionContext;
  send: (payload: Record<string, unknown>) => void;
  perf: ReturnType<typeof createPerfLogger>;
}): Promise<ToolLoopOutcome> {
  const maxRounds = 3;
  let hadToolCalls = false;

  for (let round = 0; round < maxRounds; round += 1) {
    send({
      type: "assistant_status",
      label: round === 0 ? "整理上下文中" : "整合分析结果中",
      elapsed: perf.elapsed(),
    });

    const completion = await completeWithTools({
      systemPrompt: planningPrompt,
      messages: llmMessages,
      tools: AGENT_TOOLS,
    });
    perf.mark(`tool_planning_round_${round + 1}`);

    if (!completion.toolCalls.length) {
      return {
        hadToolCalls,
        directAnswer: completion.content?.trim() || "",
      };
    }

    hadToolCalls = true;

    llmMessages.push({
      role: "assistant",
      content: completion.content || "",
      tool_calls: completion.toolCalls,
    } as LlmMessage);

    for (const toolCall of completion.toolCalls) {
      const toolName = normalizeToolName(toolCall.function.name);
      if (!toolName) {
        continue;
      }
      const rawArgs = safeParseArgs(toolCall.function.arguments);
      const result = await executeToolAndAppend({
        toolName,
        rawArgs,
        toolCallId: toolCall.id,
        llmMessages,
        toolContext,
        send,
      });
      perf.mark(`tool_${toolName}`);

      if (toolName === "search_wechat_hot_articles") {
        maybeEmitKocRecommendation(send, result);
      }
    }
  }

  return {
    hadToolCalls,
    directAnswer: "",
  };
}

async function runFastPathPlan(
  plan: FastPathPlan,
  llmMessages: LlmMessage[],
  toolContext: ToolExecutionContext,
  send: (payload: Record<string, unknown>) => void,
  perf: ReturnType<typeof createPerfLogger>
) {
  for (const step of plan.steps) {
    const result = await executeToolAndAppend({
      toolName: step.toolName,
      rawArgs: step.args,
      toolCallId: `fast-${crypto.randomUUID()}`,
      llmMessages,
      toolContext,
      send,
    });
    perf.mark(`fast_tool_${step.toolName}`);

    if (step.toolName === "search_wechat_hot_articles") {
      maybeEmitKocRecommendation(send, result);
    }
  }
}

async function executeToolAndAppend({
  toolName,
  rawArgs,
  toolCallId,
  llmMessages,
  toolContext,
  send,
}: {
  toolName: keyof typeof AGENT_TOOL_REGISTRY | "compliance_check";
  rawArgs: unknown;
  toolCallId: string;
  llmMessages: LlmMessage[];
  toolContext: ToolExecutionContext;
  send: (payload: Record<string, unknown>) => void;
}) {
  const label = getToolLabel(toolName);
  send({
    type: "tool_start",
    toolName,
    label,
  });

  try {
    const result = await executeTool(toolName, rawArgs, toolContext);

    send({
      type: "tool_result",
      toolName,
      label,
      payload: sanitizePayload(result),
    });

    llmMessages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify(rawArgs),
          },
        },
      ],
    } as LlmMessage);

    llmMessages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result),
    } as LlmMessage);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    send({
      type: "tool_error",
      toolName,
      label,
      error: message,
    });

    llmMessages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify({ error: message }),
    } as LlmMessage);

    return { error: message };
  }
}

async function executeTool(
  toolName: keyof typeof AGENT_TOOL_REGISTRY | "compliance_check",
  rawArgs: unknown,
  context: ToolExecutionContext
) {
  if (toolName === "compliance_check") {
    return runInlineComplianceCheck(rawArgs);
  }

  const registryEntry = AGENT_TOOL_REGISTRY[toolName];
  if (!registryEntry?.execute) {
    throw new Error(`Unsupported tool: ${toolName}`);
  }

  return registryEntry.execute(rawArgs, context);
}

async function finalizeTurnMemory({
  supabase,
  conversationId,
  userId,
  journeyId,
  userContent,
  displayAnswer,
  memoryFacts,
}: {
  supabase: ToolExecutionContext["supabase"];
  conversationId: string;
  userId: string;
  journeyId: string;
  userContent: string;
  displayAnswer: string;
  memoryFacts: string[];
}) {
  try {
    await recordStep(supabase, conversationId, {
      id: crypto.randomUUID(),
      type: "reflection",
      content: {
        answerPreview: displayAnswer.slice(0, 240),
        memoryFacts,
      },
    });

    const sessionSteps = await getSessionSteps(supabase, conversationId);
    const sessionTranscript = buildConversationText(sessionSteps);
    const memoryTranscript = [
      `用户：${userContent}`,
      `助手：${displayAnswer}`,
      memoryFacts.length
        ? `已确认记忆：\n${memoryFacts.map((fact) => `- ${fact}`).join("\n")}`
        : "",
      sessionTranscript,
    ]
      .filter(Boolean)
      .join("\n\n");

    await Promise.allSettled([
      compactAndSaveUserMemory(supabase, userId, memoryTranscript),
      compactAndSaveJourneyProjectMemory(supabase, journeyId, memoryTranscript),
    ]);
  } catch (error) {
    console.warn("[messages.route] finalize memory failed", error);
  }
}

async function applyDeterministicMemoryUpdates(
  supabase: ToolExecutionContext["supabase"],
  journeyId: string,
  conversationId: string,
  confirmationContext: ConfirmationContext
) {
  if (confirmationContext.selectedTopic?.title) {
    const topicLine = confirmationContext.selectedTopic.angle
      ? `${confirmationContext.selectedTopic.title}｜角度：${confirmationContext.selectedTopic.angle}`
      : confirmationContext.selectedTopic.title;

    await appendJourneyProjectMemoryItems(
      supabase,
      journeyId,
      "## 已验证选题模式",
      [topicLine]
    );

    await recordStep(supabase, conversationId, {
      id: crypto.randomUUID(),
      type: "observation",
      content: {
        tool: "memory",
        confirmation: "topic_selected",
        topic: confirmationContext.selectedTopic.title,
      },
    });
  }

  if (confirmationContext.adoptedArticle?.title) {
    await appendJourneyProjectMemoryItems(
      supabase,
      journeyId,
      "## 当前策略卡片",
      [`已采纳初稿：《${confirmationContext.adoptedArticle.title}》`]
    );

    await recordStep(supabase, conversationId, {
      id: crypto.randomUUID(),
      type: "observation",
      content: {
        tool: "memory",
        confirmation: "article_adopted",
        title: confirmationContext.adoptedArticle.title,
      },
    });
  }
}

function hydrateMessagesWithConfirmation(
  llmMessages: LlmMessage[],
  confirmationContext: ConfirmationContext
) {
  if (!llmMessages.length) {
    return;
  }

  const lastMessage = llmMessages[llmMessages.length - 1];
  if (lastMessage.role !== "user" || typeof lastMessage.content !== "string") {
    return;
  }

  const notes: string[] = [];
  if (confirmationContext.selectedTopic?.title) {
    notes.push(
      `系统识别：用户刚刚确认了选题《${confirmationContext.selectedTopic.title}》${confirmationContext.selectedTopic.angle ? `，切入角度是：${confirmationContext.selectedTopic.angle}` : ""}。请优先继续推进写稿，而不是重新给一轮选题。`
    );
  }

  if (confirmationContext.adoptedArticle?.title) {
    notes.push(
      `系统识别：用户刚刚确认采用上一版初稿《${confirmationContext.adoptedArticle.title}》。请简短确认，并提炼这次采用透露出的偏好。`
    );
  }

  if (!notes.length) {
    return;
  }

  llmMessages[llmMessages.length - 1] = {
    ...lastMessage,
    content: `${lastMessage.content}\n\n[${notes.join(" ")}]`,
  };
}

async function prefetchFullArticleFromConfirmedTopic(
  topic: GeneratedTopic,
  llmMessages: LlmMessage[],
  toolContext: ToolExecutionContext,
  send: (payload: Record<string, unknown>) => void
) {
  await executeToolAndAppend({
    toolName: "generate_full_article",
    rawArgs: {
      topic_title: topic.title ?? "",
      angle: topic.angle ?? "",
    },
    toolCallId: `prefill-${crypto.randomUUID()}`,
    llmMessages,
    toolContext,
    send,
  });
}

function detectFastPathPlan(userContent: string): FastPathPlan | null {
  if (isWhyHighReadQuestion(userContent)) {
    return {
      steps: [
        {
          toolName: "analyze_journey_data",
          args: { focus: "viral_patterns" },
        },
      ],
    };
  }

  const accountName = extractExplicitAccountName(userContent);
  if (!accountName) {
    return null;
  }

  return {
    steps: [
      {
        toolName: "import_koc_by_name",
        args: { account_name: accountName },
      },
      {
        toolName: "analyze_journey_data",
        args: { focus: "viral_patterns" },
      },
    ],
  };
}

function extractExplicitAccountName(userContent: string) {
  if (!/(对标|导入|添加)/.test(userContent)) {
    return null;
  }

  const match = userContent.match(/(?:对标|导入(?:一下)?|添加)([^，。！？\n]+)/);
  const candidate = match?.[1]?.trim() || userContent.trim();
  const cleaned = candidate
    .replace(/^(一下|一个|这个|这个号|这个公众号|账号)/, "")
    .replace(/(作为对标|做对标|这个号|这个公众号|公众号|账号)$/i, "")
    .trim();

  return cleaned.length >= 2 ? cleaned : null;
}

function isWhyHighReadQuestion(userContent: string) {
  const normalized = userContent.replace(/\s+/g, "");
  return /(为什么).*(阅读量|起量|爆|高)|((阅读量|起量|爆).*(为什么|原因))|(爆款规律|高阅读.*原因)/.test(
    normalized
  );
}

function normalizeToolName(
  toolName: string
): keyof typeof AGENT_TOOL_REGISTRY | "compliance_check" | null {
  if (toolName === "compliance_check") {
    return toolName;
  }

  if (toolName in AGENT_TOOL_REGISTRY) {
    return toolName as keyof typeof AGENT_TOOL_REGISTRY;
  }

  return null;
}

function buildPlanningPrompt(params: {
  journey: ToolExecutionContext["journey"];
  sessionSteps: StepRecord[];
}) {
  const recentCalls = params.sessionSteps
    .filter((step) => step.type === "tool_call")
    .slice(-4)
    .map((step) => {
      const content = step.content as { tool?: string; args?: unknown };
      return `- ${content.tool || "unknown"}: ${JSON.stringify(content.args || {})}`;
    })
    .join("\n");

  return `你是 Niche 的工具规划器，只负责决定要不要调用工具以及调用哪个工具。

原则：
1. 优先少轮次完成任务，避免无意义的重复调用。
2. 如果用户明确说“对标/导入某个公众号”，优先导入再分析。
2.1 如果用户在问“为什么阅读量高 / 为什么会爆 / 爆款规律”，优先调用 analyze_journey_data，而不是先做 search_knowledge_base。
3. 如果问题明显只需要最终总结，不要再调工具。
4. 已经成功执行过的工具，除非必要，不要再次调用。
5. 工具参数尽量简洁，避免传空字段。

当前旅程：
- 平台：${params.journey?.platform || "未知"}
- 关键词：${(params.journey?.keywords ?? []).join("、") || "暂无"}

最近执行记录：
${recentCalls || "（暂无）"}

你可以调用工具，也可以直接回答。`;
}

function maybeEmitKocRecommendation(
  send: (payload: Record<string, unknown>) => void,
  result: unknown
) {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { articles?: unknown[] }).articles)
  ) {
    send({
      type: "koc_recommendation_ready",
      payload: {
        keyword:
          typeof (result as { keyword?: unknown }).keyword === "string"
            ? (result as { keyword: string }).keyword
            : "",
        articles: (result as { articles: unknown[] }).articles,
      },
    });
  }
}

function buildDeterministicFallbackAnswer(
  llmMessages: LlmMessage[],
  userContent: string
) {
  const latestAnalyze = findLatestToolPayloadFromMessages<{
    patterns?: string[];
    top_articles?: Array<{ title?: string; read_count?: number }>;
    top_kocs?: Array<{ account_name?: string; max_read_count?: number; avg_read_count?: number }>;
  }>(llmMessages, "analyze_journey_data");

  if (latestAnalyze) {
    const topKoc = latestAnalyze.top_kocs?.[0];
    const topArticles = Array.isArray(latestAnalyze.top_articles)
      ? latestAnalyze.top_articles.slice(0, 3)
      : [];
    const patterns = Array.isArray(latestAnalyze.patterns)
      ? latestAnalyze.patterns.slice(0, 3)
      : [];

    const lines = [
      "从这批已导入文章看，阅读量高主要不是偶然，而是因为它同时占了 **标题、选题、实用价值** 这三个点。",
      topKoc?.account_name
        ? `账号基本盘上，**${topKoc.account_name}** 本身已经有较强的读者信任，最高阅读 ${fmtNum(topKoc.max_read_count ?? 0)}，平均阅读 ${fmtNum(topKoc.avg_read_count ?? 0)}。`
        : "",
      patterns.length
        ? `最明显的规律是：\n${patterns.map((pattern, index) => `${index + 1}. **${pattern}**`).join("\n")}`
        : "",
      topArticles.length
        ? `结合高阅读文章看，它们共同更像是：\n${topArticles
            .map(
              (article) =>
                `- **${article.title || "未命名文章"}**：阅读 ${fmtNum(article.read_count ?? 0)}`
            )
            .join("\n")}`
        : "",
      /为什么/.test(userContent)
        ? "一句话总结：**它不是靠泛泛聊 AI 起量，而是靠“具体案例 + 明确收益感 + 可直接带走的方法”起量。**"
        : "",
    ].filter(Boolean);

    return lines.join("\n\n");
  }

  const latestKnowledge = findLatestToolPayloadFromMessages<{
    articles?: Array<{ title?: string; read_count?: number; account_name?: string }>;
  }>(llmMessages, "search_knowledge_base");

  if (latestKnowledge?.articles?.length) {
    const articles = latestKnowledge.articles.slice(0, 3);
    return [
      "这轮我已经从知识库里拿到了几篇高阅读文章，但还没完成更深入的归因分析。",
      `目前能先确认的是，表现最好的内容集中在这些方向：\n${articles
        .map(
          (article) =>
            `- **${article.title || "未命名文章"}**｜${article.account_name || "未知账号"}｜阅读 ${fmtNum(article.read_count ?? 0)}`
        )
        .join("\n")}`,
      "如果只基于这批标题先做初步判断，最明显的共同点是：**标题具体、问题明确、读者能立刻感知收益。**",
    ].join("\n\n");
  }

  return "这轮我拿到了部分数据，但还没成功组织成有效回答。";
}

function findLatestToolPayloadFromMessages<T>(
  llmMessages: LlmMessage[],
  toolName: string
) {
  for (let index = llmMessages.length - 1; index >= 0; index -= 1) {
    const message = llmMessages[index];
    if (message.role !== "assistant" || !("tool_calls" in message) || !message.tool_calls?.length) {
      continue;
    }

    const matchedCall = message.tool_calls.find((toolCall) => {
      const fn = "function" in toolCall ? toolCall.function : undefined;
      return fn?.name === toolName;
    });

    if (!matchedCall) {
      continue;
    }

    const toolCallId = matchedCall.id;
    const toolMessage = llmMessages.find(
      (candidate) =>
        candidate.role === "tool" &&
        "tool_call_id" in candidate &&
        candidate.tool_call_id === toolCallId &&
        typeof candidate.content === "string"
    );

    if (!toolMessage || typeof toolMessage.content !== "string") {
      continue;
    }

    try {
      return JSON.parse(toolMessage.content) as T;
    } catch {
      return null;
    }
  }

  return null;
}

function buildConfirmationContext(
  userContent: string,
  sessionSteps: StepRecord[]
): ConfirmationContext {
  const selectedTopic = detectTopicSelection(
    userContent,
    findLatestToolResult<{ topics?: GeneratedTopic[] }>(sessionSteps, "generate_topics")
  );
  const latestArticle = findLatestToolResult<{ title?: string }>(
    sessionSteps,
    "generate_full_article"
  );
  const adoptedArticle = detectArticleAcceptance(userContent, latestArticle);

  const memoryFacts = [
    selectedTopic?.title ? `确认选题：${selectedTopic.title}` : "",
    adoptedArticle?.title ? `采用初稿：${adoptedArticle.title}` : "",
  ].filter(Boolean);

  return {
    selectedTopic,
    adoptedArticle,
    memoryFacts,
  };
}

function findLatestToolResult<T>(
  sessionSteps: StepRecord[],
  toolName: string
) {
  for (let index = sessionSteps.length - 1; index >= 0; index -= 1) {
    const step = sessionSteps[index];
    if (step.type !== "observation") {
      continue;
    }

    const content = step.content as {
      tool?: string;
      result?: T;
      error?: string;
    };

    if (content.tool === toolName && content.result && !content.error) {
      return content.result;
    }
  }

  return null;
}

function detectTopicSelection(
  userContent: string,
  latestTopics: { topics?: GeneratedTopic[] } | null
) {
  const topics = Array.isArray(latestTopics?.topics) ? latestTopics.topics : [];
  if (!topics.length) {
    return null;
  }

  const normalized = userContent.replace(/\s+/g, "");
  const index = resolveSelectionIndex(normalized);
  if (index === null) {
    return null;
  }

  return topics[index] ?? null;
}

function detectArticleAcceptance(
  userContent: string,
  latestArticle: { title?: string } | null
) {
  if (!latestArticle?.title) {
    return null;
  }

  const normalized = userContent.trim().toLowerCase();
  if (
    /^(这个可以|这个版本可以|这个版本行|就按这个写|就按这个来|ok|okay|可以|行|好)$/.test(normalized)
  ) {
    return { title: latestArticle.title };
  }

  return null;
}

function resolveSelectionIndex(normalizedText: string) {
  const patterns: Array<[RegExp, number]> = [
    [/(我选|选|就要|就用|用|第)(第?1个|第?一个|第一)/, 0],
    [/(我选|选|就要|就用|用|第)(第?2个|第?二个|第二)/, 1],
    [/(我选|选|就要|就用|用|第)(第?3个|第?三个|第三)/, 2],
    [/^(1|一)$|^第?1个$|^第?一个$/, 0],
    [/^(2|二)$|^第?2个$|^第?二个$/, 1],
    [/^(3|三)$|^第?3个$|^第?三个$/, 2],
  ];

  for (const [pattern, index] of patterns) {
    if (pattern.test(normalizedText)) {
      return index;
    }
  }

  return null;
}

function runInlineComplianceCheck(rawArgs: unknown) {
  const args = typeof rawArgs === "object" && rawArgs !== null
    ? (rawArgs as Record<string, unknown>)
    : {};

  const title = String(args.title ?? "");
  const summary = String(args.summary ?? "");
  const articleMarkdown = String(args.article_markdown ?? "");
  const joined = `${title}\n${summary}\n${articleMarkdown}`;

  const hitRules = [
    { pattern: /包过|稳赚|暴富|躺赚|保证/, reason: "存在明显夸大承诺" },
    { pattern: /最权威|唯一真相|100%/, reason: "存在绝对化表达" },
    { pattern: /内幕|灰产|代刷|刷量/, reason: "存在高风险违规表达" },
    { pattern: /医疗|治愈|药到病除/, reason: "涉及医疗高风险表述" },
  ].filter((rule) => rule.pattern.test(joined));

  return {
    risk_level: hitRules.length >= 2 ? "high" : hitRules.length === 1 ? "medium" : "low",
    issues: hitRules.map((rule) => rule.reason),
    suggestion:
      hitRules.length > 0
        ? "建议删掉绝对化承诺和高风险词，改成更克制、经验型的表达。"
        : "当前内容整体风险较低，发布前再检查标题是否过度刺激即可。",
  };
}

function safeParseArgs(raw: string) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function sanitizePayload(result: unknown): ToolEventPayload {
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

function getToolLabel(toolName: string) {
  switch (toolName) {
    case "search_hot_topics":
      return "搜索赛道热点";
    case "search_wechat_hot_articles":
      return "搜索公众号爆文";
    case "import_koc_by_name":
      return "导入对标账号";
    case "analyze_journey_data":
      return "分析旅程数据";
    case "search_knowledge_base":
      return "检索知识库";
    case "generate_topics":
      return "生成选题";
    case "generate_full_article":
      return "生成完整稿";
    case "compliance_check":
      return "合规检查";
    default:
      return toolName;
  }
}

async function streamText(
  send: (payload: Record<string, unknown>) => void,
  text: string
) {
  const chunks = chunkText(text, 48);
  for (const chunk of chunks) {
    send({ type: "text", text: chunk });
    await wait(12);
  }
}

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMemoryFacts(text: string) {
  return Array.from(text.matchAll(/<memory>([\s\S]*?)<\/memory>/g))
    .map((match) => match[1]?.trim())
    .filter((fact): fact is string => Boolean(fact));
}

function stripMemoryTags(text: string) {
  return text.replace(/\s*<memory>[\s\S]*?<\/memory>\s*/g, "\n").trim();
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}

function createPerfLogger(startTime: number) {
  return {
    elapsed() {
      return Date.now() - startTime;
    },
    mark(stage: string) {
      console.info("[messages.route][perf]", {
        stage,
        elapsed: Date.now() - startTime,
      });
    },
  };
}
