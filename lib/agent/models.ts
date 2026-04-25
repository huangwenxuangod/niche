import { ChatOpenAI } from "@langchain/openai";

const MODEL = process.env.ARK_MODEL_ID ?? "ep-xxxxxxxx";
const API_KEY = process.env.OPENAI_API_KEY ?? "";
const BASE_URL = process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";

export type ThinkingMode = "enabled" | "disabled" | "auto";

function createBaseModel(
  temperature = 0.2,
  options?: {
    thinkingMode?: ThinkingMode;
    includeRawResponse?: boolean;
  }
) {
  return new ChatOpenAI({
    model: MODEL,
    apiKey: API_KEY,
    temperature,
    maxRetries: 2,
    __includeRawResponse: options?.includeRawResponse,
    modelKwargs:
      options?.thinkingMode
        ? {
            extra_body: {
              thinking: {
                type: options.thinkingMode,
              },
            },
          }
        : undefined,
    configuration: {
      baseURL: BASE_URL,
    },
  });
}

export function getPrimaryChatModel(thinkingMode: ThinkingMode = "auto") {
  return createBaseModel(0.4, { thinkingMode });
}

export function getThinkingChatModel(thinkingMode: ThinkingMode, temperature = 0.2) {
  return createBaseModel(temperature, { thinkingMode });
}

export function getProbeChatModel(thinkingMode: ThinkingMode) {
  return createBaseModel(0, {
    thinkingMode,
    includeRawResponse: true,
  });
}

export function getStructuredOutputModel(thinkingMode: ThinkingMode = "auto") {
  return createBaseModel(0.1, { thinkingMode });
}

export function getFastExtractionModel(thinkingMode: ThinkingMode = "auto") {
  return createBaseModel(0, { thinkingMode });
}

export { MODEL as LANGCHAIN_MODEL };
