"use client";

import { useState } from "react";

export function IdentityForm({
  initialValue,
  initialMemory,
}: {
  initialValue: string;
  initialMemory: string;
}) {
  const [identityValue, setIdentityValue] = useState(initialValue);
  const [memoryValue, setMemoryValue] = useState(initialMemory);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/memory/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity_memo: identityValue,
        memory_markdown: memoryValue,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: 8,
        }}
      >
        当前判断摘要
      </div>
      <textarea
        value={identityValue}
        onChange={(e) => setIdentityValue(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "14px 16px",
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.7,
          outline: "none",
          resize: "vertical",
          marginBottom: 24,
        }}
        placeholder="写下你现在最明确、最想保留的一段判断..."
      />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: 8,
        }}
      >
        AI 正在持续沉淀的认知
      </div>
      <textarea
        value={memoryValue}
        onChange={(e) => setMemoryValue(e.target.value)}
        rows={14}
        style={{
          width: "100%",
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "14px 16px",
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.7,
          outline: "none",
          resize: "vertical",
          marginBottom: 16,
          whiteSpace: "pre-wrap",
        }}
        placeholder="# 用户认知

## 我反复在意的问题
（填写你总在反复思考的问题）

## 我目前形成的判断
（填写你现在已经比较明确的主张）

## 我还没想透的问题
（填写你还在继续想的部分）

## 我的关键经历
（填写真正影响过你的案例和经历）

## 我的长期主题
（填写你想长期持续写下去的主题）

## 当前核心对标
（填写你现在最想长期研究的一个对象）

## 我从核心对标学到的可迁移资产
（填写你觉得真正值得吸收，而不是照抄的东西）
"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "9px 20px",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            color: "var(--bg-void)",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 500,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {saved && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.1em" }}>
            ✓ 已保存
          </span>
        )}
      </div>
    </div>
  );
}
