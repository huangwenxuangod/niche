import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

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
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  },

  async completeWithTools({ systemPrompt, messages, tools }: CompleteWithToolsOptions) {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      tools,
      tool_choice: "auto",
    });

    const message = res.choices[0]?.message;
    return {
      content: message?.content ?? "",
      toolCalls: (message?.tool_calls as LlmToolCall[] | undefined) ?? [],
    };
  },

  async chat(systemPrompt: string, userContent: string): Promise<string> {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  },
};

export { client, MODEL };
