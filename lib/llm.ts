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
  const requestStartedAt = Date.now();
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  console.info("[llm.stream][request_start]", {
    requestStartedAt,
    messageCount: messages.length,
    hasTools: Boolean(params.tools?.length),
    model: MODEL,
  });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: params.tools,
    stream: true,
    temperature: 0.7,
  });

  const responseReadyAt = Date.now();
  console.info("[llm.stream][response_ready]", {
    responseReadyAt,
    sinceRequestStart: responseReadyAt - requestStartedAt,
    model: MODEL,
  });

  let rawChunkIndex = 0;
  let textChunkIndex = 0;
  let nonContentChunkDebugCount = 0;
  let firstRawChunkAt: number | null = null;
  let firstTextChunkAt: number | null = null;
  let lastRawChunkAt: number | null = null;
  let lastTextChunkAt: number | null = null;

  for await (const chunk of response) {
    const now = Date.now();
    rawChunkIndex += 1;
    if (firstRawChunkAt === null) {
      firstRawChunkAt = now;
      console.info("[llm.stream][first_raw_chunk]", {
        rawChunkIndex,
        at: now,
        sinceRequestStart: now - requestStartedAt,
        sinceResponseReady: now - responseReadyAt,
      });
    }

    const delta = chunk.choices[0]?.delta;
    const choice = chunk.choices[0];
    const rawChunkDebug = {
      rawChunkIndex,
      at: now,
      sinceRequestStart: now - requestStartedAt,
      sinceFirstRawChunk: now - firstRawChunkAt,
      sincePrevRawChunk: lastRawChunkAt === null ? null : now - lastRawChunkAt,
      hasContent: Boolean(delta?.content),
      hasToolCalls: Boolean(delta?.tool_calls?.length),
      finishReason: choice?.finish_reason ?? null,
    };
    console.info("[llm.stream][raw_chunk]", rawChunkDebug);

    if (!delta?.content) {
      nonContentChunkDebugCount += 1;

      if (nonContentChunkDebugCount <= 12 || rawChunkIndex % 100 === 0) {
        const deltaKeys = delta ? Object.keys(delta) : [];
        const choiceKeys = choice ? Object.keys(choice) : [];
        console.info("[llm.stream][raw_chunk_shape]", {
          rawChunkIndex,
          nonContentChunkDebugCount,
          deltaKeys,
          choiceKeys,
          role: delta?.role ?? null,
          hasReasoningContent:
            typeof (delta as Record<string, unknown> | undefined)?.["reasoning_content"] === "string",
          hasReasoning:
            typeof (delta as Record<string, unknown> | undefined)?.["reasoning"] === "string",
          hasThinking:
            typeof (delta as Record<string, unknown> | undefined)?.["thinking"] === "string",
        });
      }

      if (nonContentChunkDebugCount <= 8) {
        console.info(
          "[llm.stream][raw_chunk_full]",
          JSON.stringify(
            {
              rawChunkIndex,
              choice,
            },
            null,
            2,
          ),
        );
      }
    }
    lastRawChunkAt = now;

    if (delta?.content) {
      textChunkIndex += 1;
      if (firstTextChunkAt === null) {
        firstTextChunkAt = now;
        console.info("[llm.stream][first_text_chunk]", {
          textChunkIndex,
          at: now,
          sinceRequestStart: now - requestStartedAt,
          sinceResponseReady: now - responseReadyAt,
          sinceFirstRawChunk: firstRawChunkAt === null ? null : now - firstRawChunkAt,
          preview: delta.content.slice(0, 48),
        });
      }

      console.info("[llm.stream][text_chunk]", {
        textChunkIndex,
        at: now,
        sinceRequestStart: now - requestStartedAt,
        sinceFirstTextChunk: now - firstTextChunkAt,
        sincePrevTextChunk: lastTextChunkAt === null ? null : now - lastTextChunkAt,
        length: delta.content.length,
        preview: delta.content.slice(0, 48),
      });
      lastTextChunkAt = now;
      yield { type: "text", content: delta.content };
    }

    if (delta?.tool_calls) {
      yield { type: "tool_call", toolCalls: delta.tool_calls };
    }
  }

  const finishedAt = Date.now();
  console.info("[llm.stream][finished]", {
    finishedAt,
    sinceRequestStart: finishedAt - requestStartedAt,
    sinceResponseReady: finishedAt - responseReadyAt,
    sinceFirstRawChunk:
      firstRawChunkAt === null ? null : finishedAt - firstRawChunkAt,
    sinceFirstTextChunk:
      firstTextChunkAt === null ? null : finishedAt - firstTextChunkAt,
    rawChunkCount: rawChunkIndex,
    textChunkCount: textChunkIndex,
  });
}

export async function completeText(params: {
  systemPrompt: string;
  messages: LlmMessage[];
}): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content ?? "";
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
