"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { KOCSource } from "@/lib/data";

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function KocPage() {
  const { id: journeyId } = useParams() as { id: string };
  const router = useRouter();
  const [kocs, setKocs] = useState<KOCSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const supabase = createClient();

  useEffect(() => {
    fetchKocs();
  }, [journeyId]);

  async function fetchKocs() {
    const { data } = await supabase
      .from("koc_sources")
      .select("*")
      .eq("journey_id", journeyId)
      .order("max_read_count", { ascending: false });
    setKocs(data ?? []);
    setLoading(false);
  }

  async function addKOC() {
    if (!input.trim()) return;
    setAdding(true);
    const res = await fetch("/api/koc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journey_id: journeyId, account_name: input.trim() }),
    });
    const data = await res.json();
    if (data.id) {
      setKocs((prev) => [data, ...prev]);
      setInput("");
    }
    setAdding(false);
  }

  async function deleteKOC(id: string) {
    await supabase.from("koc_sources").delete().eq("id", id);
    setKocs((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div style={{ height: "100%", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>←</button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, color: "var(--text-primary)" }}>KOC 管理</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>追踪的公众号列表</div>
        </div>
      </div>

      {/* Add input */}
      <div style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKOC()}
            placeholder="输入公众号名称或文章链接来添加 KOC"
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
            onClick={addKOC}
            disabled={adding}
            style={{
              padding: "12px 24px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              color: "var(--bg-void)",
              fontSize: 13,
              fontWeight: 500,
              cursor: adding ? "not-allowed" : "pointer",
            }}
          >
            {adding ? "添加中..." : "+ 添加"}
          </button>
        </div>
      </div>

      {/* KOC list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "40px 0" }}>加载中...</div>
        ) : kocs.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, marginBottom: 8 }}>还没有追踪任何 KOC</div>
            <div style={{ fontSize: 12 }}>在上方输入公众号名称来添加，或等待知识库初始化完成</div>
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
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                      {k.account_name}
                    </span>
                    {k.is_manually_added && (
                      <span style={manualTagStyle}>手动添加</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <Stat label="最高阅读" val={fmtCount(k.max_read_count)} />
                    <Stat label="平均阅读" val={fmtCount(k.avg_read_count)} />
                    <Stat label="文章数" val={String(k.article_count)} />
                  </div>
                </div>
                <button onClick={() => deleteKOC(k.id)} style={deleteBtnStyle}>
                  删除
                </button>
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
