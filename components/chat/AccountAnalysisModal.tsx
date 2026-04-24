"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

interface Props {
  journeyId: string;
  conversationId: string;
  onClose: () => void;
  onResult: (message: string) => void;
}

type ConfigState = "checking" | "needs_config" | "ready" | "running" | "done";

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

export function AccountAnalysisModal({ journeyId, onClose, onResult }: Props) {
  const [state, setState] = useState<ConfigState>("checking");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [runningStep, setRunningStep] = useState("正在连接公众号...");
  const [report, setReport] = useState<AnalysisReport | null>(null);

  const canSubmitConfig = appId.trim() && appSecret.trim();

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const res = await fetch("/api/wechat/config");
        const data = await res.json();
        if (cancelled) return;

        if (res.ok && data.config?.app_id) {
          setAppId(data.config.app_id);
          setState("ready");
          return;
        }

        setState("needs_config");
      } catch {
        if (!cancelled) {
          setState("needs_config");
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== "running") return;

    const steps = [
      "正在连接公众号...",
      "正在拉取已发布文章...",
      "正在同步近期表现数据...",
      "正在生成复盘分析...",
    ];

    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, steps.length - 1);
      setRunningStep(steps[index]);
    }, 1400);

    return () => window.clearInterval(timer);
  }, [state]);

  const headerTitle = useMemo(() => {
    if (state === "needs_config") return "绑定你的公众号";
    if (state === "done") return "公众号复盘结果";
    return "分析已绑定公众号";
  }, [state]);

  async function handleRunAnalysis() {
    setRunningStep("正在连接公众号...");
    setState("running");
    try {
      const res = await fetch("/api/wechat/owned-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: journeyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "公众号分析失败");
      }

      setReport(data.report);
      setState("done");
      toast.success(`已完成公众号复盘，已同步 ${data.article_count ?? 0} 篇文章。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "公众号分析失败");
      setState(appId.trim() ? "ready" : "needs_config");
    }
  }

  async function handleSaveAndAnalyze() {
    try {
      const res = await fetch("/api/wechat/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId.trim(),
          app_secret: appSecret.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "公众号配置保存失败");
      }

      setAppSecret("");
      toast.success("公众号配置已保存。");
      await handleRunAnalysis();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "公众号配置保存失败");
      setState("needs_config");
    }
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
          maxWidth: 440,
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          overflow: "hidden",
          margin: "0 20px",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            {headerTitle}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
            {state === "needs_config"
              ? "先绑定 AppID 和 AppSecret，后面就能直接自动同步和分析。"
              : "AI 会同步最近已发布文章和近期表现数据，并和当前赛道 KOC 进行横向对比。"}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>
          {state === "checking" && (
            <div style={placeholderWrapStyle}>正在检查公众号配置...</div>
          )}

          {state === "needs_config" && (
            <>
              <div style={labelStyle}>AppID</div>
              <input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="输入公众号 AppID"
                autoFocus
                style={inputStyle}
              />
              <div style={labelStyle}>AppSecret</div>
              <input
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="输入公众号 AppSecret"
                style={{ ...inputStyle, marginBottom: 20 }}
              />
              <AnalysisCapabilityList />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose} style={ghostBtnStyle}>取消</button>
                <button
                  onClick={handleSaveAndAnalyze}
                  disabled={!canSubmitConfig}
                  style={{ ...primaryBtnStyle, opacity: canSubmitConfig ? 1 : 0.4, cursor: canSubmitConfig ? "pointer" : "not-allowed" }}
                >
                  保存并开始分析 →
                </button>
              </div>
            </>
          )}

          {state === "ready" && (
            <>
              <div style={statusCardStyle}>
                <div style={statusTitleStyle}>已检测到公众号配置</div>
                <div style={statusValueStyle}>{appId}</div>
              </div>
              <AnalysisCapabilityList />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose} style={ghostBtnStyle}>取消</button>
                <button onClick={handleRunAnalysis} style={primaryBtnStyle}>
                  开始同步并分析 →
                </button>
              </div>
            </>
          )}

          {state === "running" && (
            <div style={runningWrapStyle}>
              <div style={runningStepStyle}>{runningStep}</div>
              <div style={runningHintStyle}>这一步会自动拉取你最近的已发布文章，并结合当前赛道竞品一起生成复盘结果。</div>
            </div>
          )}

          {state === "done" && report && (
            <>
              <div style={reportSectionStyle}>
                <div style={reportTitleStyle}>整体概况</div>
                <div style={reportTextStyle}>
                  近 30 篇文章 <strong>{report.summary.article_count_30d}</strong> 篇，平均阅读 <strong>{report.summary.avg_read}</strong>，当前最强文章是 <strong>{report.summary.best_article_title || "暂无"}</strong>。
                </div>
              </div>

              <div style={reportSectionStyle}>
                <div style={reportTitleStyle}>内容概况</div>
                <div style={reportTextStyle}>{report.content_overview.posting_pattern}</div>
                <div style={reportTextStyle}>{report.content_overview.title_pattern}</div>
                {report.content_overview.best_topics.length > 0 && (
                  <div style={reportTextStyle}>高表现主题：{report.content_overview.best_topics.join("、")}</div>
                )}
              </div>

              <div style={reportSectionStyle}>
                <div style={reportTitleStyle}>表现最好的文章</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {report.top_articles.map((article) => (
                    <div key={article.title} style={reportCardStyle}>
                      <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{article.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                        阅读 {article.read_num} · {article.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={reportSectionStyle}>
                <div style={reportTitleStyle}>我和竞品的差距</div>
                <div style={reportTextStyle}>{report.competitor_gap.overview}</div>
                <ReportList title="选题差距" items={report.competitor_gap.topic_gap} />
                <ReportList title="标题差距" items={report.competitor_gap.title_gap} />
                <ReportList title="结构差距" items={report.competitor_gap.structure_gap} />
              </div>

              <div style={reportSectionStyle}>
                <div style={reportTitleStyle}>下一步建议</div>
                <ReportList title="" items={report.next_actions} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                <button onClick={onClose} style={ghostBtnStyle}>关闭</button>
                <button onClick={() => onResult(report.message_for_chat)} style={primaryBtnStyle}>
                  发送到对话 →
                </button>
              </div>
            </>
          )}
        </div>
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
          "自动同步最近已发布文章与近期表现数据",
          "找出表现最好的内容和高表现主题",
          "与当前赛道 KOC 做横向对比",
          "输出 3 条具体可执行的改进建议",
        ].map((item) => (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
            {item}
          </div>
        ))}
      </div>
    </>
  );
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <div style={{ marginTop: 10 }}>
      {title ? <div style={miniLabelStyle}>{title}</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => (
          <div key={item} style={reportBulletStyle}>
            <span style={bulletDotStyle} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
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
  marginBottom: 20,
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
  border: "1px solid rgba(200,150,90,0.18)",
  background: "var(--accent-glow)",
  marginBottom: 20,
};

const statusTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const statusValueStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--accent)",
};

const runningWrapStyle: React.CSSProperties = {
  minHeight: 260,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: 12,
};

const runningStepStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 20,
  color: "var(--text-primary)",
};

const runningHintStyle: React.CSSProperties = {
  maxWidth: 320,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
};

const reportSectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const reportTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--accent)",
  marginBottom: 8,
};

const reportTextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const reportCardStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
};

const miniLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-tertiary)",
  marginBottom: 6,
};

const reportBulletStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const bulletDotStyle: React.CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--accent)",
  flexShrink: 0,
  marginTop: 7,
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
