import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { completeWithTools, type LlmMessage } from "@/lib/llm";
import {
  appendJourneyProjectMemoryItems,
  compactAndSaveJourneyProjectMemory,
  compactAndSaveUserMemory,
} from "@/lib/memory";
import { buildConversationText, getSessionSteps, recordStep } from "@/lib/agent/memory";
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

export async function POST(req: NextRequest, { params }: RouteContext) {
  const startTime = Date.now();
  const { id: conversationId } = await params;
  const { content } = await req.json();

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!conversationId || conversationId === "undefined") {
    return new Response("Conversation id is required", { status: 400 });
  }

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("id, title, journey_id, journeys(id, platform, keywords)")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (convError) {
    console.error("[messages.route] failed to load conversation", {
      conversationId,
      error: convError.message,
      code: convError.code,
    });
    return new Response(`Conversation query failed: ${convError.message}`, { status: 500 });
  }

  if (!conv) {
    return new Response("Not found", { status: 404 });
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content,
  });

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(24);

  const sessionStepsBeforeTurn = await getSessionSteps(supabase, conversationId);

  const systemPrompt = await buildSystemPrompt(
    conv.journey_id,
    user.id,
    supabase,
    conversationId
  );

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

  const llmMessages: LlmMessage[] = (history ?? []).map((message) => ({
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

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({
        type: "assistant_status",
        label: "理解问题中",
        elapsed: Date.now() - startTime,
      });

      try {
        await applyDeterministicMemoryUpdates(
          supabase,
          conv.journey_id,
          conversationId,
          confirmationContext
        );

        const finalAnswer = await runAgentLoop({
          systemPrompt,
          llmMessages,
          toolContext,
          confirmationContext,
          send,
        });

        const memoryFacts = [
          ...confirmationContext.memoryFacts,
          ...extractMemoryFacts(finalAnswer),
        ];
        const displayAnswer = stripMemoryTags(finalAnswer).trim() || "我已经处理完这轮请求了。";

        const { data: assistantMessage } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: displayAnswer,
          })
          .select("id")
          .single();

        if (assistantMessage?.id) {
          send({ type: "assistant_message", messageId: assistantMessage.id });
        }

        send({ type: "assistant_status", label: "输出答案中" });
        await streamText(send, displayAnswer);

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
          `用户：${String(content).trim()}`,
          `助手：${displayAnswer}`,
          memoryFacts.length
            ? `已确认记忆：\n${memoryFacts.map((fact) => `- ${fact}`).join("\n")}`
            : "",
          sessionTranscript,
        ]
          .filter(Boolean)
          .join("\n\n");

        await Promise.allSettled([
          compactAndSaveUserMemory(supabase, user.id, memoryTranscript),
          compactAndSaveJourneyProjectMemory(supabase, conv.journey_id, memoryTranscript),
        ]);

        send({ type: "assistant_status", label: "已完成" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
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

async function runAgentLoop({
  systemPrompt,
  llmMessages,
  toolContext,
  confirmationContext,
  send,
}: {
  systemPrompt: string;
  llmMessages: LlmMessage[];
  toolContext: ToolExecutionContext;
  confirmationContext: ConfirmationContext;
  send: (payload: Record<string, unknown>) => void;
}) {
  hydrateMessagesWithConfirmation(llmMessages, confirmationContext);

  if (confirmationContext.selectedTopic) {
    await prefetchFullArticleFromConfirmedTopic(
      confirmationContext.selectedTopic,
      llmMessages,
      toolContext,
      send
    );
  }

  const maxRounds = 3;

  for (let round = 0; round < maxRounds; round += 1) {
    send({
      type: "assistant_status",
      label: round === 0 ? "整理上下文中" : "整合分析结果中",
    });

    const completion = await completeWithTools({
      systemPrompt,
      messages: llmMessages,
      tools: AGENT_TOOLS,
    });

    if (!completion.toolCalls.length) {
      return completion.content || "我已经处理完这轮请求了。";
    }

    llmMessages.push({
      role: "assistant",
      content: completion.content || "",
      tool_calls: completion.toolCalls,
    } as LlmMessage);

    for (const toolCall of completion.toolCalls) {
      const toolName = toolCall.function.name;
      const rawArgs = safeParseArgs(toolCall.function.arguments);
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

        if (
          toolName === "search_wechat_hot_articles" &&
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

        llmMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        } as LlmMessage);
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
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: message }),
        } as LlmMessage);
      }
    }
  }

  return "这轮任务已经完成了主要检索和分析，但我暂时没有整理出稳定的最终回答。";
}

async function executeTool(
  toolName: string,
  rawArgs: unknown,
  context: ToolExecutionContext
) {
  if (toolName === "compliance_check") {
    return runInlineComplianceCheck(rawArgs);
  }

  const registryEntry = AGENT_TOOL_REGISTRY[toolName as keyof typeof AGENT_TOOL_REGISTRY];
  if (!registryEntry?.execute) {
    throw new Error(`Unsupported tool: ${toolName}`);
  }

  return registryEntry.execute(rawArgs, context);
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
  const toolName = "generate_full_article";
  const label = getToolLabel(toolName);

  send({
    type: "tool_start",
    toolName,
    label,
  });

  const args = {
    topic_title: topic.title ?? "",
    angle: topic.angle ?? "",
  };
  const toolCallId = `prefill-${crypto.randomUUID()}`;

  try {
    const result = await executeTool(toolName, args, toolContext);
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
            arguments: JSON.stringify(args),
          },
        },
      ],
    } as LlmMessage);

    llmMessages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result),
    } as LlmMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    send({
      type: "tool_error",
      toolName,
      label,
      error: message,
    });
  }
}

function buildConfirmationContext(
  userContent: string,
  sessionSteps: Awaited<ReturnType<typeof getSessionSteps>>
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
  sessionSteps: Awaited<ReturnType<typeof getSessionSteps>>,
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
