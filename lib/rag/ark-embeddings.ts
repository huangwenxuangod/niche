const EMBEDDING_BASE_URL =
  process.env.ARK_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3";
const EMBEDDING_MODEL =
  process.env.ARK_EMBEDDING_MODEL?.trim() || "doubao-embedding-vision-251215";
const EMBEDDING_API_KEY = process.env.OPENAI_API_KEY?.trim();
const EMBEDDING_DIMENSIONS = Number(process.env.ARK_EMBEDDING_DIMENSIONS ?? "1024");
const MULTI_EMBEDDING_MODE = process.env.ARK_EMBEDDING_MULTI_MODE?.trim() || "enabled";
const SPARSE_EMBEDDING_MODE = process.env.ARK_EMBEDDING_SPARSE_MODE?.trim() || "enabled";

export const ARK_EMBEDDING_MODEL = EMBEDDING_MODEL;
export const ARK_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const ARK_EMBEDDING_BATCH_LIMIT = 4;

export async function embedQuery(text: string) {
  const [embedding] = await embedBatch([text]);
  return embedding;
}

export async function embedBatch(texts: string[]) {
  const normalized = texts.map(normalizeEmbeddingInput).filter(Boolean);
  if (normalized.length === 0) {
    return [] as number[][];
  }

  const embeddings: number[][] = [];

  for (let index = 0; index < normalized.length; index += ARK_EMBEDDING_BATCH_LIMIT) {
    const batch = normalized.slice(index, index + ARK_EMBEDDING_BATCH_LIMIT);
    const response = await requestEmbeddings(batch);
    const items = normalizeEmbeddingItems(response.data);

    embeddings.push(
      ...items
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding)
    );
  }

  return embeddings;
}

export async function runArkEmbeddingProbe(input = ["天很蓝", "海很深"]) {
  const startedAt = Date.now();
  const response = await requestEmbeddings(input);
  const items = normalizeEmbeddingItems(response.data);
  const first = items[0];

  return {
    model: response.model,
    latencyMs: Date.now() - startedAt,
    vectorCount: items.length,
    vectorDimensions: Array.isArray(first?.embedding) ? first.embedding.length : 0,
    sparseDimensions: Array.isArray(first?.sparse_embedding)
      ? first.sparse_embedding.length
      : 0,
    multiVectorDimensions: Array.isArray(first?.multi_embedding)
      ? first.multi_embedding.length
      : 0,
    usage: response.usage ?? null,
  };
}

function normalizeEmbeddingInput(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

async function requestEmbeddings(texts: string[]) {
  if (!EMBEDDING_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 Ark embeddings");
  }

  const response = await fetch(`${EMBEDDING_BASE_URL}/embeddings/multimodal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      instructions:
        "Target_modality: text and video.\nInstruction:Compress the text/video into one word.\nQuery:",
      input: texts.map((text) => ({
        type: "text",
        text,
      })),
      dimensions: EMBEDDING_DIMENSIONS,
      multi_embedding: {
        type: MULTI_EMBEDDING_MODE,
      },
      sparse_embedding: {
        type: SPARSE_EMBEDDING_MODE,
      },
      encoding_format: "float",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | {
          error?: {
            code?: string;
            message?: string;
          };
        }
      | null;

    const message = errorPayload?.error?.message;
    if (response.status === 404) {
      throw new Error(
        `Ark embedding 模型不可用：${EMBEDDING_MODEL}。请确认该模型已开通，或把 ARK_EMBEDDING_MODEL 改成你账号可访问的 endpoint ID / model ID。${message ? ` ${message}` : ""}`
      );
    }

    throw new Error(message || `Ark embeddings 调用失败（${response.status}）`);
  }

  return (await response.json()) as ArkEmbeddingResponse;
}

type ArkEmbeddingResponse = {
  model: string;
  usage?: Record<string, unknown> | null;
  data: ArkEmbeddingItem | ArkEmbeddingItem[];
};

type ArkEmbeddingItem = {
  index?: number;
  embedding: number[];
  multi_embedding?: number[] | number[][] | null;
  sparse_embedding?: unknown[] | null;
};

function normalizeEmbeddingItems(data: ArkEmbeddingResponse["data"]) {
  const items = Array.isArray(data) ? data : [data];
  return items.map((item, index) => ({
    index: item.index ?? index,
    embedding: item.embedding,
    multi_embedding: item.multi_embedding ?? null,
    sparse_embedding: item.sparse_embedding ?? null,
  }));
}
