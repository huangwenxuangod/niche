import { toOpenAiTool } from "./helpers";
import { analyzeJourneyDataToolDefinition, runAnalyzeJourneyData } from "./analyze-journey-data";
import { analyzeMyAccountToolDefinition, runAnalyzeMyAccount } from "./analyze-my-account";
import { complianceCheckToolDefinition } from "./compliance-check";
import { generateFullArticleToolDefinition, runGenerateFullArticle } from "./generate-full-article";
import { generateTopicsToolDefinition, runGenerateTopics } from "./generate-topics";
import { importKocByNameToolDefinition, runImportKocByName } from "./import-koc-by-name";
import { searchHotTopicsToolDefinition, runSearchHotTopics } from "./search-hot-topics";
import { searchKnowledgeBaseToolDefinition, runSearchKnowledgeBase } from "./search-knowledge-base";
import { searchWechatHotArticlesToolDefinition, runSearchWechatHotArticles } from "./search-wechat-hot-articles";

export const AGENT_TOOL_REGISTRY = {
  search_hot_topics: {
    definition: searchHotTopicsToolDefinition,
    execute: runSearchHotTopics,
  },
  search_wechat_hot_articles: {
    definition: searchWechatHotArticlesToolDefinition,
    execute: runSearchWechatHotArticles,
  },
  import_koc_by_name: {
    definition: importKocByNameToolDefinition,
    execute: runImportKocByName,
  },
  analyze_my_account: {
    definition: analyzeMyAccountToolDefinition,
    execute: runAnalyzeMyAccount,
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
