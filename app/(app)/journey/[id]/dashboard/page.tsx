"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { WechatDashboardData } from "@/lib/data";

type DashboardResponse =
  | {
      configured: false;
      account_name: string;
    }
  | ({
      configured: true;
      account_name: string;
    } & WechatDashboardData);

function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function DashboardPage() {
  const { id: journeyId } = useParams() as { id: string };
  const router = useRouter();
  const [data, setData] = useState<WechatDashboardData | null>(null);
  const [configured, setConfigured] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  return (
    <div style={{ height: "100%", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 18 }}>←</button>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, color: "var(--text-primary)" }}>数据复盘</div>
          {data?.is_demo && (
            <span style={{ fontSize: 10, color: "var(--accent)", background: "var(--accent-dim)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(200,150,90,0.3)" }}>
              演示数据
            </span>
          )}
        </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>公众号数据一览，帮你复盘内容表现</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>加载中...</div>
        ) : !configured ? (
          <div
            style={{
              maxWidth: 720,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "28px 24px",
            }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--text-primary)", marginBottom: 10 }}>
              先配置你的公众号
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, marginBottom: 14 }}>
              这里以后不是一个简单配置项，而是你自己的内容复盘页。配置公众号名称后，我们会围绕你的文章表现、代表内容和 AI 洞察持续沉淀证据。
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.7 }}>
              当前状态：{accountName ? `已识别为「${accountName}」但尚未完成配置` : "尚未配置公众号名称"}
            </div>
            <div style={{ marginTop: 18 }}>
              <button
                onClick={() => router.push("/chat")}
                style={{
                  padding: "8px 12px",
                  background: "var(--accent-dim)",
                  border: "1px solid rgba(200,150,90,0.25)",
                  borderRadius: 6,
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "var(--font-body)",
                }}
              >
                返回写作区继续配置
              </button>
            </div>
          </div>
        ) : !data ? (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "60px 0" }}>暂无数据</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <section>
              <SectionHeader label="账号定位" />
              <div
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
                <div>
                  <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 500 }}>
                    {data.account.name}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.7 }}>
                    这是你的公众号工作台。后续这里会承接你的整体内容复盘，而不是只在侧边栏里显示一个摘要卡片。
                  </div>
                </div>
                {data.is_demo && (
                  <span style={{ fontSize: 10, color: "var(--accent)", background: "var(--accent-dim)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(200,150,90,0.3)" }}>
                    演示数据
                  </span>
                )}
              </div>
            </section>

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

            {data.benchmark && (
              <section>
                <SectionHeader label="对照复盘" />
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "18px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
                      <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>
                        我的公众号 vs 核心对标「{data.benchmark.account.name}」
                      </div>
                      <span style={{ fontSize: 10, color: "var(--accent)", background: "var(--accent-dim)", padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(200,150,90,0.3)" }}>
                        对照
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}>
                      <CompareMetric
                        label="样本数"
                        mine={String(data.summary.article_count)}
                        benchmark={String(data.benchmark.summary.article_count)}
                      />
                      <CompareMetric
                        label="均阅读"
                        mine={fmtCount(data.summary.avg_reads)}
                        benchmark={fmtCount(data.benchmark.summary.avg_reads)}
                      />
                      <CompareMetric
                        label="峰值阅读"
                        mine={fmtCount(data.summary.peak_reads)}
                        benchmark={fmtCount(data.benchmark.summary.peak_reads)}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {data.benchmark.gap_summary.map((item, index) => (
                        <div
                          key={`${index}-${item}`}
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            lineHeight: 1.7,
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: "var(--bg-void)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

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

function CompareMetric({
  label,
  mine,
  benchmark,
}: {
  label: string;
  mine: string;
  benchmark: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-void)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>我</span>
          <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{mine}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>对标</span>
          <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 500 }}>{benchmark}</span>
        </div>
      </div>
    </div>
  );
}
