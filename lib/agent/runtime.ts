import { getPrimaryChatModel, type ThinkingMode } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";
import type { LlmMessage, LlmTool, LlmToolCall } from "@/lib/llm";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

function normalizeChunkContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }

  return "";
}

function normalizeReasoningChunk(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        if ("type" in item && (item as { type?: unknown }).type === "reasoning") {
          if ("reasoning" in item) {
            return String((item as { reasoning?: unknown }).reasoning ?? "");
          }
          if ("text" in item) {
            return String((item as { text?: unknown }).text ?? "");
          }
        }
        return "";
      })
      .join("");
  }

  return "";
}

function buildLangChainMessages(systemPrompt: string, messages: LlmMessage[]) {
  const adapted: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [];

  for (const message of messages) {
    const content = normalizeMessageContent(message.content);

    switch (message.role) {
      case "system":
      case "developer":
        adapted.push(new SystemMessage(content));
        break;
      case "user":
        adapted.push(new HumanMessage(content));
        break;
      case "assistant":
        adapted.push(
          new AIMessage({
            content,
            tool_calls:
              "tool_calls" in message && Array.isArray(message.tool_calls)
                ? message.tool_calls
                    .map((toolCall) => mapFunctionToolCall(toolCall))
                    .filter((toolCall): toolCall is NonNullable<typeof toolCall> => Boolean(toolCall))
                : [],
          })
        );
        break;
      case "tool":
      case "function":
        adapted.push(
          new ToolMessage({
            content,
            tool_call_id:
              "tool_call_id" in message && typeof message.tool_call_id === "string"
                ? message.tool_call_id
                : message.role,
          })
        );
        break;
      default:
        break;
    }
  }

  return [
    new SystemMessage(systemPrompt),
    ...adapted,
  ];
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }

  return String(content ?? "");
}

function isFunctionToolCall(
  toolCall: unknown
): toolCall is { id: string; function: { name: string; arguments: string } } {
  return Boolean(
    toolCall &&
      typeof toolCall === "object" &&
      "id" in toolCall &&
      "function" in toolCall &&
      typeof (toolCall as { function?: unknown }).function === "object"
  );
}

function mapFunctionToolCall(toolCall: unknown) {
  if (!isFunctionToolCall(toolCall)) {
    return null;
  }

  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args: safeParseToolArgs(toolCall.function.arguments),
    type: "tool_call" as const,
  };
}

function safeParseToolArgs(argumentsText: string) {
  try {
    return JSON.parse(argumentsText);
  } catch {
    return {};
  }
}

export async function invokeText(params: {
  systemPrompt: string;
  userContent: string;
  thinkingMode?: ThinkingMode;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  const model = getPrimaryChatModel(params.thinkingMode);
  const response = await model.invoke(
    [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    buildAgentRunConfig({
      runName: params.runName ?? "llm-chat",
      tags: params.tags ?? ["chat"],
      metadata: params.metadata ?? {},
    })
  );

  return normalizeChunkContent(response.content);
}

export async function streamText(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  onChunk: (text: string) => void;
  onReasoningChunk?: (text: string) => void;
  thinkingMode?: ThinkingMode;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  const model = getPrimaryChatModel(params.thinkingMode);
  const stream = await model.stream(
    buildLangChainMessages(params.systemPrompt, params.messages),
    buildAgentRunConfig({
      runName: params.runName ?? "llm-stream-chat",
      tags: params.tags ?? ["stream-chat"],
      metadata: params.metadata ?? {},
    })
  );

  for await (const chunk of stream) {
    const reasoning = normalizeReasoningChunk((chunk as { contentBlocks?: unknown }).contentBlocks);
    if (reasoning) {
      params.onReasoningChunk?.(reasoning);
    }
    const text = normalizeChunkContent(chunk.content);
    if (text) {
      params.onChunk(text);
    }
  }
}

export async function invokeWithTools(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  thinkingMode?: ThinkingMode;
  runName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  const model = getPrimaryChatModel(params.thinkingMode).bindTools(params.tools as never, {
    tool_choice: "auto",
  });

  const response = await model.invoke(
    buildLangChainMessages(params.systemPrompt, params.messages),
    buildAgentRunConfig({
      runName: params.runName ?? "llm-complete-with-tools",
      tags: params.tags ?? ["tool-call"],
      metadata: params.metadata ?? {},
    })
  );

  return {
    content: normalizeChunkContent(response.content),
    toolCalls: extractToolCalls(response),
  };
}

function extractToolCalls(response: unknown): LlmToolCall[] {
  const source = response as {
    tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
    additional_kwargs?: {
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  };

  if (Array.isArray(source.tool_calls) && source.tool_calls.length > 0) {
    return source.tool_calls
      .filter((toolCall) => toolCall.name)
      .map((toolCall) => ({
        id: toolCall.id || createToolCallId(),
        type: "function",
        function: {
          name: String(toolCall.name),
          arguments: JSON.stringify(toolCall.args ?? {}),
        },
      }));
  }

  if (Array.isArray(source.additional_kwargs?.tool_calls)) {
    return source.additional_kwargs.tool_calls
      .filter((toolCall) => toolCall.function?.name)
      .map((toolCall) => ({
        id: toolCall.id || createToolCallId(),
        type: "function",
        function: {
          name: String(toolCall.function?.name),
          arguments: String(toolCall.function?.arguments ?? "{}"),
        },
      }));
  }

  return [];
}

function createToolCallId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
