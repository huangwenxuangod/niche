"use client";

import { useState } from "react";

interface Props {
  conversationId: string;
  onClose: () => void;
  onResult: (accountName: string) => void;
}

export function AccountAnalysisModal({ onClose, onResult }: Props) {
  const [name, setName] = useState("");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          overflow: "hidden",
          margin: "0 20px",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            分析你的公众号
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
            AI 将把你的数据与同赛道 KOC 进行横向对比
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>
          <div style={labelStyle}>公众号名称</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入你的公众号名称..."
            autoFocus
            style={inputStyle}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onResult(name.trim())}
          />

          <div style={labelStyle}>将为你分析</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
            {[
              "近 30 篇文章发布时间与频率规律",
              "爆款内容标题结构与话题特征",
              "与同赛道 KOC 的差距与机会",
              "3 条具体可执行的改进建议",
            ].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                {item}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={ghostBtnStyle}>取消</button>
            <button
              onClick={() => name.trim() && onResult(name.trim())}
              disabled={!name.trim()}
              style={{ ...primaryBtnStyle, opacity: name.trim() ? 1 : 0.4, cursor: name.trim() ? "pointer" : "not-allowed" }}
            >
              开始分析 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  outline: "none",
  marginBottom: 20,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-secondary)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "var(--accent)",
  border: "none",
  borderRadius: 6,
  color: "var(--bg-void)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  fontWeight: 500,
};
