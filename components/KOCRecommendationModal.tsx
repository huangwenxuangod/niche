"use client";

import { useState, useEffect } from "react";
import { toast } from "@/lib/toast";

interface HotArticle {
  url: string;
  mp_nickname: string;
  title: string;
  pub_time: string;
  wxid: string;
  hot: number;
  read_num: number;
  fans: number;
}

interface Props {
  journeyId: string;
  keywords: string[];
  onImportComplete: (conversationId: string) => void;
  onSkip: () => void;
}

export default function KOCRecommendationModal({ journeyId, onImportComplete, onSkip }: Props) {
  const [stage, setStage] = useState<"searching" | "selecting" | "importing" | "done">("searching");
  const [articleList, setArticleList] = useState<HotArticle[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Search for hot articles on load
  useEffect(() => {
    async function search() {
      try {
        const res = await fetch(`/api/journeys/${journeyId}/hot-articles`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setArticleList(data.articles || []);
        setStage("selecting");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "搜索失败");
        setStage("selecting");
      }
    }
    search();
  }, [journeyId]);

  const toggleSelect = (wxid: string) => {
    setSelected(prev =>
      prev.includes(wxid) ? prev.filter(id => id !== wxid) : [...prev, wxid]
    );
  };

  const startImport = async () => {
    if (selected.length === 0) {
      handleSkipImport();
      return;
    }
    setStage("importing");
    setImportProgress({ current: 0, total: selected.length });

    try {
      // 并行发起所有导入请求，但不等待全部完成
      const importPromises = selected.map(async (wxid, index) => {
        try {
          await fetch(`/api/koc/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ journey_id: journeyId, input: wxid }),
          });
        } catch {
          // 忽略单个导入失败
        }
        setImportProgress({ current: index + 1, total: selected.length });
      });

      // 立即调用完成回调，让用户继续使用
      setTimeout(() => {
        handleDone();
      }, 500);

      // 后台继续执行导入
      await Promise.all(importPromises);
    } catch {
      // 即使出错也让用户继续
      setTimeout(() => {
        handleDone();
      }, 500);
    }
  };

  const handleSkipImport = async () => {
    const res = await fetch(`/api/journeys/${journeyId}/create-conversation`, { method: "POST" });
    const data = await res.json();
    onImportComplete(data.conversation_id);
  };

  const handleDone = async () => {
    const res = await fetch(`/api/journeys/${journeyId}/create-conversation`, { method: "POST" });
    const data = await res.json();
    onImportComplete(data.conversation_id);
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        width: "100%",
        maxWidth: 600,
        maxHeight: "80vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "24px 24px 0", borderBottom: stage === "selecting" ? "1px solid var(--border)" : "none" }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 8,
          }}>
            步骤 3/3：添加对标 KOC
          </div>
          <h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 400,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}>
            选择想要追踪的账号
          </h2>
          <p style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            marginBottom: 0,
          }}>
            基于最近7天的赛道爆文，Niche 会持续监控这些账号的内容
          </p>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {stage === "searching" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ marginBottom: 16 }}>正在搜索赛道热点与爆文...</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>基于 Tavily + 大佳拉 API</div>
            </div>
          )}

          {stage === "selecting" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {articleList.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-tertiary)", fontSize: 12 }}>
                    暂未找到相关爆文，可稍后在 KOC 管理页手动添加
                  </div>
                ) : (
                  articleList.map((article) => (
                    <div
                      key={article.wxid}
                      onClick={() => toggleSelect(article.wxid)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: 12,
                        background: selected.includes(article.wxid) ? "var(--accent-glow)" : "var(--bg-base)",
                        border: `1px solid ${selected.includes(article.wxid) ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.4 }}>
                          {article.title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>公众号：{article.mp_nickname}</span>
                          <span>粉丝：{formatNum(article.fans)}</span>
                          <span>阅读：{formatNum(article.read_num)}</span>
                          <span>{article.pub_time.split(" ")[0]}</span>
                        </div>
                      </div>
                      <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        border: `2px solid ${selected.includes(article.wxid) ? "var(--accent)" : "var(--border)"}`,
                        background: selected.includes(article.wxid) ? "var(--accent)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--bg-void)",
                        fontSize: 12,
                        flexShrink: 0,
                        marginTop: 2,
                      }}>
                        {selected.includes(article.wxid) && "✓"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {stage === "importing" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ marginBottom: 16 }}>正在导入账号并抓取文章...</div>
              <div style={{ fontSize: 32, fontFamily: "var(--font-display)", marginBottom: 8 }}>
                {importProgress.current} / {importProgress.total}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>后台同步中，不会让你等太久</div>
            </div>
          )}

          {stage === "done" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <div style={{ marginBottom: 8 }}>初始化完成！</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                已添加 {importProgress.total} 个对标账号到知识库
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 24px 24px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}>
          {stage === "selecting" && (
            <>
              <button
                onClick={onSkip}
                style={{
                  padding: "10px 16px",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                稍后再添加
              </button>
              <button
                onClick={startImport}
                disabled={selected.length === 0 && articleList.length > 0}
                style={{
                  padding: "10px 20px",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--bg-void)",
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: selected.length === 0 && articleList.length > 0 ? "not-allowed" : "pointer",
                  opacity: selected.length === 0 && articleList.length > 0 ? 0.5 : 1,
                }}
              >
                {selected.length > 0 ? `导入 ${selected.length} 个账号` : "开始使用"}
              </button>
            </>
          )}
          {stage === "done" && (
            <button
              onClick={handleDone}
              style={{
                flex: 1,
                padding: "10px 20px",
                background: "var(--accent)",
                border: "none",
                borderRadius: 6,
                color: "var(--bg-void)",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              进入对话
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}
