import { toOpenAiTool } from "./helpers";
import { analyzeJourneyDataToolDefinition, runAnalyzeJourneyData } from "./analyze-journey-data";
import { complianceCheckToolDefinition } from "./compliance-check";
import { generateFullArticleToolDefinition, runGenerateFullArticle } from "./generate-full-article";
import { generateTopicsToolDefinition, runGenerateTopics } from "./generate-topics";
import { searchHotTopicsToolDefinition, runSearchHotTopics } from "./search-hot-topics";
import { searchKnowledgeBaseToolDefinition, runSearchKnowledgeBase } from "./search-knowledge-base";

export const AGENT_TOOL_REGISTRY = {
  search_hot_topics: {
    definition: searchHotTopicsToolDefinition,
    execute: runSearchHotTopics,
  },
  analyze_journey_data: {
    definition: analyzeJourneyDataToolDefinition,
    execute: runAnalyzeJourneyData,
  },
  search_knowledge_base: {
    definition: searchKnowledgeBaseToolDefinition,
    execute: runSearchKnowledgeBase,
  },
  generate_topics: {
    definition: generateTopicsToolDefinition,
    execute: runGenerateTopics,
  },
  generate_full_article: {
    definition: generateFullArticleToolDefinition,
    execute: runGenerateFullArticle,
  },
  compliance_check: {
    definition: complianceCheckToolDefinition,
    execute: null,
  },
} as const;

export const AGENT_TOOLS = Object.values(AGENT_TOOL_REGISTRY).map((item) =>
  toOpenAiTool(item.definition)
);
