/**
 * 工具注册表 - OpenClaw 风格记忆驱动架构
 *
 * 核心设计：
 * 1. 工具执行自动记录到情景记忆，不可遗漏
 * 2. 工具元数据声明式配置，包含记忆相关设置
 * 3. 错误自动捕获并记录，支持重试和复盘
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toOpenAiTool } from "./helpers";
import type { ToolExecutionContext } from "./types";
import {
  recordStep,
  type StepType,
} from "@/lib/agent/memory/session-memory";

// ============================================================================
// 工具元数据类型
// ============================================================================

/**
 * 工具记忆配置
 */
export interface ToolMemoryConfig {
  /** 是否记录输入 */
  recordInput: boolean;
  /** 是否记录输出 */
  recordOutput: boolean;
  /** 是否记录错误 */
  recordError: boolean;
  /** 从结果中提取要记忆的关键信息（用于更新长期记忆） */
  extractMemory?: (result: unknown) => Record<string, unknown> | null;
}

/**
 * 完整工具定义
 */
export interface ToolDefinition<TSchema extends z.ZodSchema = z.ZodSchema> {
  name: string;
  description: string;
  schema: TSchema;
  memory: ToolMemoryConfig;
}

// ============================================================================
// 记忆感知工具包装器
// ============================================================================

/**
 * 生成唯一的步骤 ID
 */
function generateStepId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 包装工具执行，自动记录到情景记忆
 *
 * 这是记忆驱动架构的核心：所有工具执行自动记录，不可遗漏
 */
export function wrapWithMemoryLogging<
  TSchema extends z.ZodSchema,
  THandler extends (
    args: z.infer<TSchema>,
    context: ToolExecutionContext
  ) => Promise<unknown>
>(
  definition: ToolDefinition<TSchema>,
  handler: THandler
): (rawArgs: unknown, context: ToolExecutionContext) => Promise<unknown> {
  return async (
    rawArgs: unknown,
    context: ToolExecutionContext
  ): Promise<unknown> => {
    const { supabase, conversationId, userId } = context;

    // 验证参数
    const args = definition.schema.parse(rawArgs);

    // 生成步骤 ID（用于关联调用和结果）
    const stepId = generateStepId();

    // ================================================================
    // 1. 记录工具调用意图（如果配置允许）
    // ================================================================
    if (definition.memory.recordInput && conversationId) {
      await recordStep(supabase, conversationId, {
        id: `${stepId}-call`,
        type: 'tool_call',
        content: {
          tool: definition.name,
          args: definition.memory.recordInput ? args : '[REDACTED]',
          stepId,
        },
      });
    }

    // ================================================================
    // 2. 执行工具
    // ================================================================
    let result: unknown;
    let error: Error | null = null;

    try {
      result = await handler(args, context);
    } catch (e) {
      error = e as Error;
    }

    // ================================================================
    // 3. 记录结果或错误
    // ================================================================
    if (conversationId) {
      if (error) {
        // 记录错误
        if (definition.memory.recordError) {
          await recordStep(supabase, conversationId, {
            id: `${stepId}-error`,
            type: 'observation',
            content: {
              tool: definition.name,
              stepId,
              error: error.message,
              stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            },
          });
        }
        throw error; // 继续抛出，让上层处理
      } else {
        // 记录成功结果
        if (definition.memory.recordOutput) {
          await recordStep(supabase, conversationId, {
            id: `${stepId}-result`,
            type: 'observation',
            content: {
              tool: definition.name,
              stepId,
              result: definition.memory.recordOutput ? result : '[REDACTED]',
            },
          });
        }

        // 提取长期记忆（如果配置允许）
        if (definition.memory.extractMemory && result) {
          const extracted = definition.memory.extractMemory(result);
          if (extracted && userId) {
            // 这里可以更新长期记忆
            // await updateLongTermMemory(supabase, userId, extracted);
          }
        }
      }
    }

    return result;
  };
}

// ============================================================================
// 工具注册辅助函数
// ============================================================================

/**
 * 创建标准工具定义
 */
export function createToolDefinition<
  TSchema extends z.ZodSchema
>(
  name: string,
  description: string,
  schema: TSchema,
  memoryConfig?: Partial<ToolMemoryConfig>
): ToolDefinition<TSchema> {
  return {
    name,
    description,
    schema,
    memory: {
      recordInput: true,
      recordOutput: true,
      recordError: true,
      ...memoryConfig,
    },
  };
}

// ============================================================================
// 记忆配置模板
// ============================================================================

/**
 * 敏感工具的记忆配置（不记录输入输出）
 */
export const SENSITIVE_MEMORY_CONFIG: ToolMemoryConfig = {
  recordInput: false,
  recordOutput: false,
  recordError: true, // 但记录错误以便调试
};

/**
 * 只记录摘要的记忆配置
 */
export const SUMMARY_MEMORY_CONFIG: ToolMemoryConfig = {
  recordInput: true,
  recordOutput: false, // 不记录完整输出
  recordError: true,
  extractMemory: (result) => {
    // 只提取摘要
    if (typeof result === 'object' && result !== null) {
      const { summary, count, total } = result as Record<string, unknown>;
      return { summary, count, total };
    }
    return null;
  },
};

// ============================================================================
// 具体工具导入
// ============================================================================

import { searchHotTopicsSchema, runSearchHotTopics } from "./search-hot-topics";
import { analyzeJourneyDataSchema, runAnalyzeJourneyData } from "./analyze-journey-data";
import { analyzeMyAccountSchema, runAnalyzeMyAccount } from "./analyze-my-account";
import { generateFullArticleSchema, runGenerateFullArticle } from "./generate-full-article";
import { generateTopicsSchema, runGenerateTopics } from "./generate-topics";
import { importKocByNameSchema, runImportKocByName } from "./import-koc-by-name";
import { searchKnowledgeBaseSchema, runSearchKnowledgeBase } from "./search-knowledge-base";
import { searchWechatHotArticlesSchema, runSearchWechatHotArticles } from "./search-wechat-hot-articles";
import { complianceCheckSchema } from "./compliance-check";

// ============================================================================
// 工具注册表
// ============================================================================

export const AGENT_TOOL_REGISTRY = {
  search_hot_topics: {
    definition: createToolDefinition(
      "search_hot_topics",
      "搜索当前赛道近几天热点",
      searchHotTopicsSchema,
      { extractMemory: (result) => ({
          hotTopics: (result as { topics: unknown[] }).topics,
          lastSearchTime: Date.now(),
        }) }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "search_hot_topics",
        "搜索当前赛道近几天热点",
        searchHotTopicsSchema,
        { extractMemory: (result) => ({
            hotTopics: (result as { topics: unknown[] }).topics,
            lastSearchTime: Date.now(),
          }) }
      ),
      runSearchHotTopics
    ),
  },
  search_wechat_hot_articles: {
    definition: createToolDefinition(
      "search_wechat_hot_articles",
      "用关键词搜索公众号爆文，找优质账号样本",
      searchWechatHotArticlesSchema,
      { recordInput: true, recordOutput: false, extractMemory: (result) => ({
          keyword: (result as { keyword: string }).keyword,
          articleCount: (result as { articles: unknown[] }).articles?.length,
        }) }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "search_wechat_hot_articles",
        "用关键词搜索公众号爆文，找优质账号样本",
        searchWechatHotArticlesSchema,
        { recordInput: true, recordOutput: false }
      ),
      runSearchWechatHotArticles
    ),
  },
  import_koc_by_name: {
    definition: createToolDefinition(
      "import_koc_by_name",
      "导入明确账号名的对标账号到知识库",
      importKocByNameSchema,
      { extractMemory: (result) => ({
          importedAccount: (result as { account_name?: string }).account_name,
          timestamp: Date.now(),
        }) }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "import_koc_by_name",
        "导入明确账号名的对标账号到知识库",
        importKocByNameSchema,
        { extractMemory: (result) => ({
            importedAccount: (result as { account_name?: string }).account_name,
            timestamp: Date.now(),
          }) }
      ),
      runImportKocByName
    ),
  },
  analyze_my_account: {
    definition: createToolDefinition("analyze_my_account", "分析用户自己的公众号", analyzeMyAccountSchema),
    execute: wrapWithMemoryLogging(
      createToolDefinition("analyze_my_account", "分析用户自己的公众号", analyzeMyAccountSchema),
      runAnalyzeMyAccount
    ),
  },
  analyze_journey_data: {
    definition: createToolDefinition(
      "analyze_journey_data",
      "分析已导入的对标账号和爆款文章规律",
      analyzeJourneyDataSchema,
      { recordInput: true, recordOutput: false }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "analyze_journey_data",
        "分析已导入的对标账号和爆款文章规律",
        analyzeJourneyDataSchema,
        { recordInput: true, recordOutput: false }
      ),
      runAnalyzeJourneyData
    ),
  },
  search_knowledge_base: {
    definition: createToolDefinition(
      "search_knowledge_base",
      "从知识库检索已导入文章",
      searchKnowledgeBaseSchema,
      { recordInput: true, recordOutput: false }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "search_knowledge_base",
        "从知识库检索已导入文章",
        searchKnowledgeBaseSchema,
        { recordInput: true, recordOutput: false }
      ),
      runSearchKnowledgeBase
    ),
  },
  generate_topics: {
    definition: createToolDefinition(
      "generate_topics",
      "基于赛道、知识库和记忆生成候选选题",
      generateTopicsSchema,
      { extractMemory: (result) => ({
          topics: (result as { topics: unknown[] }).topics?.map((t: unknown) =>
            (t as { title: string }).title
          ),
          generatedAt: Date.now(),
        }) }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "generate_topics",
        "基于赛道、知识库和记忆生成候选选题",
        generateTopicsSchema,
        { extractMemory: (result) => ({
            topics: (result as { topics: unknown[] }).topics?.map((t: unknown) =>
              (t as { title: string }).title
            ),
            generatedAt: Date.now(),
          }) }
      ),
      runGenerateTopics
    ),
  },
  generate_full_article: {
    definition: createToolDefinition(
      "generate_full_article",
      "生成可发布级公众号完整初稿",
      generateFullArticleSchema,
      { extractMemory: (result) => ({
          title: (result as { title: string }).title,
          generatedAt: Date.now(),
        }) }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition(
        "generate_full_article",
        "生成可发布级公众号完整初稿",
        generateFullArticleSchema,
        { extractMemory: (result) => ({
            title: (result as { title: string }).title,
            generatedAt: Date.now(),
          }) }
      ),
      runGenerateFullArticle
    ),
  },
  compliance_check: {
    definition: createToolDefinition(
      "compliance_check",
      "检查内容合规和限流风险",
      complianceCheckSchema,
      { recordInput: true, recordOutput: false }
    ),
    // compliance_check 在 route.ts 中硬编码处理
    execute: null as unknown as (args: unknown, context: unknown) => Promise<unknown>,
  },
} as const;

export const AGENT_TOOLS = Object.values(AGENT_TOOL_REGISTRY).map((item) =>
  toOpenAiTool(item.definition)
);
