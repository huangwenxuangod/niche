"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

interface Props {
  journeyId: string;
  onClose: () => void;
  onResult: (message: string) => void;
}

type ConfigState = "checking" | "configured" | "not_configured";
type AnalysisReport = {
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
type AnalysisMeta = {
  source_mode: "content_only" | "mixed";
  official_config_present: boolean;
  official_metrics_enabled: boolean;
  warnings: string[];
};

export function AccountAnalysisModal({ journeyId, onClose, onResult }: Props) {
  const [configState, setConfigState] = useState<ConfigState>("checking");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [articleCount, setArticleCount] = useState(0);
  const [metricCount, setMetricCount] = useState(0);

  const canAnalyze = accountName.trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const res = await fetch("/api/wechat/config");
        const data = await res.json();
        if (cancelled) return;

        if (res.ok && data.config?.app_id) {
          setAppId(data.config.app_id);
          setConfigState("configured");
          return;
        }

        setConfigState("not_configured");
      } catch {
        if (!cancelled) {
          setConfigState("not_configured");
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const headerDescription = useMemo(() => {
    if (configState === "configured") {
      return "输入公众号名称分析内容结构；已绑定的官方账号配置会继续保留，用于后续自动发布到公众号草稿箱。";
    }
    if (configState === "not_configured") {
      return "先用公众号名称导入和分析内容，后续如果要自动发布，再去排版发布流程里配置 AppID 和 AppSecret 即可。";
    }
    return "正在检查你的公众号发布配置...";
  }, [configState]);

  function handleAnalyze() {
    const normalizedName = accountName.trim();
    if (!normalizedName) {
      toast.error("请先填写要分析的公众号名称。");
      return;
    }
    setSubmitting(true);

    fetch("/api/wechat/owned-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        journey_id: journeyId,
        account_name: normalizedName,
        app_id: appId.trim(),
        app_secret: appSecret.trim(),
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "增长分析失败");
        }
        toast.success("增长分析已完成");
        setReport(data.report ?? null);
        setAnalysisMeta(data.analysis_meta ?? null);
        setArticleCount(Number(data.article_count || 0));
        setMetricCount(Number(data.metric_count || 0));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "增长分析失败");
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          overflow: "hidden",
          margin: "0 20px",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            增长分析
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
            {headerDescription}
          </div>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          {configState === "checking" ? (
            <div style={placeholderWrapStyle}>正在检查公众号配置...</div>
          ) : report ? (
            <AnalysisResultView
              accountName={accountName.trim() || report.summary.account_name}
              articleCount={articleCount}
              metricCount={metricCount}
              analysisMeta={analysisMeta}
              report={report}
              onBack={() => setReport(null)}
              onSend={() => {
                onResult(
                  report.message_for_chat ||
                    `请基于公众号“${accountName.trim() || report.summary.account_name}”的分析结果，给我下一步建议。`
                );
              }}
            />
          ) : (
            <>
              <PublishStatusCard configured={configState === "configured"} appId={appId} />

              <div style={labelStyle}>公众号名称</div>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="输入你的公众号名称..."
                autoFocus
                style={{ ...inputStyle, marginBottom: 18 }}
              />

              <div style={labelStyle}>AppID（可选，用于增强官方数据）</div>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="如已配置可不填"
                style={{ ...inputStyle, marginBottom: 12 }}
              />

              <div style={labelStyle}>AppSecret（可选，用于增强官方数据）</div>
              <input
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="如已配置可不填"
                type="password"
                style={{ ...inputStyle, marginBottom: 18 }}
              />

              <AnalysisCapabilityList />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose} style={ghostBtnStyle}>取消</button>
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze || submitting}
                  style={{
                    ...primaryBtnStyle,
                    opacity: canAnalyze && !submitting ? 1 : 0.45,
                    cursor: canAnalyze && !submitting ? "pointer" : "not-allowed",
                  }}
                >
                  {submitting ? "分析中..." : "开始分析 →"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisResultView({
  accountName,
  articleCount,
  metricCount,
  analysisMeta,
  report,
  onBack,
  onSend,
}: {
  accountName: string;
  articleCount: number;
  metricCount: number;
  analysisMeta: AnalysisMeta | null;
  report: AnalysisReport;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 10,
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={statusTitleStyle}>增长分析结果</div>
        <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
          {accountName}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text-secondary)" }}>
          已同步 {articleCount} 篇自己的内容
          {analysisMeta?.source_mode === "mixed"
            ? `，补充了 ${metricCount} 条官方数据`
            : "，当前以内容主体分析为主"}
        </div>
        {analysisMeta ? (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              数据来源：
              {analysisMeta.source_mode === "mixed"
                ? " 公众号内容导入 + 官方数据增强"
                : " 公众号内容导入"}
            </div>
            {analysisMeta.warnings.map((warning) => (
              <div
                key={warning}
                style={{
                  fontSize: 11,
                  lineHeight: 1.7,
                  color: "var(--text-secondary)",
                }}
              >
                {warning}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <ResultSection
        title="我的号概况"
        items={[
          `近 30 篇文章数：${report.summary.article_count_30d}`,
          `平均阅读：${report.summary.avg_read}`,
          `当前最强文章：${report.summary.best_article_title || "暂无"}`,
          `发文节奏：${report.content_overview.posting_pattern}`,
        ]}
      />

      <ResultSection
        title="最近高表现内容"
        items={report.top_articles.map(
          (item) => `${item.title}｜阅读 ${item.read_num}${item.reason ? `｜${item.reason}` : ""}`
        )}
      />

      <ResultSection
        title="自己 vs 对标"
        lead={report.competitor_gap.overview}
        items={[
          ...report.competitor_gap.topic_gap.map((item) => `选题差距：${item}`),
          ...report.competitor_gap.title_gap.map((item) => `标题差距：${item}`),
          ...report.competitor_gap.structure_gap.map((item) => `结构差距：${item}`),
        ]}
      />

      <ResultSection
        title="下一步建议"
        items={report.next_actions}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onBack} style={ghostBtnStyle}>重新分析</button>
        <button onClick={onSend} style={primaryBtnStyle}>发送到对话 →</button>
      </div>
    </div>
  );
}

function ResultSection({
  title,
  lead,
  items,
}: {
  title: string;
  lead?: string;
  items: string[];
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-base)",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ ...statusValueStyle, marginBottom: 10 }}>{title}</div>
      {lead ? (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.75, marginBottom: 10 }}>
          {lead}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <div
            key={item}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12,
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                marginTop: 8,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublishStatusCard({
  configured,
  appId,
}: {
  configured: boolean;
  appId: string;
}) {
  return (
    <div
      style={{
        ...statusCardStyle,
        background: configured ? "var(--accent-glow)" : "var(--bg-base)",
        border: configured
          ? "1px solid rgba(200,150,90,0.18)"
          : "1px solid var(--border)",
      }}
    >
      <div style={statusTitleStyle}>
        {configured ? "自动发布状态" : "自动发布状态"}
      </div>
      <div style={statusValueStyle}>
        {configured ? "已配置官方发布能力" : "暂未配置官方发布能力"}
      </div>
      <div style={statusHintStyle}>
        {configured
          ? `当前已绑定 AppID：${appId}。增长分析会优先导入你的公众号内容，再尽量补官方表现数据；后续排版完成后也可以继续走官方 API 保存草稿。`
          : "这不影响内容分析。增长分析会优先按公众号名称导入你的内容；如果补充 AppID 和 AppSecret，会尽量增强官方表现数据。"}
      </div>
    </div>
  );
}

function AnalysisCapabilityList() {
  return (
    <>
      <div style={labelStyle}>将为你分析</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {[
          "自动导入你自己的公众号内容，和竞品内容分开分析",
          "优先分析标题、选题、结构上的稳定规律",
          "尽量补官方表现数据，失败也不影响内容分析",
          "输出自己 vs 对标差距与 3 条可执行建议",
        ].map((item) => (
          <div
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            {item}
          </div>
        ))}
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  outline: "none",
};

const placeholderWrapStyle: React.CSSProperties = {
  minHeight: 220,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-secondary)",
  fontSize: 13,
};

const statusCardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  marginBottom: 20,
};

const statusTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const statusValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-primary)",
  fontWeight: 600,
  marginBottom: 6,
};

const statusHintStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.65,
  color: "var(--text-secondary)",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-secondary)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "var(--accent)",
  border: "none",
  borderRadius: 6,
  color: "var(--bg-void)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  fontWeight: 500,
};
