"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

interface Props {
  onClose: () => void;
  onResult: (message: string) => void;
}

type ConfigState = "checking" | "configured" | "not_configured";

export function AccountAnalysisModal({ onClose, onResult }: Props) {
  const [configState, setConfigState] = useState<ConfigState>("checking");
  const [appId, setAppId] = useState("");
  const [accountName, setAccountName] = useState("");

  const canAnalyze = accountName.trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const res = await fetch("/api/wechat/config");
        const data = await res.json();
        if (cancelled) return;

        if (res.ok && data.config?.app_id) {
          setAppId(data.config.app_id);
          setConfigState("configured");
          return;
        }

        setConfigState("not_configured");
      } catch {
        if (!cancelled) {
          setConfigState("not_configured");
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const headerDescription = useMemo(() => {
    if (configState === "configured") {
      return "输入公众号名称分析内容结构；已绑定的官方账号配置会继续保留，用于后续自动发布到公众号草稿箱。";
    }
    if (configState === "not_configured") {
      return "先用公众号名称导入和分析内容，后续如果要自动发布，再去排版发布流程里配置 AppID 和 AppSecret 即可。";
    }
    return "正在检查你的公众号发布配置...";
  }, [configState]);

  function handleAnalyze() {
    const normalizedName = accountName.trim();
    if (!normalizedName) {
      toast.error("请先填写要分析的公众号名称。");
      return;
    }

    const prompt = [
      `请分析公众号“${normalizedName}”的内容。`,
      "如果当前旅程知识库里已经有这个号的文章，优先基于知识库内容做分析。",
      "请重点输出：",
      "1. 最近内容为什么容易传播",
      "2. 标题、选题和结构上的规律",
      "3. 它和当前赛道竞品相比的差异",
      "4. 我可以直接借鉴的 3 条改进建议",
    ].join("\n");

    onResult(prompt);
  }

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
          maxWidth: 460,
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          overflow: "hidden",
          margin: "0 20px",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            分析你的公众号
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
            {headerDescription}
          </div>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          {configState === "checking" ? (
            <div style={placeholderWrapStyle}>正在检查公众号配置...</div>
          ) : (
            <>
              <PublishStatusCard configured={configState === "configured"} appId={appId} />

              <div style={labelStyle}>公众号名称</div>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="输入你的公众号名称..."
                autoFocus
                style={{ ...inputStyle, marginBottom: 18 }}
              />

              <AnalysisCapabilityList />

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={onClose} style={ghostBtnStyle}>取消</button>
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze}
                  style={{
                    ...primaryBtnStyle,
                    opacity: canAnalyze ? 1 : 0.45,
                    cursor: canAnalyze ? "pointer" : "not-allowed",
                  }}
                >
                  开始分析 →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PublishStatusCard({
  configured,
  appId,
}: {
  configured: boolean;
  appId: string;
}) {
  return (
    <div
      style={{
        ...statusCardStyle,
        background: configured ? "var(--accent-glow)" : "var(--bg-base)",
        border: configured
          ? "1px solid rgba(200,150,90,0.18)"
          : "1px solid var(--border)",
      }}
    >
      <div style={statusTitleStyle}>
        {configured ? "自动发布状态" : "自动发布状态"}
      </div>
      <div style={statusValueStyle}>
        {configured ? "已配置官方发布能力" : "暂未配置官方发布能力"}
      </div>
      <div style={statusHintStyle}>
        {configured
          ? `当前已绑定 AppID：${appId}，后续排版完成后可以继续走官方 API 保存草稿。`
          : "这不影响内容分析；后续如果要自动发布，再在排版发布流程里配置 AppID 和 AppSecret。"}
      </div>
    </div>
  );
}

function AnalysisCapabilityList() {
  return (
    <>
      <div style={labelStyle}>将为你分析</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {[
          "公众号近期内容为什么更容易传播",
          "标题、选题和结构上的稳定规律",
          "和当前赛道竞品相比的差异与机会",
          "3 条可直接执行的优化建议",
        ].map((item) => (
          <div
            key={item}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 3,
                height: 3,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
              }}
            />
            {item}
          </div>
        ))}
      </div>
    </>
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
};

const placeholderWrapStyle: React.CSSProperties = {
  minHeight: 220,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-secondary)",
  fontSize: 13,
};

const statusCardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  marginBottom: 20,
};

const statusTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const statusValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-primary)",
  fontWeight: 600,
  marginBottom: 6,
};

const statusHintStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.65,
  color: "var(--text-secondary)",
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
