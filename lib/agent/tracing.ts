import type { RunnableConfig } from "@langchain/core/runnables";

type BuildAgentRunConfigOptions = {
  runName: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export function isLangSmithEnabled() {
  return Boolean(process.env.LANGSMITH_TRACING === "true" && process.env.LANGSMITH_API_KEY);
}

export function buildAgentRunConfig({
  runName,
  tags = [],
  metadata = {},
}: BuildAgentRunConfigOptions): RunnableConfig {
  return {
    runName,
    tags: ["niche", ...tags],
    metadata: {
      app: "niche",
      tracing_enabled: isLangSmithEnabled(),
      ...metadata,
    },
  };
}
