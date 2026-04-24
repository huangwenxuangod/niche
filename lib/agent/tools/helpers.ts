import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

export type AgentToolDefinition<TArgs extends z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: TArgs;
};

export function zodToOpenAiParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-7",
  }) as Record<string, unknown>;

  if (jsonSchema.type === "object") {
    return jsonSchema;
  }

  return {
    type: "object",
    properties: {},
  };
}

export function toOpenAiTool(definition: AgentToolDefinition<z.ZodTypeAny>): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: zodToOpenAiParameters(definition.schema),
    },
  };
}
