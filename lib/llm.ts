import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { invokeText, invokeWithTools, streamText } from "@/lib/agent/runtime";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
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

interface StreamChatOptions {
  systemPrompt: string;
  messages: LlmMessage[];
  onChunk: (text: string) => void;
}

interface CompleteWithToolsOptions {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmTool[];
}

export const llm = {
  async streamChat({ systemPrompt, messages, onChunk }: StreamChatOptions) {
    await streamText({
      systemPrompt,
      messages,
      onChunk,
      runName: "legacy-stream-chat",
      tags: ["legacy-llm", "stream-chat"],
    });
  },

  async completeWithTools({ systemPrompt, messages, tools }: CompleteWithToolsOptions) {
    return invokeWithTools({
      systemPrompt,
      messages,
      tools,
      runName: "legacy-complete-with-tools",
      tags: ["legacy-llm", "tool-call"],
    });
  },

  async chat(systemPrompt: string, userContent: string): Promise<string> {
    return invokeText({
      systemPrompt,
      userContent,
      runName: "legacy-chat",
      tags: ["legacy-llm", "chat"],
    });
  },
};

export { client, MODEL };
