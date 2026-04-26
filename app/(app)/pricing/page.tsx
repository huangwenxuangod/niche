"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, ArrowRight } from "lucide-react";

type Plan = {
  id: string;
  name: string;
  tier: "free" | "pro" | "max";
  pricing: {
    monthly: number;
    quarterly: number;
    yearly: number;
  };
  description: string;
  features: string[];
  highlight?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "免费版",
    tier: "free",
    pricing: { monthly: 0, quarterly: 0, yearly: 0 },
    description: "适合体验核心功能",
    features: [
      "每月 10 次 AI 对话",
      "单个旅程项目",
      "3 个 KOC 追踪",
      "基础知识库检索",
      "基础文章排版",
      "社区支持",
    ],
  },
  {
    id: "pro",
    name: "Pro版",
    tier: "pro",
    pricing: { monthly: 99, quarterly: 279, yearly: 950 },
    description: "适合个人创作者",
    badge: "最受欢迎",
    highlight: true,
    features: [
      "无限 AI 对话",
      "5 个旅程项目",
      "20 个 KOC 追踪",
      "完整知识库 + 向量检索",
      "文章排版与一键发布",
      "热点搜索与数据分析",
      "爆款规律分析",
      "合规检查",
      "优先客服支持",
      "记忆系统（用户+旅程）",
    ],
  },
  {
    id: "max",
    name: "Max版",
    tier: "max",
    pricing: { monthly: 299, quarterly: 839, yearly: 2850 },
    description: "适合专业团队/MCN",
    badge: "推荐团队",
    features: [
      "包含 Pro 版所有功能",
      "无限旅程项目",
      "无限 KOC 追踪",
      "团队协作（5个账号）",
      "批量内容生成",
      "多平台统一管理",
      "API 访问权限",
      "项目记忆（策略卡片）",
      "专属客户经理",
      "7×24 技术支持",
      "数据导出功能",
      "私有化咨询",
    ],
  },
];

const PERIODS = [
  { id: "monthly", label: "月付", discount: null },
  { id: "quarterly", label: "季付", discount: "省 6%" },
  { id: "yearly", label: "年付", discount: "省 20%" },
];

type BillingPeriod = "monthly" | "quarterly" | "yearly";

export default function PricingPage() {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const getDisplayPrice = (plan: Plan, p: BillingPeriod) => {
    if (plan.tier === "free") return "¥0";
    const price = plan.pricing[p];
    return p === "monthly" ? `¥${price}/月` : `¥${price}`;
  };

  const getMonthlyPrice = (plan: Plan, p: BillingPeriod) => {
    if (plan.tier === "free") return "¥0/月";
    const price = plan.pricing[p];
    const divisor = p === "monthly" ? 1 : p === "quarterly" ? 3 : 12;
    return `¥${Math.round(price / divisor)}/月`;
  };

  const getSavings = (plan: Plan, p: BillingPeriod) => {
    if (plan.tier === "free") return null;
    const original = plan.pricing.monthly;
    const multiplier = p === "quarterly" ? 3 : p === "yearly" ? 12 : 1;
    const originalTotal = original * multiplier;
    const current = plan.pricing[p];
    return originalTotal - current;
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-void)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--bg-void)",
          borderBottom: "1px solid var(--border)",
          padding: "16px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            color: "var(--text-primary)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            N
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Niche</span>
        </Link>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Link
            href="/login"
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            登录
          </Link>
          <Link
            href="/login"
            style={{
              padding: "8px 16px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--bg-void)",
              textDecoration: "none",
            }}
          >
            免费试用
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          padding: "80px 24px 40px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 16,
          }}
        >
          Pricing
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 48,
            fontWeight: 400,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            marginBottom: 20,
            color: "var(--text-primary)",
          }}
        >
          选择适合你的内容增长方案
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--text-secondary)",
            maxWidth: 600,
            margin: "0 auto 40px",
            lineHeight: 1.7,
          }}
        >
          Niche 是你的内容策略合伙人 —— KOC 情报、RAG 知识库、智能对话，帮你建立可持续的内容增长体系。
        </p>

        {/* Billing Period Toggle */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "stretch",
            background: "var(--bg-surface)",
            padding: "6px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            gap: 4,
          }}
        >
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id as BillingPeriod)}
              style={{
                position: "relative",
                padding: "10px 24px",
                background: period === p.id ? "var(--bg-elevated)" : "transparent",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: period === p.id ? "var(--text-primary)" : "var(--text-secondary)",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {p.label}
              {p.discount && (
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    background: "var(--accent)",
                    color: "var(--bg-void)",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {p.discount}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Pricing Cards */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 60px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
            gap: 24,
          }}
        >
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              period={period}
              selected={selectedPlan === plan.id}
              onSelect={() => setSelectedPlan(plan.id)}
              getDisplayPrice={getDisplayPrice}
              getMonthlyPrice={getMonthlyPrice}
              getSavings={getSavings}
            />
          ))}
        </div>
      </section>

      {/* Feature Comparison */}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px 80px",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          功能对比
        </div>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                }}
              >
                <th
                  style={{
                    padding: "16px 24px",
                    textAlign: "left",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    width: "28%",
                  }}
                >
                  功能
                </th>
                <th
                  style={{
                    padding: "16px 20px",
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    width: "24%",
                  }}
                >
                  免费版
                </th>
                <th
                  style={{
                    padding: "16px 20px",
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--accent)",
                    width: "24%",
                  }}
                >
                  Pro版
                </th>
                <th
                  style={{
                    padding: "16px 20px",
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    width: "24%",
                  }}
                >
                  Max版
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "AI 对话次数", free: "10次/月", pro: "无限", max: "无限" },
                { feature: "旅程项目", free: "1个", pro: "5个", max: "无限" },
                { feature: "KOC 追踪", free: "3个", pro: "20个", max: "无限" },
                { feature: "知识库向量检索", free: "基础", pro: "完整", max: "完整" },
                { feature: "文章排版与发布", free: "基础", pro: "✅", max: "✅" },
                { feature: "热点搜索", free: "❌", pro: "✅", max: "✅" },
                { feature: "数据分析", free: "❌", pro: "✅", max: "✅" },
                { feature: "爆款规律分析", free: "❌", pro: "✅", max: "✅" },
                { feature: "合规检查", free: "❌", pro: "✅", max: "✅" },
                { feature: "记忆系统（用户+旅程）", free: "❌", pro: "✅", max: "✅" },
                { feature: "项目记忆（策略卡片）", free: "❌", pro: "❌", max: "✅" },
                { feature: "团队协作", free: "❌", pro: "❌", max: "5个账号" },
                { feature: "批量内容生成", free: "❌", pro: "❌", max: "✅" },
                { feature: "多平台统一管理", free: "❌", pro: "❌", max: "✅" },
                { feature: "API 访问", free: "❌", pro: "❌", max: "✅" },
                { feature: "专属客户经理", free: "❌", pro: "❌", max: "✅" },
                { feature: "7×24 技术支持", free: "社区", pro: "优先", max: "专属" },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td
                    style={{
                      padding: "14px 24px",
                      fontSize: 13,
                      color: "var(--text-primary)",
                    }}
                  >
                    {row.feature}
                  </td>
                  <td
                    style={{
                      padding: "14px 20px",
                      textAlign: "center",
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {row.free}
                  </td>
                  <td
                    style={{
                      padding: "14px 20px",
                      textAlign: "center",
                      fontSize: 13,
                      color: "var(--text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {row.pro}
                  </td>
                  <td
                    style={{
                      padding: "14px 20px",
                      textAlign: "center",
                      fontSize: 13,
                      color: "var(--text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {row.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 24px 80px",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          常见问题
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            {
              q: "可以随时取消订阅吗？",
              a: "可以。你可以随时在账户设置中取消订阅，当前计费周期结束后不再扣费。",
            },
            {
              q: "升级或降级套餐如何处理？",
              a: "升级立即生效，按比例补差价。降级在当前计费周期结束后生效，原套餐功能保留至周期结束。",
            },
            {
              q: "Max版支持多少个协作者？",
              a: "Max 版默认支持 5 个协作者账号，如需更多账号请联系销售定制。",
            },
            {
              q: "数据安全有保障吗？",
              a: "我们采用企业级加密和访问控制，所有数据存储在安全的云环境中，符合数据保护法规要求。",
            },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 8,
                }}
              >
                {item.q}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                {item.a}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "0 24px 80px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 400,
            lineHeight: 1.2,
            marginBottom: 16,
            color: "var(--text-primary)",
          }}
        >
          不确定哪个方案适合你？
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            marginBottom: 24,
          }}
        >
          联系我们的团队，获取个性化建议
        </p>
        <a
          href="mailto:hello@niche.com"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            background: "var(--accent)",
            color: "var(--bg-void)",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          联系销售
          <ArrowRight size={16} />
        </a>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 24,
            marginBottom: 20,
          }}
        >
          <Link href="#" style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none" }}>
            隐私政策
          </Link>
          <Link href="#" style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none" }}>
            服务条款
          </Link>
          <Link href="#" style={{ fontSize: 12, color: "var(--text-secondary)", textDecoration: "none" }}>
            帮助中心
          </Link>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          © 2026 Niche. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function PlanCard({
  plan,
  period,
  selected,
  onSelect,
  getDisplayPrice,
  getMonthlyPrice,
  getSavings,
}: {
  plan: Plan;
  period: BillingPeriod;
  selected: boolean;
  onSelect: () => void;
  getDisplayPrice: (plan: Plan, p: BillingPeriod) => string;
  getMonthlyPrice: (plan: Plan, p: BillingPeriod) => string;
  getSavings: (plan: Plan, p: BillingPeriod) => number | null;
}) {
  const savings = getSavings(plan, period);
  const displayPrice = getDisplayPrice(plan, period);
  const monthlyPrice = getMonthlyPrice(plan, period);

  return (
    <div
      style={{
        position: "relative",
        background: plan.highlight
          ? "linear-gradient(180deg, rgba(200, 150, 90, 0.08), rgba(200, 150, 90, 0.02))"
          : "var(--bg-surface)",
        border: selected
          ? "2px solid var(--accent)"
          : plan.highlight
          ? "1px solid rgba(200, 150, 90, 0.2)"
          : "1px solid var(--border)",
        borderRadius: 16,
        padding: 32,
        cursor: "pointer",
        transition: "border-color 0.2s ease, transform 0.2s ease",
      }}
      onClick={onSelect}
    >
      {plan.badge && (
        <div
          style={{
            position: "absolute",
            top: -10,
            left: 24,
            background: "var(--accent)",
            color: "var(--bg-void)",
            fontSize: 10,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 999,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {plan.badge}
        </div>
      )}

      {plan.tier === "pro" && (
        <div
          style={{
            position: "absolute",
            top: -10,
            right: 24,
            background: "var(--accent)",
            color: "var(--bg-void)",
            fontSize: 10,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 999,
          }}
        >
          POPULAR
        </div>
      )}

      {/* Tier Badge */}
      <div
        style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 16,
          background:
            plan.tier === "free"
              ? "var(--bg-elevated)"
              : plan.tier === "pro"
              ? "var(--accent)"
              : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: plan.tier === "free" ? "var(--text-secondary)" : "var(--bg-void)",
        }}
      >
        {plan.tier === "free" ? "STARTER" : plan.tier === "pro" ? "PROFESSIONAL" : "MAXIMUM"}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}
        >
          {plan.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 40,
              fontWeight: 700,
              color:
                plan.tier === "max"
                  ? "var(--accent)"
                  : plan.tier === "pro"
                  ? "var(--accent)"
                  : "var(--text-primary)",
              lineHeight: 1,
            }}
          >
            {displayPrice}
          </span>
          {plan.tier !== "free" && (
            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                background: "var(--bg-elevated)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {monthlyPrice}
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          fontSize: 13,
          color: "var(--text-tertiary)",
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        {plan.description}
      </p>

      {savings && savings > 0 && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(76, 175, 80, 0.1)",
            border: "1px solid rgba(76, 175, 80, 0.2)",
            borderRadius: 8,
            fontSize: 11,
            color: "#4caf50",
            marginBottom: 20,
            textAlign: "center",
            fontWeight: 500,
          }}
        >
          💰 比月付累计节省 ¥{savings}
        </div>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, marginBottom: 24, gap: 10, display: "flex", flexDirection: "column" }}>
        {plan.features.map((feature, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Check size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        style={{
          width: "100%",
          padding: "14px",
          background:
            selected || plan.tier === "pro"
              ? "var(--accent)"
              : plan.tier === "free"
              ? "var(--bg-elevated)"
              : "var(--accent)",
          border: selected ? "2px solid var(--accent)" : "none",
          borderRadius: 10,
          color: plan.tier === "free" ? "var(--text-primary)" : "var(--bg-void)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        {plan.tier === "free" ? "开始免费使用" : `订阅${period === "monthly" ? "月付" : period === "quarterly" ? "季付" : "年付"}方案`}
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
