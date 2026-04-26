"use client";

import { useState, useEffect } from "react";
import type { WechatDashboardData } from "@/lib/data";

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function DashboardPanel({ journeyId }: { journeyId: string }) {
  const [data, setData] = useState<WechatDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/wechat/dashboard?journey_id=${journeyId}`)
      .then((res) => res.json())
      .then((d: WechatDashboardData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [journeyId]);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-void)",
        padding: "10px 12px",
      }}
    >
      {loading ? (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", padding: "4px 0" }}>
          加载中...
        </div>
      ) : !data ? (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", padding: "4px 0" }}>
          暂无数据复盘
        </div>
      ) : (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
              {data.account.name}
            </span>
            <span style={tagStyle}>数据复盘</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Stat label="总文章" val={String(data.summary.article_count)} />
            <Stat label="均阅读" val={fmtCount(data.summary.avg_reads)} />
            <Stat label="最高阅读" val={fmtCount(data.summary.peak_reads)} />
          </div>
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

const tagStyle: React.CSSProperties = {
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
