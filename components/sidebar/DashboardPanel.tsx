"use client";

import { useState, useEffect } from "react";
import type { WechatDashboardData } from "@/lib/data";
import { toast } from "@/lib/toast";

type DashboardResponse =
  | ({
      configured: false;
      account_name: string;
    })
  | ({
      configured: true;
      account_name: string;
    } & WechatDashboardData);

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function DashboardPanel({ journeyId }: { journeyId: string }) {
  const [data, setData] = useState<WechatDashboardData | null>(null);
  const [configured, setConfigured] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!journeyId) {
      setLoading(false);
      return;
    }
    fetch(`/api/wechat/dashboard?journey_id=${journeyId}`)
      .then((res) => res.json())
      .then((d: DashboardResponse) => {
        if (!d.configured) {
          setConfigured(false);
          setAccountName(d.account_name || "");
          setData(null);
          setLoading(false);
          return;
        }

        setConfigured(true);
        setAccountName(d.account_name || "");
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [journeyId]);

  async function saveAccountName() {
    if (!accountName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/wechat/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: journeyId,
          account_name: accountName.trim(),
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(typeof payload?.error === "string" ? payload.error : "保存失败");
      }

      const refreshed = await fetch(`/api/wechat/dashboard?journey_id=${journeyId}`).then((r) =>
        r.json()
      ) as DashboardResponse;

      if (refreshed.configured) {
        setConfigured(true);
        setData(refreshed);
      }
      toast.success("公众号已配置");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
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
      {loading ? (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", padding: "4px 0" }}>
          加载中...
        </div>
      ) : !configured ? (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", marginBottom: 6 }}>
            先配置你的公众号
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", lineHeight: 1.6, marginBottom: 10 }}>
            填入你的公众号名称，后续这里会持续沉淀你的内容表现，帮你看到哪些表达真正有效。
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveAccountName()}
              placeholder="输入你的公众号名称"
              style={{
                flex: 1,
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 8px",
                fontSize: 11,
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "var(--font-body)",
              }}
            />
            <button
              onClick={saveAccountName}
              disabled={saving || !accountName.trim()}
              style={{
                padding: "0 10px",
                background: "var(--accent-dim)",
                border: "1px solid rgba(200,150,90,0.25)",
                borderRadius: 4,
                color: "var(--accent)",
                fontSize: 11,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "var(--font-body)",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
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
            <div style={{ display: "flex", gap: 4 }}>
              {data.is_demo && <span style={demoTagStyle}>演示</span>}
              <span style={tagStyle}>我的公众号</span>
            </div>
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

const demoTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 8,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "2px 5px",
  borderRadius: 3,
  background: "rgba(150,150,150,0.15)",
  color: "var(--text-tertiary)",
  border: "1px solid rgba(150,150,150,0.3)",
};
