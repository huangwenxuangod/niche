import { ChatOpenAI } from "@langchain/openai";

const MODEL = process.env.ARK_MODEL_ID ?? "ep-xxxxxxxx";
const API_KEY = process.env.OPENAI_API_KEY ?? "";
const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

function createBaseModel(temperature = 0.2) {
  return new ChatOpenAI({
    model: MODEL,
    apiKey: API_KEY,
    temperature,
    maxRetries: 2,
    configuration: {
      baseURL: BASE_URL,
    },
  });
}

export function getPrimaryChatModel() {
  return createBaseModel(0.4);
}

export function getStructuredOutputModel() {
  return createBaseModel(0.1);
}

export function getFastExtractionModel() {
  return createBaseModel(0);
}

export { MODEL as LANGCHAIN_MODEL };
