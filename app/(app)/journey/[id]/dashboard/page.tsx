"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { WechatDashboardData } from "@/lib/data";

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function DashboardPage() {
  const { id: journeyId } = useParams() as { id: string };
  const router = useRouter();
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
    <div style={{ height: "100%", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>←</button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, color: "var(--text-primary)" }}>数据复盘</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>公众号数据一览，帮你复盘内容表现</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>加载中...</div>
        ) : !data ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>暂无数据</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Core metrics */}
            <section>
              <SectionHeader label="核心指标" />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <MetricCard label="文章数" val={String(data.summary.article_count)} />
                <MetricCard label="总阅读" val={fmtCount(data.summary.total_reads)} />
                <MetricCard label="均阅读" val={fmtCount(data.summary.avg_reads)} />
                <MetricCard label="均点赞" val={fmtCount(data.summary.avg_likes)} />
                <MetricCard label="均分享" val={fmtCount(data.summary.avg_shares)} />
                <MetricCard label="均评论" val={fmtCount(data.summary.avg_comments)} />
              </div>
            </section>

            {/* Article performance */}
            <section>
              <SectionHeader label="文章表现" />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {data.articles.map((art) => (
                  <div
                    key={art.id}
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "18px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", flex: 1, marginRight: 12, lineHeight: 1.4 }}>
                        {art.title}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                        {new Date(art.publish_time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      <Stat label="阅读" val={fmtCount(art.read_num)} />
                      <Stat label="点赞" val={fmtCount(art.like_num)} />
                      <Stat label="分享" val={fmtCount(art.share_num)} />
                      <Stat label="评论" val={fmtCount(art.comment_num)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Trend placeholder */}
            <section>
              <SectionHeader label="趋势" />
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "60px 20px",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>趋势图表开发中...</div>
              </div>
            </section>

            {/* AI insights */}
            <section>
              <SectionHeader label="AI 洞察" />
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "18px",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {data.ai_insights}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 12 }}>
      {label}
    </div>
  );
}

function MetricCard({ label, val }: { label: string; val: string }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 18px",
        minWidth: 120,
        flex: "1 1 120px",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>
        {val}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginTop: 4 }}>
        {label}
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
