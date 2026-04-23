"use client";

import { useState, useEffect } from "react";

interface KOCAccount {
  name: string;
  biz: string;
  owner_name: string;
  ghid: string;
  wxid: string;
  fans: number;
  avg_top_read: number;
  avg_top_like: number;
  avatar: string;
}

interface Props {
  journeyId: string;
  keywords: string[];
  onImportComplete: (conversationId: string) => void;
  onSkip: () => void;
}

export default function KOCRecommendationModal({ journeyId, keywords, onImportComplete, onSkip }: Props) {
  const [stage, setStage] = useState<"searching" | "selecting" | "importing" | "done">("searching");
  const [kocList, setKocList] = useState<KOCAccount[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Search for KOCs on load
  useEffect(() => {
    async function search() {
      try {
        const searchKeyword = keywords.find(k => k.length > 0) || "内容创作";
        const res = await fetch(`/api/koc?journey_id=${journeyId}&keyword=${encodeURIComponent(searchKeyword)}`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setKocList(data);
        setStage("selecting");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setStage("selecting");
      }
    }
    search();
  }, [journeyId, keywords]);

  const toggleSelect = (ghid: string) => {
    setSelected(prev =>
      prev.includes(ghid) ? prev.filter(id => id !== ghid) : [...prev, ghid]
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
      for (let i = 0; i < selected.length; i++) {
        const ghid = selected[i];
        const res = await fetch(`/api/koc/${ghid}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journey_id: journeyId }),
        });
        if (!res.ok) throw new Error("Import failed");
        setImportProgress({ current: i + 1, total: selected.length });
      }
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStage("done");
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
            Niche 会持续监控这些账号的内容，帮你发现爆款选题和创作规律
          </p>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {stage === "searching" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ marginBottom: 16 }}>正在搜索 {keywords.join(" / ")} 相关账号...</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>基于大佳拉 API</div>
            </div>
          )}

          {stage === "selecting" && (
            <>
              {error && (
                <div style={{
                  background: "rgba(255,100,100,0.1)",
                  border: "1px solid rgba(255,100,100,0.3)",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {kocList.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-tertiary)", fontSize: 12 }}>
                    暂未找到相关账号，可稍后在 KOC 管理页手动添加
                  </div>
                ) : (
                  kocList.map((koc) => (
                    <div
                      key={koc.ghid}
                      onClick={() => toggleSelect(koc.ghid)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: 12,
                        background: selected.includes(koc.ghid) ? "var(--accent-glow)" : "var(--bg-base)",
                        border: `1px solid ${selected.includes(koc.ghid) ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {koc.avatar ? (
                        <img src={koc.avatar} alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--border)" }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
                          {koc.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 12 }}>
                          <span>粉丝 {formatNum(koc.fans)}</span>
                          <span>平均在看 {formatNum(koc.avg_top_like)}</span>
                          <span>平均阅读 {formatNum(koc.avg_top_read)}</span>
                        </div>
                      </div>
                      <div style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        border: `2px solid ${selected.includes(koc.ghid) ? "var(--accent)" : "var(--border)"}`,
                        background: selected.includes(koc.ghid) ? "var(--accent)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--bg-void)",
                        fontSize: 12,
                      }}>
                        {selected.includes(koc.ghid) && "✓"}
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
                disabled={selected.length === 0 && kocList.length > 0}
                style={{
                  padding: "10px 20px",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--bg-void)",
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: selected.length === 0 && kocList.length > 0 ? "not-allowed" : "pointer",
                  opacity: selected.length === 0 && kocList.length > 0 ? 0.5 : 1,
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
