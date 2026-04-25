import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

type WechatConfigRow = {
  id: string;
  app_id: string;
  app_secret_encrypted: string;
  account_name: string | null;
};

type OwnedWechatProfileRow = {
  id: string;
  account_name: string;
};

type OwnedWechatArticleRecord = {
  publishId: string;
  msgId: string | null;
  articleIdx: number;
  title: string;
  digest: string;
  content: string;
  contentHtml: string;
  url: string;
  coverUrl: string | null;
  author: string | null;
  accountName: string | null;
  publishTime: string | null;
  rawPayload: Record<string, unknown>;
  readNum?: number;
  likeNum?: number;
  shareNum?: number;
  commentNum?: number;
  favoriteNum?: number;
};

type ArticleMetric = {
  key: string;
  title: string | null;
  readNum: number;
  likeNum: number;
  shareNum: number;
  commentNum: number;
  favoriteNum: number;
};

type OwnedAnalysisReport = {
  summary: {
    account_name: string;
    article_count_30d: number;
    avg_read: number;
    best_article_title: string | null;
  };
  content_overview: {
    posting_pattern: string;
    title_pattern: string;
    best_topics: string[];
  };
  top_articles: Array<{
    title: string;
    read_num: number;
    publish_time: string | null;
    reason: string;
  }>;
  competitor_gap: {
    overview: string;
    topic_gap: string[];
    title_gap: string[];
    structure_gap: string[];
  };
  next_actions: string[];
  message_for_chat: string;
};

type OwnedWechatAnalysisGraphParams = {
  journeyId: string;
  userId: string;
  accountName: string;
  wechatConfigId?: string | null;
  syncJobId: string;
};

type OwnedWechatAnalysisGraphDeps = {
  loadConfig: (wechatConfigId?: string | null) => Promise<WechatConfigRow | null>;
  markStep: (
    syncJobId: string,
    patch: {
      status?: "running" | "success" | "error";
      step: string;
      articles_synced?: number;
      metrics_synced?: number;
      finished_at?: string;
      error_message?: string | null;
    }
  ) => Promise<void>;
  ensureProfile: (input: {
    accountName: string;
    wechatConfigId?: string | null;
  }) => Promise<OwnedWechatProfileRow>;
  importOwnedArticles: (input: {
    accountName: string;
    ownedProfileId: string;
    wechatConfigId?: string | null;
  }) => Promise<OwnedWechatArticleRecord[]>;
  fetchOfficialMetrics: (config: WechatConfigRow | null) => Promise<{
    metrics: ArticleMetric[];
    officialMetricsEnabled: boolean;
    warnings?: string[];
  }>;
  saveArticlesAndRefreshProfile: (input: {
    ownedProfileId: string;
    wechatConfigId?: string | null;
    importedArticles: OwnedWechatArticleRecord[];
    metrics: ArticleMetric[];
    officialMetricsEnabled: boolean;
  }) => Promise<OwnedWechatArticleRecord[]>;
  buildReport: (input: {
    accountName: string;
    ownedProfileId: string;
  }) => Promise<OwnedAnalysisReport>;
  persistReport: (input: {
    syncJobId: string;
    report: OwnedAnalysisReport;
  }) => Promise<string>;
};

const OwnedWechatAnalysisState = Annotation.Root({
  journeyId: Annotation<string>,
  userId: Annotation<string>,
  accountName: Annotation<string>,
  wechatConfigId: Annotation<string | null>,
  syncJobId: Annotation<string>,
  config: Annotation<WechatConfigRow | null>(),
  ownedProfile: Annotation<OwnedWechatProfileRow | null>(),
  importedArticles: Annotation<OwnedWechatArticleRecord[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  metrics: Annotation<ArticleMetric[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  officialMetricsEnabled: Annotation<boolean>(),
  officialConfigPresent: Annotation<boolean>(),
  sourceMode: Annotation<"content_only" | "mixed">(),
  warnings: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  syncedArticles: Annotation<OwnedWechatArticleRecord[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  report: Annotation<OwnedAnalysisReport | null>(),
  reportId: Annotation<string | null>(),
  articleCount: Annotation<number>(),
  metricCount: Annotation<number>(),
});

export async function runOwnedWechatAnalysisGraph(
  params: OwnedWechatAnalysisGraphParams,
  deps: OwnedWechatAnalysisGraphDeps
) {
  const workflow = new StateGraph(OwnedWechatAnalysisState)
    .addNode("loadConfig", async (state) => {
      const config = await deps.loadConfig(state.wechatConfigId);
      await deps.markStep(state.syncJobId, {
        status: "running",
        step: "fetching_articles",
      });

      return {
        config,
        officialConfigPresent: Boolean(config),
        wechatConfigId: config?.id ?? state.wechatConfigId ?? null,
      };
    })
    .addNode("ensureProfile", async (state) => {
      const ownedProfile = await deps.ensureProfile({
        accountName: state.accountName,
        wechatConfigId: state.wechatConfigId,
      });

      await deps.markStep(state.syncJobId, {
        step: "importing_owned_articles",
      });

      return { ownedProfile };
    })
    .addNode("importOwnedArticles", async (state) => {
      if (!state.ownedProfile) {
        throw new Error("自己的公众号档案还未初始化。");
      }

      const importedArticles = await deps.importOwnedArticles({
        accountName: state.accountName,
        ownedProfileId: state.ownedProfile.id,
        wechatConfigId: state.wechatConfigId,
      });

      await deps.markStep(state.syncJobId, {
        step: "fetching_metrics",
        articles_synced: importedArticles.length,
      });

      return {
        importedArticles,
        articleCount: importedArticles.length,
      };
    })
    .addNode("fetchOfficialMetrics", async (state) => {
      const { metrics, officialMetricsEnabled } = await deps.fetchOfficialMetrics(state.config);

      await deps.markStep(state.syncJobId, {
        step: "saving_articles",
        metrics_synced: metrics.length,
      });

      return {
        metrics,
        officialMetricsEnabled,
        sourceMode: officialMetricsEnabled ? "mixed" : "content_only",
        warnings:
          metrics.length > 0
            ? []
            : state.config
              ? ["本次没有补充到官方表现数据，当前结果以内容主体分析为主。"]
              : ["当前未配置公众号官方凭证，结果以内容主体分析为主。"],
        metricCount: metrics.length,
      };
    })
    .addNode("saveOwnedArticles", async (state) => {
      if (!state.ownedProfile) {
        throw new Error("自己的公众号档案还未初始化。");
      }

      const syncedArticles = await deps.saveArticlesAndRefreshProfile({
        ownedProfileId: state.ownedProfile.id,
        wechatConfigId: state.wechatConfigId,
        importedArticles: state.importedArticles,
        metrics: state.metrics,
        officialMetricsEnabled: state.officialMetricsEnabled ?? false,
      });

      await deps.markStep(state.syncJobId, {
        step: "building_report",
      });

      return { syncedArticles };
    })
    .addNode("buildReport", async (state) => {
      if (!state.ownedProfile) {
        throw new Error("自己的公众号档案还未初始化。");
      }

      const report = await deps.buildReport({
        accountName: state.accountName,
        ownedProfileId: state.ownedProfile.id,
      });

      return { report };
    })
    .addNode("persistReport", async (state) => {
      if (!state.report) {
        throw new Error("增长分析报告生成失败。");
      }

      const reportId = await deps.persistReport({
        syncJobId: state.syncJobId,
        report: state.report,
      });

      await deps.markStep(state.syncJobId, {
        status: "success",
        step: "done",
        finished_at: new Date().toISOString(),
      });

      return { reportId };
    })
    .addEdge(START, "loadConfig")
    .addEdge("loadConfig", "ensureProfile")
    .addEdge("ensureProfile", "importOwnedArticles")
    .addEdge("importOwnedArticles", "fetchOfficialMetrics")
    .addEdge("fetchOfficialMetrics", "saveOwnedArticles")
    .addEdge("saveOwnedArticles", "buildReport")
    .addEdge("buildReport", "persistReport")
    .addEdge("persistReport", END);

  const graph = workflow.compile();

  const result = await graph.invoke({
    journeyId: params.journeyId,
    userId: params.userId,
    accountName: params.accountName,
    wechatConfigId: params.wechatConfigId ?? null,
    syncJobId: params.syncJobId,
    config: null,
    ownedProfile: null,
    importedArticles: [],
    metrics: [],
    officialMetricsEnabled: false,
    syncedArticles: [],
    report: null,
    reportId: null,
    officialConfigPresent: false,
    sourceMode: "content_only",
    warnings: [],
    articleCount: 0,
    metricCount: 0,
  }, buildAgentRunConfig({
    runName: "owned-wechat-analysis-graph",
    tags: ["langgraph", "growth-analysis", "owned-wechat"],
    metadata: {
      journeyId: params.journeyId,
      accountName: params.accountName,
    },
  }));

  if (!result.report || !result.reportId) {
    throw new Error("增长分析图执行完成，但没有产出最终报告。");
  }

  return {
    jobId: result.syncJobId,
    reportId: result.reportId,
    articleCount: result.articleCount ?? result.syncedArticles.length,
    metricCount: result.metricCount ?? result.metrics.length,
    sourceMode: result.sourceMode ?? "content_only",
    officialConfigPresent: result.officialConfigPresent ?? false,
    officialMetricsEnabled: result.officialMetricsEnabled ?? false,
    warnings: result.warnings ?? [],
    report: result.report,
  };
}
