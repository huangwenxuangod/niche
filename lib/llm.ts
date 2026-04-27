import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
});

const MODEL = process.env.ARK_MODEL_ID ?? "";

// Export types for consumers
export type LlmMessage = ChatCompletionMessageParam;
export type LlmTool = ChatCompletionTool;

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmThinkingProfile = "fast" | "default" | "deep";

// Export client for direct access
export { client, MODEL };

// Stream chunk types
export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; toolCalls: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }> };

/**
 * Minimal streaming chat - true async generator with immediate first chunk
 */
export async function* streamChat(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
}): AsyncGenerator<StreamChunk> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: params.tools,
    stream: true,
    temperature: 0.7,
  });

  for await (const chunk of response) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      yield { type: "text", content: delta.content };
    }

    if (delta?.tool_calls) {
      yield { type: "tool_call", toolCalls: delta.tool_calls };
    }
  }
}

/**
 * Non-streaming completion with tools - for simple use cases
 */
export async function completeWithTools(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmTool[];
}): Promise<{
  content: string;
  toolCalls: LlmToolCall[];
}> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: params.tools,
    tool_choice: "auto",
    temperature: 0.7,
  });

  const message = response.choices[0]?.message;
  const content = message?.content ?? "";
  const rawToolCalls = message?.tool_calls ?? [];

  const toolCalls: LlmToolCall[] = rawToolCalls.map((tc) => {
    // Handle both function tool calls and custom tool calls
    const fn = (tc as any).function;
    return {
      id: tc.id,
      type: "function",
      function: {
        name: fn?.name ?? "",
        arguments: fn?.arguments ?? "{}",
      },
    };
  });

  return { content, toolCalls };
}

/**
 * Simple chat completion - for direct Q&A
 */
export async function chat(params: {
  systemPrompt: string;
  userContent: string;
}): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content ?? "";
}
