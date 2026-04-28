"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { KOCSource } from "@/lib/data";
import { toast } from "@/lib/toast";

type WxvideoSourceRow = {
  id: string;
  linked_koc_source_id: string | null;
  account_name: string | null;
  v2_name: string;
  feed_count: number | null;
  avg_like_count: number | null;
  max_like_count: number | null;
  last_fetched_at: string | null;
};

type KocListRow = KOCSource & {
  fans_count?: number;
  avatar_url?: string;
  ghid?: string;
  wxvideo?: WxvideoSourceRow | null;
};

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}

export default function KocPage() {
  const { id: journeyId } = useParams() as { id: string };
  const router = useRouter();
  const [kocs, setKocs] = useState<KocListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncingWxvideo, setSyncingWxvideo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [input, setInput] = useState("");
  const supabase = createClient();

  const fetchKocs = useCallback(async () => {
    const [{ data: kocData }, { data: wxvideoData }] = await Promise.all([
      supabase
        .from("koc_sources")
        .select("*")
        .eq("journey_id", journeyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("wxvideo_sources")
        .select(
          "id, linked_koc_source_id, account_name, v2_name, feed_count, avg_like_count, max_like_count, last_fetched_at"
        )
        .eq("journey_id", journeyId),
    ]);

    const wxvideoByKocId = new Map(
      (wxvideoData ?? []).map((item) => [item.linked_koc_source_id, item as WxvideoSourceRow])
    );

    setKocs(
      (kocData ?? []).map((koc) => ({
        ...(koc as KocListRow),
        wxvideo: wxvideoByKocId.get(koc.id) ?? null,
      }))
    );
    setLoading(false);
  }, [journeyId, supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchKocs();
    });
  }, [fetchKocs]);

  async function syncArticles(kocId: string) {
    setSyncing(kocId);
    try {
      const res = await fetch(`/api/koc/${kocId}/sync`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        await fetchKocs();
        toast.success(`同步完成，更新 ${data.articleCount ?? 0} 篇文章。`);
      } else {
        const data = await res.json();
        throw new Error(data.error || "同步失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败");
    }
    setSyncing(null);
  }

  async function deleteKOC(id: string) {
    await supabase.from("koc_sources").delete().eq("id", id);
    setKocs((prev) => prev.filter((k) => k.id !== id));
  }

  async function syncBoundWxvideo(kocId: string) {
    setSyncingWxvideo(kocId);
    try {
      const res = await fetch(`/api/koc/${kocId}/import-bound-wxvideo`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "同步视频号失败");
      }

      await fetchKocs();

      if (data.bound === false) {
        toast("这个公众号暂时没有识别到绑定视频号。");
      } else {
        toast.success(`视频号同步完成，已导入 ${data.importedCount ?? 0} 条作品样本。`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步视频号失败");
    } finally {
      setSyncingWxvideo(null);
    }
  }

  async function importKOC() {
    if (!input.trim()) return;
    setImporting(true);
    try {
      const res = await fetch("/api/koc/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: journeyId,
          input: input.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setInput("");
        // 后台导入，立即刷新列表，不等待完成
        fetchKocs();
        // 稍后再刷新一次以获取更新后的数据
        setTimeout(fetchKocs, 2000);
        toast.success(`导入成功，已加入 ${data.account?.name || "公众号"}。`);
      } else {
        const data = await res.json();
        toast.error(data.error || "导入失败");
      }
    } catch {
      toast.error("导入失败");
    }
    setImporting(false);
  }

  return (
    <div style={{ height: "100%", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>←</button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, color: "var(--text-primary)" }}>对标账号管理</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>持续补充你的对标内容库，用来做增长分析与内容生成</div>
        </div>
      </div>

      {/* Add benchmark accounts section */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && importKOC()}
            placeholder="输入对标公众号名称 / ghid / 文章链接"
            style={{
              flex: 1,
              minWidth: 200,
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
            onClick={importKOC}
            disabled={importing}
            style={{
              padding: "12px 24px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "var(--bg-void)",
              fontSize: 13,
              fontWeight: 500,
              cursor: importing ? "not-allowed" : "pointer",
            }}
          >
            {importing ? "导入中..." : "导入对标账号"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
          支持输入：公众号名称（如「产品思维」）、ghid（如 gh_xxxxxx）、或任意文章链接
        </div>
      </div>

      {/* KOC list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "40px 0" }}>加载中...</div>
        ) : kocs.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, marginBottom: 8 }}>还没有导入任何对标账号</div>
            <div style={{ fontSize: 12 }}>先补一批同赛道样本，后面分析和生成都会更稳</div>
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
                    <Image
                      src={k.avatar_url}
                      alt=""
                      width={44}
                      height={44}
                      unoptimized
                      style={{ width: 44, height: 44, borderRadius: "50%" }}
                    />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--border)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                        {k.account_name || k.account_id || "未命名"}
                      </span>
                      {k.is_manually_added && (
                        <span style={manualTagStyle}>已导入</span>
                      )}
                      {k.wxvideo ? (
                        <span style={wxvideoTagStyle}>已绑定视频号</span>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      {k.fans_count !== undefined && <Stat label="粉丝数" val={fmtCount(k.fans_count)} />}
                      <Stat label="最高阅读" val={fmtCount(k.max_read_count)} />
                      <Stat label="平均阅读" val={fmtCount(k.avg_read_count)} />
                      <Stat label="文章数" val={String(k.article_count ?? 0)} />
                      {k.wxvideo ? (
                        <>
                          <Stat label="视频号样本" val={String(k.wxvideo.feed_count ?? 0)} />
                          <Stat label="视频最高喜欢" val={fmtCount(k.wxvideo.max_like_count ?? 0)} />
                        </>
                      ) : null}
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
                    {k.wxvideo ? (
                      <div style={wxvideoHintStyle}>
                        已发现绑定视频号「{k.wxvideo.account_name || k.wxvideo.v2_name}」
                        {k.wxvideo.last_fetched_at
                          ? `，最近同步于 ${new Date(k.wxvideo.last_fetched_at).toLocaleDateString()}`
                          : ""}
                      </div>
                    ) : (
                      <div style={wxvideoHintStyle}>
                        还没有识别到绑定视频号，可以手动触发一次发现与同步。
                      </div>
                    )}
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
                    {syncing === k.id ? "同步中..." : "同步内容"}
                  </button>
                  <button
                    onClick={() => syncBoundWxvideo(k.id)}
                    disabled={syncing !== null || syncingWxvideo !== null}
                    style={{
                      ...deleteBtnStyle,
                      borderColor: "rgba(90, 154, 123, 0.28)",
                      color: "#5a9a7b",
                    }}
                  >
                    {syncingWxvideo === k.id ? "同步中..." : k.wxvideo ? "刷新视频号" : "发现视频号"}
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

const wxvideoTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "3px 8px",
  borderRadius: 4,
  background: "rgba(90,154,123,0.12)",
  color: "#5a9a7b",
  border: "1px solid rgba(90,154,123,0.28)",
};

const wxvideoHintStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 11,
  color: "var(--text-tertiary)",
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
