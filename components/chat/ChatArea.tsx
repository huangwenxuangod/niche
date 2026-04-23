"use client";

import { useState, useRef, useEffect } from "react";
import type { Message, Journey } from "@/lib/data";
import { AccountAnalysisModal } from "./AccountAnalysisModal";
import { ArticleLayoutPanel } from "./ArticleLayoutPanel";
import { extractArticleFromAssistantMessage } from "@/lib/article-layout";

interface Props {
  conversationId: string;
  journey: Journey;
  initialMessages: Message[];
  kocCount: number;
}

type ToolEvent = {
  id: string;
  type: "tool_start" | "tool_result" | "tool_requires_confirmation" | "tool_error";
  toolName?: string;
  label: string;
  payload?: Record<string, unknown>;
  error?: string;
};

type RecommendedAccount = {
  name: string;
  ghid: string;
  fans: number;
  avg_top_read: number;
};

type KnowledgeArticleHit = {
  id: string;
  title: string;
  account_name: string;
  read_count: number;
  excerpt: string;
};

type GeneratedTopic = {
  index: number;
  title: string;
  angle: string;
};

type LoadingStep = {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
};

type LoadingSnapshot = {
  title: string;
  hint: string;
  steps: LoadingStep[];
};

export function ChatArea({ conversationId, journey, initialMessages, kocCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [importingGhid, setImportingGhid] = useState<string | null>(null);
  const [layoutTarget, setLayoutTarget] = useState<{ id: string; content: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loadingSnapshot = buildLoadingSnapshot(toolEvents, assistantStatus);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolEvents]);

  useEffect(() => {
    if (!streaming) return;

    const phases = ["理解问题中", "整理上下文中", "组织回答中"];
    let index = 0;
    const timer = window.setInterval(() => {
      setAssistantStatus((current) => {
        if (current && current !== phases[index]) {
          return current;
        }
        index = (index + 1) % phases.length;
        return phases[index];
      });
    }, 2200);

    return () => window.clearInterval(timer);
  }, [streaming]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    setToolEvents([]);
    setAssistantStatus("理解问题中");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content: text,
      tool_used: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    const assistantId: string = crypto.randomUUID();
    let currentAssistantId: string = assistantId;
    let assistantContent = "";

    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        conversation_id: conversationId,
        role: "assistant",
        content: "",
        tool_used: null,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE format
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "text" && parsed.text) {
                if (!assistantContent) {
                  setAssistantStatus("输出答案中");
                }
                assistantContent += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentAssistantId ? { ...m, content: assistantContent } : m
                  )
                );
              } else if (parsed.type === "assistant_status" && parsed.label) {
                setAssistantStatus(String(parsed.label));
              } else if (parsed.type === "assistant_message" && parsed.messageId) {
                const nextId = String(parsed.messageId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentAssistantId ? { ...m, id: nextId } : m
                  )
                );
                currentAssistantId = nextId;
              } else if (parsed.type && parsed.type !== "text") {
                setToolEvents((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    type: parsed.type,
                    toolName: parsed.toolName,
                    label: parsed.label || "工具调用",
                    payload: parsed.payload,
                    error: parsed.error,
                  },
                ]);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "抱歉，出现了一点问题，请重试。" }
            : m
        )
      );
    } finally {
      setStreaming(false);
      setAssistantStatus(null);
    }
  }

  async function importRecommendedKoc(ghid: string) {
    setImportingGhid(ghid);
    try {
      const res = await fetch(`/api/koc/${ghid}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: journey.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "导入失败");
      }

      setToolEvents((prev) =>
        prev.map((event) =>
          event.type === "tool_requires_confirmation" && event.payload?.ghid === ghid
            ? {
                ...event,
                type: "tool_result",
                payload: {
                  ...event.payload,
                  imported: true,
                  articleCount: data.articleCount,
                  account_name: data.account?.name || event.payload?.account_name,
                },
              }
            : event
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "导入失败";
      setToolEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "tool_error",
          label: "导入 KOC",
          error: message,
        },
      ]);
    } finally {
      setImportingGhid(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-void)" }}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 400, letterSpacing: "-0.01em" }}>
            {journey.platform === "wechat_mp" ? "公众号" : journey.platform} ×{" "}
            <em style={{ color: "var(--accent)", fontStyle: "italic" }}>{journey.niche_level2}</em>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <HeaderStat live={journey.knowledge_initialized}>
              {journey.knowledge_initialized ? "知识库已同步" : "初始化中..."}
            </HeaderStat>
            <HeaderStat>{kocCount} KOC</HeaderStat>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={messagesStyle}>
          {isEmpty ? (
            <WelcomeState journey={journey} onPrompt={sendMessage} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {toolEvents.length > 0 && (
                <ToolTimeline
                  events={toolEvents}
                  importingGhid={importingGhid}
                  onImport={importRecommendedKoc}
                />
              )}
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onOpenLayout={(target) => setLayoutTarget(target)}
                  loadingSnapshot={streaming && m.id === messages[messages.length - 1]?.id && m.role === "assistant" ? loadingSnapshot : null}
                  assistantStatus={streaming && m.id === messages[messages.length - 1]?.id && m.role === "assistant" ? assistantStatus : null}
                  isStreaming={streaming && m.id === messages[messages.length - 1]?.id && m.role === "assistant"}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={inputAreaStyle}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <ToolButton icon="📊" label="账号分析" onClick={() => setShowAnalysis(true)} />
            <ToolButton icon="🔥" label="今日热点" onClick={() => sendMessage("帮我搜索今日赛道最新热点，列出 3 条")} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="问我任何关于这个赛道的事... (Enter 发送，Shift+Enter 换行)"
              disabled={streaming}
              rows={1}
              style={{
                flex: 1,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                resize: "none",
                outline: "none",
                lineHeight: 1.5,
                minHeight: 40,
                maxHeight: 160,
                overflow: "auto",
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              style={{
                width: 40,
                height: 40,
                background: input.trim() && !streaming ? "var(--accent)" : "var(--bg-elevated)",
                border: "none",
                borderRadius: 8,
                color: input.trim() && !streaming ? "var(--bg-void)" : "var(--text-tertiary)",
                cursor: input.trim() && !streaming ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 16,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {showAnalysis && (
        <AccountAnalysisModal
          conversationId={conversationId}
          onClose={() => setShowAnalysis(false)}
          onResult={(text) => {
            setShowAnalysis(false);
            sendMessage(`[账号分析请求] ${text}`);
          }}
        />
      )}
      <ArticleLayoutPanel
        open={layoutTarget !== null}
        conversationId={conversationId}
        journeyId={journey.id}
        messageId={layoutTarget?.id ?? null}
        messageContent={layoutTarget?.content ?? ""}
        onClose={() => setLayoutTarget(null)}
      />
      <style>{`
        @keyframes nicheLoadingBar {
          0%, 100% { transform: scaleY(0.45); opacity: 0.45; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ---- Welcome state ----

const QUICK_PROMPTS = [
  "给我今日 3 个选题",
  "分析同赛道爆款规律",
  "最佳发布时间是什么时候",
  "帮我拆解竞品标题",
];

function WelcomeState({ journey, onPrompt }: { journey: Journey; onPrompt: (p: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: 8 }}>
          你好。<br />
          <em style={{ color: "var(--accent)", fontStyle: "italic" }}>{journey.niche_level2}</em> 赛道情报已就绪。
        </div>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
          知识库初始化{journey.knowledge_initialized ? "完成" : "中"}，可以直接提问。
        </div>
      </div>

      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 10 }}>
          快速开始
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onPrompt(p)}
              style={{
                padding: "7px 14px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 20,
                fontSize: 12,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.color = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Message bubble ----

function MessageBubble({
  message,
  isStreaming,
  onOpenLayout,
  assistantStatus,
  loadingSnapshot,
}: {
  message: Message;
  isStreaming: boolean;
  onOpenLayout: (target: { id: string; content: string }) => void;
  assistantStatus: string | null;
  loadingSnapshot: LoadingSnapshot | null;
}) {
  const isUser = message.role === "user";
  const hasLayoutTarget = !isUser && !isStreaming && extractArticleFromAssistantMessage(message.content) !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 4px" }}>
        {isUser ? "你" : "Niche"}
      </div>
      <div
        style={{
          maxWidth: "76%",
          padding: "12px 16px",
          borderRadius: isUser ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
          background: isUser ? "var(--bg-elevated)" : "var(--bg-surface)",
          border: `1px solid ${isUser ? "var(--border-strong)" : "var(--border)"}`,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        className={isStreaming && !message.content ? "streaming-cursor" : ""}
      >
        {!message.content && isStreaming ? (
          <WaitingState status={assistantStatus} snapshot={loadingSnapshot} />
        ) : (
          <>
            {isStreaming && loadingSnapshot && (
              <MiniLoadingCard snapshot={loadingSnapshot} />
            )}
            <span
              dangerouslySetInnerHTML={{
                __html: formatMessage(message.content),
              }}
            />
            {isStreaming && message.content && <span className="streaming-cursor" />}
          </>
        )}
      </div>
      {isStreaming && message.content && loadingSnapshot && (
        <div style={statusPillStyle}>
          <span style={statusDotStyle} />
          {loadingSnapshot.title}
        </div>
      )}
      {hasLayoutTarget && (
        <button
          onClick={() => onOpenLayout({ id: message.id, content: message.content })}
          style={layoutTriggerStyle}
        >
          <span style={{ fontSize: 12 }}>◫</span>
          排版
        </button>
      )}
    </div>
  );
}

function WaitingState({
  status,
  snapshot,
}: {
  status: string | null;
  snapshot: LoadingSnapshot | null;
}) {
  const active = snapshot ?? buildLoadingSnapshot([], status);
  return (
    <div style={waitingCardStyle}>
      <div style={waitingHeaderStyle}>
        <div style={waitingStatusStyle}>
          <span style={statusDotStyle} />
          {active.title}
        </div>
        <div style={loadingBarsStyle}>
          <span style={{ ...loadingBarStyle, animationDelay: "0ms" }} />
          <span style={{ ...loadingBarStyle, animationDelay: "180ms" }} />
          <span style={{ ...loadingBarStyle, animationDelay: "360ms" }} />
        </div>
      </div>
      <div style={waitingHintStyle}>{active.hint || status || "正在继续处理这条请求。"}</div>
      <div style={stepsWrapStyle}>
        {active.steps.map((step) => (
          <div
            key={step.key}
            style={{
              ...stepStyle,
              ...(step.state === "done"
                ? stepDoneStyle
                : step.state === "active"
                  ? stepActiveStyle
                  : stepPendingStyle),
            }}
          >
            <span
              style={{
                ...stepDotStyle,
                ...(step.state === "done"
                  ? stepDotDoneStyle
                  : step.state === "active"
                    ? stepDotActiveStyle
                    : stepDotPendingStyle),
              }}
            />
            {step.label}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ ...skeletonLineStyle, width: "72%" }} />
        <div style={{ ...skeletonLineStyle, width: "100%" }} />
        <div style={{ ...skeletonLineStyle, width: "86%" }} />
      </div>
      <div style={waitingFooterStyle}>先给结论，再展开细节和建议。</div>
    </div>
  );
}

function MiniLoadingCard({ snapshot }: { snapshot: LoadingSnapshot }) {
  return (
    <div style={miniLoadingCardStyle}>
      <div style={miniLoadingTopStyle}>
        <div style={miniLoadingTitleStyle}>
          <span style={statusDotStyle} />
          {snapshot.title}
        </div>
        <div style={miniLoadingHintStyle}>{snapshot.hint}</div>
      </div>
      <div style={miniStepsRowStyle}>
        {snapshot.steps.map((step) => (
          <span
            key={step.key}
            style={{
              ...miniStepChipStyle,
              ...(step.state === "done"
                ? miniStepDoneStyle
                : step.state === "active"
                  ? miniStepActiveStyle
                  : miniStepPendingStyle),
            }}
          >
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function buildLoadingSnapshot(events: ToolEvent[], assistantStatus: string | null): LoadingSnapshot {
  const relevantEvents = events.filter((event) => event.type !== "tool_requires_confirmation");
  const activeToolEvent = [...relevantEvents].reverse().find((event) => event.type === "tool_start");
  const latestToolName = activeToolEvent?.toolName;

  const toolDone = new Set(
    relevantEvents
      .filter((event) => event.type === "tool_result")
      .map((event) => event.toolName)
      .filter((toolName): toolName is string => Boolean(toolName))
  );

  const stageOrder = [
    { key: "understand", label: "理解问题" },
    { key: "retrieve", label: "检索资料" },
    { key: "compose", label: "组织答案" },
    { key: "generate", label: "生成内容" },
    { key: "review", label: "风控检查" },
    { key: "stream", label: "输出结果" },
  ];

  const activeStage = resolveActiveStage(latestToolName, assistantStatus);
  const activeMeta = getToolMeta(latestToolName, assistantStatus);

  return {
    title: activeMeta.title,
    hint: activeMeta.hint,
    steps: stageOrder.map((step) => ({
      key: step.key,
      label: step.label,
      state: stepState(step.key, activeStage, toolDone, assistantStatus),
    })),
  };
}

function resolveActiveStage(toolName?: string, assistantStatus?: string | null) {
  if (toolName === "search_hot_topics" || toolName === "search_koc_accounts" || toolName === "search_knowledge_base" || toolName === "analyze_journey_data") {
    return "retrieve";
  }
  if (toolName === "generate_topics") {
    return "compose";
  }
  if (toolName === "generate_article_draft" || toolName === "generate_full_article" || toolName === "revise_full_article") {
    return "generate";
  }
  if (toolName === "compliance_check") {
    return "review";
  }
  if (assistantStatus === "输出答案中") {
    return "stream";
  }
  if (assistantStatus === "组织回答中") {
    return "compose";
  }
  if (assistantStatus === "整理上下文中") {
    return "retrieve";
  }
  return "understand";
}

function stepState(
  stepKey: string,
  activeStage: string,
  toolDone: Set<string>,
  assistantStatus: string | null
): LoadingStep["state"] {
  const order = ["understand", "retrieve", "compose", "generate", "review", "stream"];
  const currentIndex = order.indexOf(activeStage);
  const stepIndex = order.indexOf(stepKey);

  if (stepKey === "review" && !toolDone.has("compliance_check") && activeStage !== "review") {
    return stepIndex < currentIndex ? "done" : "pending";
  }

  if (assistantStatus === "输出答案中" && stepKey === "stream") {
    return "active";
  }

  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function getToolMeta(toolName?: string, assistantStatus?: string | null) {
  switch (toolName) {
    case "search_hot_topics":
      return { title: "正在搜索热点", hint: "从近期内容里找最值得跟进的话题。" };
    case "search_koc_accounts":
      return { title: "正在搜索 KOC", hint: "筛选和当前赛道最相关的账号样本。" };
    case "search_knowledge_base":
      return { title: "正在检索知识库", hint: "从已同步文章里找能支撑答案的案例。" };
    case "analyze_journey_data":
      return { title: "正在分析旅程数据", hint: "总结爆款规律、账号特征和内容偏好。" };
    case "generate_topics":
      return { title: "正在组织选题", hint: "把检索到的信息压缩成可执行的方向。" };
    case "generate_article_draft":
      return { title: "正在生成骨架稿", hint: "先搭好结构，再填内容。" };
    case "generate_full_article":
      return { title: "正在生成完整稿", hint: "把结构扩成可读、可发的长文正文。" };
    case "revise_full_article":
      return { title: "正在修改完整稿", hint: "按你的要求调整语气、结构和表达。" };
    case "compliance_check":
      return { title: "正在做风控检查", hint: "检查标题、摘要、正文和 CTA 的风险点。" };
    default:
      if (assistantStatus === "输出答案中") {
        return { title: "正在输出答案", hint: "先把核心结论流式发出来。" };
      }
      if (assistantStatus === "组织回答中") {
        return { title: "正在组织回答", hint: "把线索压缩成更清晰的回答结构。" };
      }
      if (assistantStatus === "整理上下文中") {
        return { title: "正在整理上下文", hint: "结合当前对话和赛道背景继续处理。" };
      }
      return { title: "正在理解问题", hint: "先判断你想要的是分析、检索还是生成。" };
  }
}

function formatMessage(content: string): string {
  // Bold **text** → <strong>
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent);font-weight:500">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:11px;background:var(--accent-dim);color:var(--accent);padding:1px 5px;border-radius:3px">$1</code>');
}

function ToolTimeline({
  events,
  importingGhid,
  onImport,
}: {
  events: ToolEvent[];
  importingGhid: string | null;
  onImport: (ghid: string) => void;
}) {
  const getAccounts = (payload?: Record<string, unknown>) =>
    (payload?.accounts as RecommendedAccount[] | undefined) ?? [];
  const getKnowledgeArticles = (payload?: Record<string, unknown>) =>
    (payload?.articles as KnowledgeArticleHit[] | undefined) ?? [];
  const getGeneratedTopics = (payload?: Record<string, unknown>) =>
    (payload?.topics as GeneratedTopic[] | undefined) ?? [];
  const getPayloadText = (payload: Record<string, unknown> | undefined, key: string) =>
    typeof payload?.[key] === "string" ? (payload[key] as string) : "";
  const getPayloadFlag = (payload: Record<string, unknown> | undefined, key: string) =>
    payload?.[key] === true;

  return (
    <div
      style={{
        maxWidth: "76%",
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--bg-base)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        Agent Trace
      </div>
      {events.map((event) => (
        <div key={event.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {toolEventText(event)}
          </div>
          {getAccounts(event.payload).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {getAccounts(event.payload).map((account) => (
                <div
                  key={account.ghid}
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
                        {account.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        粉丝 {fmtCount(account.fans)} · 平均阅读 {fmtCount(account.avg_top_read)}
                      </div>
                    </div>
                    <button
                      onClick={() => onImport(account.ghid)}
                      disabled={importingGhid === account.ghid}
                      style={miniButtonStyle}
                    >
                      {importingGhid === account.ghid ? "导入中..." : "导入"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {getKnowledgeArticles(event.payload).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {getKnowledgeArticles(event.payload).map((article) => (
                <div
                  key={article.id}
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
                    {article.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: article.excerpt ? 6 : 0 }}>
                    {article.account_name} · 阅读 {fmtCount(article.read_count)}
                  </div>
                  {article.excerpt && (
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      {article.excerpt}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {getGeneratedTopics(event.payload).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {getGeneratedTopics(event.payload).map((topic) => (
                <div
                  key={`${topic.index}-${topic.title}`}
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
                    {topic.index}. {topic.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {topic.angle}
                  </div>
                </div>
              ))}
            </div>
          )}
          {event.type === "tool_requires_confirmation" &&
            getPayloadText(event.payload, "ghid") &&
            !getPayloadFlag(event.payload, "imported") && (
            <div
              style={{
                padding: "10px 12px",
                background: "var(--bg-surface)",
                border: "1px solid rgba(200,150,90,0.25)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.6 }}>
                推荐导入 {getPayloadText(event.payload, "account_name") || getPayloadText(event.payload, "ghid")}
                {getPayloadText(event.payload, "reason") ? `：${getPayloadText(event.payload, "reason")}` : ""}
              </div>
              <button
                onClick={() => onImport(getPayloadText(event.payload, "ghid"))}
                disabled={importingGhid === getPayloadText(event.payload, "ghid")}
                style={miniButtonStyle}
              >
                {importingGhid === getPayloadText(event.payload, "ghid") ? "导入中..." : "确认导入"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function toolEventText(event: ToolEvent) {
  const topicCount = Array.isArray(event.payload?.topics) ? event.payload.topics.length : 0;
  const accountCount = Array.isArray(event.payload?.accounts) ? event.payload.accounts.length : 0;

  if (event.type === "tool_start") {
    return `正在${event.label}...`;
  }
  if (event.type === "tool_error") {
    return `${event.label}失败：${event.error}`;
  }
  if (event.type === "tool_requires_confirmation") {
    return `${event.label}需要你确认后再执行。`;
  }
  if (event.type === "tool_result" && event.toolName === "search_hot_topics") {
    return `已找到 ${topicCount} 条近期热点。`;
  }
  if (event.type === "tool_result" && event.toolName === "search_koc_accounts") {
    return `已找到 ${accountCount} 个可跟踪的 KOC。`;
  }
  if (event.type === "tool_result" && event.toolName === "analyze_journey_data") {
    return `已分析 ${event.payload?.article_count ?? 0} 篇文章和 ${event.payload?.koc_count ?? 0} 个 KOC。`;
  }
  if (event.type === "tool_result" && event.toolName === "search_knowledge_base") {
    const articleCount = Array.isArray(event.payload?.articles) ? event.payload.articles.length : 0;
    return `知识库命中 ${articleCount} 篇相关文章。`;
  }
  if (event.type === "tool_result" && event.toolName === "generate_topics") {
    return `已生成 ${topicCount} 个候选选题。你可以直接回复“第一个可以”这种话来确认。`;
  }
  if (event.type === "tool_result" && event.toolName === "generate_article_draft") {
    return "已生成一版公众号 Markdown 骨架稿。";
  }
  if (event.type === "tool_result" && event.toolName === "generate_full_article") {
    return "已生成一版可发布级公众号完整初稿。";
  }
  if (event.type === "tool_result" && event.toolName === "compliance_check") {
    return `已完成风控检查，当前建议：${event.payload?.publish_recommendation || "建议修改后发布"}。`;
  }
  if (event.type === "tool_result" && event.toolName === "revise_full_article") {
    return "已按你的要求修改完整稿。";
  }
  if (event.type === "tool_result" && event.payload?.imported) {
    return `已导入 ${event.payload.account_name || event.payload.ghid}，同步 ${event.payload.articleCount ?? 0} 篇文章。`;
  }
  return `${event.label}已完成。`;
}

function fmtCount(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}

// ---- Tool button ----

function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        fontSize: 11,
        color: "var(--text-secondary)",
        cursor: "pointer",
        fontFamily: "var(--font-body)",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

// ---- Header stat ----

function HeaderStat({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)" }}>
      {live !== undefined && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: live ? "#4CAF50" : "var(--accent)",
            animation: "pulse 2s infinite",
          }}
        />
      )}
      {children}
    </div>
  );
}

// ---- Styles ----

const headerStyle: React.CSSProperties = {
  padding: "14px 28px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const messagesStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "32px 28px",
};

const inputAreaStyle: React.CSSProperties = {
  padding: "14px 28px 20px",
  borderTop: "1px solid var(--border)",
  flexShrink: 0,
};

const miniButtonStyle: React.CSSProperties = {
  padding: "7px 12px",
  background: "var(--accent)",
  border: "none",
  borderRadius: 6,
  color: "var(--bg-void)",
  fontSize: 11,
  fontFamily: "var(--font-body)",
  cursor: "pointer",
  flexShrink: 0,
};

const layoutTriggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 2,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(200,150,90,0.28)",
  background: "var(--accent-dim)",
  color: "var(--accent)",
  fontSize: 11,
  fontFamily: "var(--font-body)",
  cursor: "pointer",
};

const statusPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  marginTop: 2,
  padding: "4px 9px",
  borderRadius: 999,
  background: "var(--bg-base)",
  border: "1px solid var(--border)",
  color: "var(--text-tertiary)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const waitingStatusStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  alignSelf: "flex-start",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 999,
  background: "var(--accent-dim)",
  color: "var(--accent)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const skeletonLineStyle: React.CSSProperties = {
  height: 10,
  borderRadius: 999,
  background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
};

const waitingHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: 1.65,
};

const waitingCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 280,
};

const waitingHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const loadingBarsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 4,
  height: 18,
};

const loadingBarStyle: React.CSSProperties = {
  width: 4,
  height: 14,
  borderRadius: 999,
  background: "linear-gradient(180deg, rgba(200,150,90,0.95), rgba(200,150,90,0.28))",
  animation: "nicheLoadingBar 900ms ease-in-out infinite",
};

const stepsWrapStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const stepStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  fontSize: 11,
  lineHeight: 1,
};

const stepPendingStyle: React.CSSProperties = {
  color: "var(--text-tertiary)",
  background: "rgba(255,255,255,0.02)",
};

const stepActiveStyle: React.CSSProperties = {
  color: "var(--accent)",
  borderColor: "rgba(200,150,90,0.28)",
  background: "rgba(200,150,90,0.08)",
};

const stepDoneStyle: React.CSSProperties = {
  color: "#B7C8AE",
  borderColor: "rgba(135, 176, 118, 0.18)",
  background: "rgba(135, 176, 118, 0.08)",
};

const stepDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  flexShrink: 0,
};

const stepDotPendingStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.18)",
};

const stepDotActiveStyle: React.CSSProperties = {
  background: "var(--accent)",
  boxShadow: "0 0 0 4px rgba(200,150,90,0.12)",
};

const stepDotDoneStyle: React.CSSProperties = {
  background: "#87B076",
};

const waitingFooterStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-tertiary)",
  lineHeight: 1.6,
};

const miniLoadingCardStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(200,150,90,0.06)",
  border: "1px solid rgba(200,150,90,0.18)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const miniLoadingTopStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const miniLoadingTitleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--accent)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const miniLoadingHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const miniStepsRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const miniStepChipStyle: React.CSSProperties = {
  padding: "4px 7px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  fontSize: 10,
  lineHeight: 1,
};

const miniStepPendingStyle: React.CSSProperties = {
  color: "var(--text-tertiary)",
};

const miniStepActiveStyle: React.CSSProperties = {
  color: "var(--accent)",
  borderColor: "rgba(200,150,90,0.28)",
  background: "rgba(200,150,90,0.08)",
};

const miniStepDoneStyle: React.CSSProperties = {
  color: "#B7C8AE",
  borderColor: "rgba(135,176,118,0.18)",
  background: "rgba(135,176,118,0.08)",
};

const statusDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--accent)",
  boxShadow: "0 0 0 4px rgba(200,150,90,0.12)",
  flexShrink: 0,
};
