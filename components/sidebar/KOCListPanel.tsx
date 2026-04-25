"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KOCSource } from "@/lib/data";

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function KOCListPanel({ journeyId }: { journeyId: string }) {
  const [kocs, setKocs] = useState<KOCSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from("koc_sources")
      .select("*")
      .eq("journey_id", journeyId)
      .order("max_read_count", { ascending: false })
      .then(({ data }: { data: KOCSource[] | null }) => {
        setKocs(data ?? []);
        setLoading(false);
      });
  }, [journeyId, supabase]);

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

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-void)",
        padding: "10px 12px",
      }}
    >
      {/* Add input */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKOC()}
          placeholder="输入对标公众号名称或文章 URL"
          style={{
            flex: 1,
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "5px 8px",
            fontSize: 11,
            color: "var(--text-primary)",
            outline: "none",
            fontFamily: "var(--font-body)",
          }}
        />
        <button
          onClick={addKOC}
          disabled={adding}
          style={{
            padding: "0 8px",
            background: "var(--accent-dim)",
            border: "1px solid rgba(200,150,90,0.25)",
            borderRadius: 4,
            color: "var(--accent)",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          {adding ? "..." : "+ 导入"}
        </button>
      </div>

      <div
        style={{
          fontSize: 10,
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-body)",
          lineHeight: 1.6,
          marginBottom: 8,
        }}
      >
        当前每个对标账号默认同步最近 3 篇文章，用于快速建立样本。
      </div>

      {/* KOC list */}
      {loading ? (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", padding: "4px 0" }}>
          加载中...
        </div>
      ) : kocs.length === 0 ? (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", padding: "4px 0" }}>
          导入对标账号后会在这里持续沉淀样本
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {kocs.map((k) => (
            <div
              key={k.id}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  {k.account_name}
                </span>
                {k.is_manually_added && <span style={manualTagStyle}>导入</span>}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Stat label="最高" val={fmtCount(k.max_read_count)} />
                <Stat label="均值" val={fmtCount(k.avg_read_count)} />
                <Stat label="文章" val={String(k.article_count)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--text-primary)" }}>
        {val}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        {label}
      </div>
    </div>
  );
}

const manualTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "2px 5px",
  borderRadius: 3,
  background: "var(--accent-dim)",
  color: "var(--accent)",
  border: "1px solid rgba(200,150,90,0.3)",
};
