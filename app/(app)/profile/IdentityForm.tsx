"use client";

import { useState } from "react";

export function IdentityForm({
  initialValue,
  initialMemory,
}: {
  initialValue: string;
  initialMemory: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [memoryValue, setMemoryValue] = useState(initialMemory);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await fetch("/api/memory/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity_memo: value,
        memory_markdown: memoryValue,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        placeholder={"例：我是一名独立产品经理，专注 AI 工具在职场场景的应用，有 3 年 B 端产品经验，文字风格偏向克制、有据可查，不喜欢贩卖焦虑..."}
        style={{
          width: "100%",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "14px 16px",
          color: "var(--text-primary)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: 1.7,
          outline: "none",
          resize: "vertical",
          marginBottom: 16,
        }}
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
        AI 已记住的内容
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
