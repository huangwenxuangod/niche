"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { KOCSource } from "@/lib/data";

interface SearchResult {
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

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}

export default function KocPage() {
  const { id: journeyId } = useParams() as { id: string };
  const router = useRouter();
  const [kocs, setKocs] = useState<(KOCSource & { fans_count?: number; avatar_url?: string; ghid?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [ghidInput, setGhidInput] = useState("");
  const [accountNameInput, setAccountNameInput] = useState("");
  const supabase = createClient();

  useEffect(() => {
    fetchKocs();
  }, [journeyId]);

  async function fetchKocs() {
    const { data } = await supabase
      .from("koc_sources")
      .select("*")
      .eq("journey_id", journeyId)
      .order("created_at", { ascending: false });
    setKocs(data ?? []);
    setLoading(false);
  }

  async function addKOC() {
    if (!ghidInput.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/koc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: journeyId,
          ghid: ghidInput.trim(),
          account_name: accountNameInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.id) {
        setKocs((prev) => [data, ...prev]);
        setGhidInput("");
        setAccountNameInput("");
      }
    } catch (err) {
      console.error("Add KOC failed:", err);
    }
    setAdding(false);
  }

  async function syncArticles(kocId: string) {
    setSyncing(kocId);
    try {
      const res = await fetch(`/api/koc/${kocId}/sync`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchKocs();
      }
    } catch (err) {
      console.error("Sync failed:", err);
    }
    setSyncing(null);
  }

  async function deleteKOC(id: string) {
    await supabase.from("koc_sources").delete().eq("id", id);
    setKocs((prev) => prev.filter((k) => k.id !== id));
  }

  async function searchKOCs() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/koc?journey_id=${journeyId}&keyword=${encodeURIComponent(searchQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (err) {
      console.error("Search failed:", err);
    }
    setSearching(false);
  }

  async function importKOC(ghid: string) {
    setImporting(ghid);
    try {
      const res = await fetch(`/api/koc/${ghid}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: journeyId }),
      });
      if (res.ok) {
        await fetchKocs();
        setSearchResults(prev => prev.filter(r => r.ghid !== ghid));
      }
    } catch (err) {
      console.error("Import failed:", err);
    }
    setImporting(null);
  }

  return (
    <div style={{ height: "100%", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>←</button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, color: "var(--text-primary)" }}>KOC 管理</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>手动管理竞品公众号</div>
        </div>
      </div>

      {/* Search section */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchKOCs()}
            placeholder="输入公众号名称，如「产品思维」"
            style={{
              flex: 1,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--text-primary)",
              outline: "none",
              fontFamily: "var(--font-body)",
            }}
          />
          <button
            onClick={searchKOCs}
            disabled={searching}
            style={{
              padding: "12px 24px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "var(--bg-void)",
              fontSize: 13,
              fontWeight: 500,
              cursor: searching ? "not-allowed" : "pointer",
            }}
          >
            {searching ? "搜索中..." : "搜索并导入"}
          </button>
        </div>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 12 }}>搜索结果</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {searchResults.map((result) => {
              const alreadyAdded = kocs.some(k => k.ghid === result.ghid || k.account_id === result.ghid);
              return (
                <div
                  key={result.ghid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 12,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  {result.avatar ? (
                    <img src={result.avatar} alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--border)" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
                      {result.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 16 }}>
                      <span>粉丝 {fmtCount(result.fans)}</span>
                      <span>平均阅读 {fmtCount(result.avg_top_read)}</span>
                      <span>平均在看 {fmtCount(result.avg_top_like)}</span>
                    </div>
                  </div>
                  {alreadyAdded ? (
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "6px 12px" }}>已添加</span>
                  ) : (
                    <button
                      onClick={() => importKOC(result.ghid)}
                      disabled={importing === result.ghid}
                      style={{
                        padding: "8px 16px",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 6,
                        color: "var(--bg-void)",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: importing === result.ghid ? "not-allowed" : "pointer",
                      }}
                    >
                      {importing === result.ghid ? "导入中..." : "导入"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KOC list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "40px 0" }}>加载中...</div>
        ) : kocs.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, marginBottom: 8 }}>还没有追踪任何 KOC</div>
            <div style={{ fontSize: 12 }}>在上方搜索关键词添加对标账号</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {kocs.map((k) => (
              <div
                key={k.id}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                  {k.avatar_url ? (
                    <img src={k.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: "50%" }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--border)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                        {k.account_name || k.account_id || "未命名"}
                      </span>
                      {k.is_manually_added && (
                        <span style={manualTagStyle}>手动添加</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      {k.fans_count !== undefined && <Stat label="粉丝数" val={fmtCount(k.fans_count)} />}
                      <Stat label="最高阅读" val={fmtCount(k.max_read_count)} />
                      <Stat label="平均阅读" val={fmtCount(k.avg_read_count)} />
                      <Stat label="文章数" val={String(k.article_count ?? 0)} />
                      {k.last_fetched_at && (
                        <div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                            最后同步
                          </div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                            {new Date(k.last_fetched_at).toLocaleDateString()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => syncArticles(k.id)}
                    disabled={syncing !== null}
                    style={{
                      ...deleteBtnStyle,
                      borderColor: "rgba(200, 150, 90, 0.3)",
                      color: "var(--accent)",
                    }}
                  >
                    {syncing === k.id ? "同步中..." : "同步文章"}
                  </button>
                  <button onClick={() => deleteKOC(k.id)} disabled={syncing !== null} style={deleteBtnStyle}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
        {val}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

const manualTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "3px 8px",
  borderRadius: 4,
  background: "var(--accent-dim)",
  color: "var(--accent)",
  border: "1px solid rgba(200,150,90,0.3)",
};

const deleteBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(244,67,54,0.25)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  color: "#f44336",
  cursor: "pointer",
};
