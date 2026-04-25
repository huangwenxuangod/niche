"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLATFORMS } from "@/lib/data";
import { toast } from "@/lib/toast";

export default function NewJourneyPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState("wechat_mp");
  const [loading, setLoading] = useState(false);

  async function startJourney() {
    setLoading(true);
    try {
      const res = await fetch("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok || !data.conversation_id) {
        throw new Error(data.error || "创建旅程失败");
      }
      router.push(`/chat/${data.conversation_id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建旅程失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-void)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={cardStyle}>
          <div style={stepEyebrowStyle}>Step 01 of 01</div>
          <div style={questionStyle}>从哪个平台开始你的内容增长对话？</div>
          <div style={hintStyle}>
            先选平台，剩下的问题交给对话来收集。你进入之后可以直接说现在最想解决的内容问题。
          </div>

          <div style={choiceGridStyle}>
            {PLATFORMS.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={!item.available || loading}
                onClick={() => item.available && setPlatform(item.key)}
                style={{
                  ...choiceItemStyle,
                  ...(platform === item.key ? choiceItemActiveStyle : null),
                  opacity: item.available ? 1 : 0.42,
                  cursor: item.available ? "pointer" : "not-allowed",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                  {item.key === "wechat_mp" ? "适合长文增长分析与排版发布" : "即将支持"}
                </div>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 28 }}>
            <button
              type="button"
              onClick={startJourney}
              disabled={!platform || loading}
              style={{
                ...primaryButtonStyle,
                opacity: !platform || loading ? 0.45 : 1,
                cursor: !platform || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "创建中..." : "开始对话 →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 32,
};

const stepEyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--accent)",
  marginBottom: 12,
};

const questionStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 24,
  fontWeight: 400,
  color: "var(--text-primary)",
  letterSpacing: "-0.02em",
  marginBottom: 8,
  lineHeight: 1.28,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-tertiary)",
  marginBottom: 24,
  lineHeight: 1.7,
};

const choiceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const choiceItemStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  padding: "16px 14px",
  textAlign: "left",
  transition: "border-color 0.15s ease, background 0.15s ease",
};

const choiceItemActiveStyle: React.CSSProperties = {
  borderColor: "var(--accent)",
  background: "var(--accent-glow)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "9px 20px",
  background: "var(--accent)",
  border: "none",
  borderRadius: 8,
  color: "var(--bg-void)",
  fontSize: 12,
  fontWeight: 600,
};
