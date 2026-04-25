import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { getProbeChatModel, LANGCHAIN_MODEL, type ThinkingMode } from "@/lib/agent/models";
import { client, MODEL } from "@/lib/llm";

type ProbeMode = ThinkingMode;

type LangChainProbeResult = {
  mode: ProbeMode;
  invoke: {
    latencyMs: number;
    text: string;
    reasoning: string[];
    additionalKeys: string[];
    metadataKeys: string[];
    rawChoiceKeys: string[];
    usage: Record<string, unknown>;
  };
  stream: {
    latencyMs: number;
    text: string;
    reasoning: string[];
    chunkCount: number;
    reasoningChunkCount: number;
  };
};

type NativeProbeResult = {
  mode: ProbeMode;
  invoke: {
    latencyMs: number;
    text: string;
    reasoning: string;
    rawMessageKeys: string[];
    usage: Record<string, unknown>;
  };
  stream: {
    latencyMs: number;
    text: string;
    reasoning: string;
    chunkCount: number;
    reasoningChunkCount: number;
    usage: Record<string, unknown>;
  };
};

const DEFAULT_PROBE_PROMPT = `你是一个推理助手。请先认真思考，再回答下面问题：

问题：小红和小明分别做了两篇公众号文章。小红最近三篇阅读量是 1200、1600、2100，小明最近三篇阅读量是 900、1500、2600。
请完成两件事：
1. 判断谁的增长更稳定；
2. 用不超过 3 条要点解释原因。`;

export async function runReasoningCapabilityProbe(prompt = DEFAULT_PROBE_PROMPT) {
  const modes: ProbeMode[] = ["disabled", "auto", "enabled"];
  const [langchain, native] = await Promise.all([
    Promise.all(modes.map((mode) => probeLangChainMode(mode, prompt))),
    Promise.all(modes.map((mode) => probeNativeMode(mode, prompt))),
  ]);

  return {
    model: MODEL,
    langchain_model: LANGCHAIN_MODEL,
    prompt,
    langchain,
    native,
    summary: buildProbeSummary(langchain, native),
  };
}

async function probeLangChainMode(mode: ProbeMode, prompt: string): Promise<LangChainProbeResult> {
  const model = getProbeChatModel(mode);

  const invokeStartedAt = Date.now();
  const invokeResponse = await model.invoke([
    { role: "system", content: "请在回答前进行必要思考。" },
    { role: "user", content: prompt },
  ]);
  const invokeLatencyMs = Date.now() - invokeStartedAt;

  const invokeReasoning = extractReasoningPayload(invokeResponse);
  const invokeRaw = ((invokeResponse as AIMessage).additional_kwargs?.__raw_response ??
    {}) as { choices?: Array<{ message?: Record<string, unknown> }> };

  const streamStartedAt = Date.now();
  const stream = await model.stream([
    { role: "system", content: "请在回答前进行必要思考。" },
    { role: "user", content: prompt },
  ]);

  let streamText = "";
  const streamReasoning: string[] = [];
  let chunkCount = 0;
  let reasoningChunkCount = 0;

  for await (const chunk of stream) {
    chunkCount += 1;
    streamText += normalizeChunkText(chunk.content);
    const currentReasoning = extractReasoningPayload(chunk);
    if (currentReasoning.length > 0) {
      reasoningChunkCount += 1;
      streamReasoning.push(...currentReasoning);
    }
  }
  const streamLatencyMs = Date.now() - streamStartedAt;

  return {
    mode,
    invoke: {
      latencyMs: invokeLatencyMs,
      text: normalizeChunkText(invokeResponse.content),
      reasoning: dedupeStrings(invokeReasoning),
      additionalKeys: Object.keys((invokeResponse as AIMessage).additional_kwargs ?? {}),
      metadataKeys: Object.keys((invokeResponse as AIMessage).response_metadata ?? {}),
      rawChoiceKeys: Object.keys(invokeRaw.choices?.[0]?.message ?? {}),
      usage: normalizeUsage((invokeResponse as AIMessage).response_metadata?.tokenUsage),
    },
    stream: {
      latencyMs: streamLatencyMs,
      text: streamText,
      reasoning: dedupeStrings(streamReasoning),
      chunkCount,
      reasoningChunkCount,
    },
  };
}

async function probeNativeMode(mode: ProbeMode, prompt: string): Promise<NativeProbeResult> {
  const invokeStartedAt = Date.now();
  const invokeResponse = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "请在回答前进行必要思考。" },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    extra_body: {
      thinking: {
        type: mode,
      },
    },
  } as never);
  const invokeLatencyMs = Date.now() - invokeStartedAt;

  const streamStartedAt = Date.now();
  const stream = await (client.chat.completions.create as unknown as (params: unknown) => Promise<AsyncIterable<{
    choices?: Array<{
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
      };
    }>;
    usage?: Record<string, unknown>;
  }>>)({
    model: MODEL,
    messages: [
      { role: "system", content: "请在回答前进行必要思考。" },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    stream: true,
    extra_body: {
      thinking: {
        type: mode,
      },
    },
  });

  let streamText = "";
  let streamReasoning = "";
  let chunkCount = 0;
  let reasoningChunkCount = 0;
  let streamUsage: Record<string, unknown> = {};

  for await (const chunk of stream) {
    chunkCount += 1;
    const delta = chunk.choices?.[0]?.delta as {
      content?: string | null;
      reasoning_content?: string | null;
    };

    if (delta?.content) {
      streamText += delta.content;
    }
    if (delta?.reasoning_content) {
      reasoningChunkCount += 1;
      streamReasoning += delta.reasoning_content;
    }
    if (chunk.usage) {
      streamUsage = chunk.usage;
    }
  }
  const streamLatencyMs = Date.now() - streamStartedAt;

  const invokeMessage = invokeResponse.choices[0]?.message as unknown as {
    content?: string | null;
    reasoning_content?: string | null;
    [key: string]: unknown;
  };

  return {
    mode,
    invoke: {
      latencyMs: invokeLatencyMs,
      text: invokeMessage?.content ?? "",
      reasoning: invokeMessage?.reasoning_content ?? "",
      rawMessageKeys: Object.keys(invokeMessage ?? {}),
      usage: normalizeUsage((invokeResponse as { usage?: Record<string, unknown> }).usage),
    },
    stream: {
      latencyMs: streamLatencyMs,
      text: streamText,
      reasoning: streamReasoning,
      chunkCount,
      reasoningChunkCount,
      usage: normalizeUsage(streamUsage),
    },
  };
}

function normalizeChunkText(content: unknown) {
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

function extractReasoningPayload(message: AIMessage | AIMessageChunk | unknown) {
  const source = message as {
    additional_kwargs?: {
      reasoning_content?: string;
    };
    content?: unknown;
    contentBlocks?: Array<{ type?: string; reasoning?: unknown; text?: unknown }>;
  };

  const results: string[] = [];
  if (typeof source.additional_kwargs?.reasoning_content === "string") {
    results.push(source.additional_kwargs.reasoning_content);
  }

  const contentBlocks = Array.isArray((source as { contentBlocks?: unknown }).contentBlocks)
    ? (source as { contentBlocks?: Array<{ type?: string; reasoning?: unknown; text?: unknown }> }).contentBlocks
    : [];

  for (const block of contentBlocks ?? []) {
    if (block?.type === "reasoning") {
      if (typeof block.text === "string") {
        results.push(block.text);
      } else if (typeof block.reasoning === "string") {
        results.push(block.reasoning);
      }
    }
  }

  return dedupeStrings(results);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeUsage(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return {};
  }
  return usage as Record<string, unknown>;
}

function buildProbeSummary(langchain: LangChainProbeResult[], native: NativeProbeResult[]) {
  return {
    langchain: langchain.map((item) => ({
      mode: item.mode,
      invoke_latency_ms: item.invoke.latencyMs,
      stream_latency_ms: item.stream.latencyMs,
      invoke_reasoning_chars: item.invoke.reasoning.join("").length,
      stream_reasoning_chars: item.stream.reasoning.join("").length,
      invoke_usage: item.invoke.usage,
    })),
    native: native.map((item) => ({
      mode: item.mode,
      invoke_latency_ms: item.invoke.latencyMs,
      stream_latency_ms: item.stream.latencyMs,
      invoke_reasoning_chars: item.invoke.reasoning.length,
      stream_reasoning_chars: item.stream.reasoning.length,
      invoke_usage: item.invoke.usage,
      stream_usage: item.stream.usage,
    })),
  };
}
