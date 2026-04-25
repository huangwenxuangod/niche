import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ThinkingMode } from "@/lib/agent/models";
import { invokeText, invokeWithTools, streamText } from "@/lib/agent/runtime";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
});

// Model endpoint — set via env var or fall back to placeholder
const MODEL = process.env.ARK_MODEL_ID ?? "ep-xxxxxxxx";

export type LlmMessage = ChatCompletionMessageParam;

export type LlmTool = ChatCompletionTool;

export type LlmToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type LlmThinkingProfile = "fast" | "default" | "deep";

interface StreamChatOptions {
  systemPrompt: string;
  messages: LlmMessage[];
  onChunk: (text: string) => void;
  onReasoningChunk?: (text: string) => void;
  thinkingProfile?: LlmThinkingProfile;
}

interface CompleteWithToolsOptions {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  thinkingProfile?: LlmThinkingProfile;
}

function resolveThinkingMode(profile: LlmThinkingProfile | undefined): ThinkingMode {
  switch (profile) {
    case "fast":
      return "disabled";
    case "deep":
      return "enabled";
    default:
      return "auto";
  }
}

export const llm = {
  async streamChat({ systemPrompt, messages, onChunk, onReasoningChunk, thinkingProfile }: StreamChatOptions) {
    await streamText({
      systemPrompt,
      messages,
      onChunk,
      onReasoningChunk,
      thinkingMode: resolveThinkingMode(thinkingProfile),
      runName: "legacy-stream-chat",
      tags: ["legacy-llm", "stream-chat"],
    });
  },

  async completeWithTools({ systemPrompt, messages, tools, thinkingProfile }: CompleteWithToolsOptions) {
    return invokeWithTools({
      systemPrompt,
      messages,
      tools,
      thinkingMode: resolveThinkingMode(thinkingProfile),
      runName: "legacy-complete-with-tools",
      tags: ["legacy-llm", "tool-call"],
    });
  },

  async chat(
    systemPrompt: string,
    userContent: string,
    options?: { thinkingProfile?: LlmThinkingProfile }
  ): Promise<string> {
    return invokeText({
      systemPrompt,
      userContent,
      thinkingMode: resolveThinkingMode(options?.thinkingProfile),
      runName: "legacy-chat",
      tags: ["legacy-llm", "chat"],
    });
  },
};

export { client, MODEL };
