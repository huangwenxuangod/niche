"use client";

import { useState } from "react";
import { buildIdentityMemo, parseIdentityMemo, type IdentityProfile } from "@/lib/memory";

export function IdentityForm({
  initialValue,
  initialMemory,
}: {
  initialValue: string;
  initialMemory: string;
}) {
  const [profile, setProfile] = useState<IdentityProfile>(() => parseIdentityMemo(initialValue));
  const [memoryValue, setMemoryValue] = useState(initialMemory);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    const identityMemo = buildIdentityMemo(profile);
    await fetch("/api/memory/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity_memo: identityMemo,
        memory_markdown: memoryValue,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateField<K extends keyof IdentityProfile>(key: K, value: IdentityProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
        <Field
          label="我是谁"
          placeholder="例：独立开发者 / 内容创作者 / AI 产品经理"
          value={profile.about}
          onChange={(value) => updateField("about", value)}
        />
        <Field
          label="我的赛道"
          placeholder="例：AI 创业 / AI 内容增长 / 公众号运营"
          value={profile.niche}
          onChange={(value) => updateField("niche", value)}
        />
        <Field
          label="目标平台"
          placeholder="例：社媒通用，公众号先落地"
          value={profile.targetPlatform}
          onChange={(value) => updateField("targetPlatform", value)}
        />
        <Field
          label="目标用户"
          placeholder="例：冷启动 KOC / 想做内容但不会运营的普通创作者"
          value={profile.targetUser}
          onChange={(value) => updateField("targetUser", value)}
        />
        <Field
          label="当前目标"
          placeholder="例：帮助普通 KOC 找方向并产出涨粉内容"
          value={profile.currentGoal}
          onChange={(value) => updateField("currentGoal", value)}
        />
        <Field
          label="表达风格"
          placeholder="例：直接、克制、有据可查，不贩卖焦虑"
          value={profile.stylePreference}
          onChange={(value) => updateField("stylePreference", value)}
        />
      </div>
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

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 14px",
          color: "var(--text-primary)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: 1.5,
          outline: "none",
        }}
      />
    </div>
  );
}
