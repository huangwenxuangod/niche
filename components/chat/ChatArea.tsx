"use client";

import { useState, useRef, useEffect } from "react";
import type { Message, Journey } from "@/lib/data";
import { AccountAnalysisModal } from "./AccountAnalysisModal";

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

export function ChatArea({ conversationId, journey, initialMessages, kocCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [importingGhid, setImportingGhid] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolEvents]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");
    setToolEvents([]);

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

    const assistantId = crypto.randomUUID();
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
                assistantContent += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantContent } : m
                  )
                );
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

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const isUser = message.role === "user";
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
        <span
          dangerouslySetInnerHTML={{
            __html: formatMessage(message.content),
          }}
        />
        {isStreaming && message.content && <span className="streaming-cursor" />}
      </div>
    </div>
  );
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
