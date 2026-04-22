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

export function ChatArea({ conversationId, journey, initialMessages, kocCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    setInput("");

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
              if (parsed.text) {
                assistantContent += parsed.text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantContent } : m
                  )
                );
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
