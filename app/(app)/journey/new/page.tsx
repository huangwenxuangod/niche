"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NICHE_TREE, CONTENT_TYPES, PLATFORMS } from "@/lib/data";
import KOCRecommendationModal from "@/components/KOCRecommendationModal";

type Step = 1 | 2 | 3 | 4 | "identity" | "recommendation";

export default function NewJourneyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [platform, setPlatform] = useState("");
  const [level1, setLevel1] = useState("");
  const [level2, setLevel2] = useState("");
  const [level3, setLevel3] = useState("");
  const [identity, setIdentity] = useState("");
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  async function finish(skipIdentity = false) {
    setLoading(true);
    const res = await fetch("/api/journeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        niche_level1: level1,
        niche_level2: level2,
        niche_level3: level3,
        identity_memo: skipIdentity ? undefined : identity,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (skipIdentity) {
      setJourneyId(data.journey_id);
      setModalVisible(true);
    } else {
      setJourneyId(data.journey_id);
      setModalVisible(true);
    }
  }

  async function handleImportComplete(conversationId: string) {
    setModalVisible(false);
    router.push(`/chat/${conversationId}`);
    router.refresh();
  }

  async function handleSkip() {
    if (journeyId) {
      const res = await fetch(`/api/journeys/${journeyId}/create-conversation`, { method: "POST" });
      const data = await res.json();
      setModalVisible(false);
      router.push(`/chat/${data.conversation_id}`);
      router.refresh();
    }
  }

  return (
    <>
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
          {/* Step indicator */}
          {step !== "identity" && step !== "recommendation" && (
            <StepIndicator current={step as number} total={4} />
          )}

          {/* Cards */}
          {step === 1 && (
            <StepCard
              stepNum={1}
              question="从哪个平台开始你的旅程？"
              hint="目前公众号数据最完整，其他平台正在接入。"
            >
              <div style={choiceGridStyle}>
                {PLATFORMS.map((p) => (
                  <ChoiceItem
                    key={p.key}
                    name={p.label}
                    selected={platform === p.key}
                    disabled={!p.available}
                    badge={p.available ? undefined : "即将支持"}
                    onClick={() => p.available && setPlatform(p.key)}
                  />
                ))}
              </div>
              <StepActions
                onNext={() => platform && setStep(2)}
                nextDisabled={!platform}
                showBack={false}
              />
            </StepCard>
          )}

          {step === 2 && (
            <StepCard
              stepNum={2}
              question="你想做哪个大方向的内容？"
              hint="不用想太久，选最接近你日常兴趣或专业的方向。"
            >
              <div style={choiceGridStyle}>
                {Object.keys(NICHE_TREE).map((l1) => (
                  <ChoiceItem
                    key={l1}
                    name={l1}
                    selected={level1 === l1}
                    onClick={() => setLevel1(l1)}
                  />
                ))}
              </div>
              <StepActions
                onBack={() => setStep(1)}
                onNext={() => level1 && setStep(3)}
                nextDisabled={!level1}
              />
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              stepNum={3}
              question={`在「${level1}」里，你想聚焦哪个细分领域？`}
              hint="越细越好。选得越准，AI 给你找的对标 KOC 就越精准。"
            >
              <div style={choiceGridStyle}>
                {(NICHE_TREE[level1] || []).map((l2) => (
                  <ChoiceItem
                    key={l2}
                    name={l2}
                    selected={level2 === l2}
                    onClick={() => setLevel2(l2)}
                  />
                ))}
              </div>
              <StepActions
                onBack={() => setStep(2)}
                onNext={() => level2 && setStep(4)}
                nextDisabled={!level2}
              />
            </StepCard>
          )}

          {step === 4 && (
            <StepCard
              stepNum={4}
              question="你打算用什么方式输出内容？"
              hint="选一个主要风格，后期随时可以调整方向。"
            >
              <div style={choiceGridStyle}>
                {CONTENT_TYPES.map((ct) => (
                  <ChoiceItem
                    key={ct.key}
                    name={ct.key}
                    desc={ct.desc}
                    selected={level3 === ct.key}
                    onClick={() => setLevel3(ct.key)}
                  />
                ))}
              </div>
              <StepActions
                onBack={() => setStep(3)}
                onNext={() => level3 && setStep("identity")}
                nextDisabled={!level3}
                nextLabel="下一步 →"
              />
            </StepCard>
          )}

          {step === "identity" && (
            <IdentityCard
              value={identity}
              onChange={setIdentity}
              onSkip={() => finish(true)}
              onConfirm={() => finish(false)}
              loading={loading}
            />
          )}
        </div>
      </div>

      {modalVisible && journeyId && (
        <KOCRecommendationModal
          journeyId={journeyId}
          keywords={[level1, level2, level3].filter(Boolean)}
          onImportComplete={handleImportComplete}
          onSkip={handleSkip}
        />
      )}
    </>
  );
}

// --- Sub components ---

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 40 }}>
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <>
            <div
              key={`node-${n}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: `1.5px solid ${done || active ? "var(--accent)" : "var(--border-strong)"}`,
                background: done ? "var(--accent)" : "var(--bg-void)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: done ? "var(--bg-void)" : active ? "var(--accent)" : "var(--text-tertiary)",
                flexShrink: 0,
                boxShadow: active ? "0 0 0 3px var(--accent-glow)" : "none",
                zIndex: 1,
              }}
            >
              {done ? "✓" : n}
            </div>
            {i < total - 1 && (
              <div
                key={`line-${n}`}
                style={{
                  flex: 1,
                  height: 1,
                  background: done ? "rgba(200,150,90,0.4)" : "var(--border)",
                }}
              />
            )}
          </>
        );
      })}
    </div>
  );
}

function StepCard({
  stepNum,
  question,
  hint,
  children,
}: {
  stepNum: number;
  question: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <div style={stepNumStyle}>Step 0{stepNum} of 04</div>
      <div style={questionStyle}>{question}</div>
      <div style={hintStyle}>{hint}</div>
      {children}
    </div>
  );
}

function IdentityCard({
  value,
  onChange,
  onSkip,
  onConfirm,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSkip: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 12 }}>
        可选 · 告诉 AI 你是谁
      </div>
      <div style={questionStyle}>在开始之前，<br />简单介绍一下自己？</div>
      <div style={hintStyle}>
        AI 会在每次对话中记住这些信息，给出更有针对性的建议。随时可以在「我是谁」页面修改。
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例：我是一名独立产品经理，专注 AI 工具在职场场景的应用，有 3 年 B 端产品经验，文字风格偏向克制、有据可查，不喜欢贩卖焦虑..."
        rows={5}
        style={{
          width: "100%",
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "10px 14px",
          color: "var(--text-primary)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          outline: "none",
          resize: "none",
          lineHeight: 1.6,
          marginBottom: 24,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onSkip} disabled={loading} style={ghostBtnStyle}>
          跳过
        </button>
        <button onClick={onConfirm} disabled={loading} style={primaryBtnStyle}>
          {loading ? "创建中..." : "确认，开始旅程 →"}
        </button>
      </div>
    </div>
  );
}

function ChoiceItem({
  name,
  desc,
  selected,
  disabled,
  badge,
  onClick,
}: {
  name: string;
  desc?: string;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={!disabled ? onClick : undefined}
      style={{
        padding: "13px 15px",
        background: selected ? "var(--accent-glow)" : "var(--bg-elevated)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        position: "relative",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: desc ? 3 : 0 }}>
        {name}
      </div>
      {desc && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{desc}</div>
      )}
      {badge && (
        <div
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            fontFamily: "var(--font-mono)",
            fontSize: 8,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "2px 5px",
            borderRadius: 3,
            background: "var(--bg-base)",
            color: "var(--text-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          {badge}
        </div>
      )}
    </div>
  );
}

function StepActions({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
  showBack = true,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  showBack?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
      {showBack && onBack ? (
        <button onClick={onBack} style={ghostBtnStyle}>← 上一步</button>
      ) : (
        <div />
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          style={{
            ...primaryBtnStyle,
            opacity: nextDisabled ? 0.4 : 1,
            cursor: nextDisabled ? "not-allowed" : "pointer",
          }}
        >
          {nextLabel || "下一步 →"}
        </button>
      )}
    </div>
  );
}

// --- Styles ---

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 32,
};

const stepNumStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--accent)",
  marginBottom: 12,
};

const questionStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 22,
  fontWeight: 400,
  color: "var(--text-primary)",
  letterSpacing: "-0.02em",
  marginBottom: 8,
  lineHeight: 1.3,
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-tertiary)",
  marginBottom: 24,
  lineHeight: 1.6,
};

const choiceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
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
  cursor: "pointer",
};
