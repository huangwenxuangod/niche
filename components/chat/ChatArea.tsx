"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bubble,
  Prompts,
  Sender,
  Welcome,
  type BubbleItemType,
} from "@ant-design/x";
import {
  AppstoreOutlined,
  EditOutlined,
  FireOutlined,
  LoadingOutlined,
  RadarChartOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { Button, Space, Tag } from "antd";
import type { Message, Journey } from "@/lib/data";
import { AccountAnalysisModal } from "./AccountAnalysisModal";
import { ArticleLayoutPanel } from "./ArticleLayoutPanel";
import { extractArticleFromAssistantMessage } from "@/lib/article-layout";
import KOCRecommendationModal from "@/components/KOCRecommendationModal";
import { toast } from "@/lib/toast";

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

type LoadingStep = {
  key: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
};

type LoadingSnapshot = {
  title: string;
  hint: string;
  steps: LoadingStep[];
};

const QUICK_PROMPTS = [
  { key: "topic", label: "给我 3 个涨粉选题", icon: <FireOutlined /> },
  { key: "pattern", label: "分析对标账号增长规律", icon: <RadarChartOutlined /> },
  { key: "schedule", label: "什么时候发布更容易起量", icon: <ReadOutlined /> },
  { key: "competitor", label: "帮我拆解对标账号标题", icon: <EditOutlined /> },
];

export function ChatArea({ conversationId, journey, initialMessages, kocCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [recommendedArticles, setRecommendedArticles] = useState<
    Array<{
      url: string;
      mp_nickname: string;
      title: string;
      pub_time: string;
      wxid: string;
      hot: number;
      read_num: number;
      fans: number;
    }>
  >([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [layoutTarget, setLayoutTarget] = useState<{ id: string; content: string } | null>(null);
  const recommendationToastShown = useRef(false);
  const loadingSnapshot = buildLoadingSnapshot(toolEvents, assistantStatus);

  useEffect(() => {
    if (kocCount > 0 || initialMessages.length > 0 || recommendationToastShown.current) {
      return;
    }

    let aborted = false;
    recommendationToastShown.current = true;

    async function preloadRecommendations() {
      try {
        const res = await fetch(`/api/journeys/${journey.id}/hot-articles`);
        if (!res.ok) return;
        const data = await res.json();
        if (aborted || !Array.isArray(data.articles) || data.articles.length === 0) {
          return;
        }

        setRecommendedArticles(data.articles);
        toast("已为你准备好推荐对标账号", {
          description: `基于当前赛道找到 ${data.articles.length} 个可参考账号，随时可以补充到对标内容库。`,
          action: {
            label: "查看推荐",
            onClick: () => setShowRecommendations(true),
          },
        });
      } catch {
        // Keep this silently backgrounded.
      }
    }

    preloadRecommendations();

    return () => {
      aborted = true;
    };
  }, [initialMessages.length, journey.id, kocCount]);

  const bubbleItems = useMemo<BubbleItemType[]>(() => {
    const items: BubbleItemType[] = [];
    const latestMessageId = messages[messages.length - 1]?.id;

    messages.forEach((message) => {
      const isStreamingAssistant =
        streaming && latestMessageId === message.id && message.role === "assistant";
      const isLatestAssistant = latestMessageId === message.id && message.role === "assistant";

      const hasLayoutTarget =
        message.role === "assistant" &&
        !isStreamingAssistant &&
        extractArticleFromAssistantMessage(message.content) !== null;

      items.push({
        key: message.id,
        role: message.role === "user" ? "user" : "assistant",
        placement: message.role === "user" ? "end" : "start",
        content: <div className="msg-prose" dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }} />,
        streaming: isStreamingAssistant,
        typing: false,
        variant: message.role === "user" ? "filled" : "borderless",
        shape: "corner",
        footer:
          message.role === "assistant" ? (
            <AssistantFooter
              isLatest={isLatestAssistant}
              isStreaming={isStreamingAssistant}
              loadingSnapshot={loadingSnapshot}
              toolEvents={toolEvents}
              hasLayoutTarget={hasLayoutTarget}
              onOpenLayout={() => setLayoutTarget({ id: message.id, content: message.content })}
            />
          ) : undefined,
      });
    });

    return items;
  }, [messages, streaming, toolEvents, loadingSnapshot]);

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

    const assistantId: string = crypto.randomUUID();
    let currentAssistantId: string = assistantId;
    let assistantContent = "";

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        conversation_id: conversationId,
        role: "assistant",
        content: "",
        tool_used: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Stream failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "text" && parsed.text) {
              if (!assistantContent) {
                setAssistantStatus("输出答案中");
              }
              assistantContent += parsed.text;
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === currentAssistantId
                    ? { ...message, content: assistantContent }
                    : message
                )
              );
            } else if (parsed.type === "assistant_status" && parsed.label) {
              setAssistantStatus(String(parsed.label));
            } else if (parsed.type === "assistant_message" && parsed.messageId) {
              const nextId = String(parsed.messageId);
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === currentAssistantId ? { ...message, id: nextId } : message
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
          } catch {
            // Ignore malformed chunks and keep stream alive.
          }
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? { ...message, content: "抱歉，出现了一点问题，请重试。" }
            : message
        )
      );
    } finally {
      setStreaming(false);
      setAssistantStatus(null);
    }
  }

  const promptItems = QUICK_PROMPTS.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
  }));

  return (
    <>
      <div style={chatPageStyle}>
        <div style={chatHeaderStyle}>
          <div style={chatHeaderInnerStyle}>
            <div>
              <div style={headerEyebrowStyle}>Niche Chat</div>
              <div style={headerTitleStyle}>
                {journey.platform === "wechat_mp" ? "公众号" : journey.platform} · {journey.niche_level2}
              </div>
            </div>
            <Space size={8}>
              <Tag bordered={false} style={headerTagStyle}>
                {journey.knowledge_initialized ? "对标内容库已就绪" : "对标内容库初始化中"}
              </Tag>
              <Tag bordered={false} style={headerTagStyle}>
                {kocCount} 个对标账号
              </Tag>
            </Space>
          </div>
        </div>

        <div style={chatBodyStyle}>
          <div style={contentShellStyle}>
            {messages.length === 0 ? (
              <div style={welcomeWrapStyle}>
                <Welcome
                  variant="borderless"
                  icon={<AppstoreOutlined style={{ color: "var(--accent)" }} />}
                  title={
                    <span>
                      从0到1最缺的不是努力，是一个真正懂增长的内容教练。
                    </span>
                  }
                  description={"Niche 面向冷启动 KOC，用 AI 帮你找方向、拆对标、补差距，并直接产出可发布内容。社媒通用，公众号先落地。"}
                  styles={{
                    root: { padding: 0, background: "transparent" },
                    title: { color: "var(--text-primary)", fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1.08, maxWidth: 680 },
                    description: { color: "var(--text-secondary)", fontSize: 14, maxWidth: 640, lineHeight: 1.75 },
                  }}
                />
                <Prompts
                  title="增长起点"
                  items={promptItems}
                  wrap
                  styles={{
                    root: { width: "100%" },
                    title: { color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 },
                    list: { gap: 12 },
                    item: {
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--border)",
                      borderRadius: 18,
                      color: "var(--text-secondary)",
                      padding: "12px 14px",
                    },
                  }}
                  onItemClick={({ data }) => {
                    if (data.label) {
                      sendMessage(String(data.label));
                    }
                  }}
                />
              </div>
            ) : (
              <Bubble.List
                items={bubbleItems}
                autoScroll
                role={{
                  user: {
                    placement: "end",
                    variant: "filled",
                    styles: {
                      content: {
                        background: "rgba(255,255,255,0.038)",
                        color: "var(--text-primary)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 18,
                        padding: "12px 15px",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
                        fontSize: 15,
                        lineHeight: 1.7,
                      },
                    },
                  },
                  assistant: {
                    placement: "start",
                    variant: "borderless",
                    styles: {
                      content: {
                        background: "transparent",
                        color: "var(--text-primary)",
                        border: "none",
                        borderRadius: 0,
                        padding: "0 0 4px",
                      },
                      footer: {
                        marginTop: 10,
                      },
                    },
                  },
                  system: {
                    placement: "start",
                    variant: "borderless",
                    styles: {
                      content: {
                        background: "transparent",
                        padding: 0,
                        border: "none",
                      },
                    },
                  },
                }}
                styles={{
                  root: { height: "100%" },
                  scroll: { paddingRight: 4, paddingBottom: 18 },
                  bubble: { maxWidth: "100%" },
                }}
              />
            )}
          </div>
        </div>

        <div style={senderWrapStyle}>
          <div style={senderInnerStyle}>
            {messages.length > 0 && (
              <Prompts
                items={[
                  { key: "analysis", icon: <RadarChartOutlined />, label: "增长分析" },
                  { key: "hot", icon: <FireOutlined />, label: "增长机会搜索" },
                ]}
                styles={{
                  list: { gap: 8 },
                  item: {
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    color: "var(--text-secondary)",
                    padding: "8px 12px",
                  },
                }}
                onItemClick={({ data }) => {
                  if (data.key === "analysis") {
                    setShowAnalysis(true);
                  } else if (data.key === "hot") {
                    sendMessage("帮我搜索当前赛道最值得跟进的增长机会，列出 3 条");
                  }
                }}
              />
            )}
            <Sender
              value={input}
              onChange={(value) => setInput(value)}
              onSubmit={(value) => sendMessage(value)}
              loading={streaming}
              placeholder="告诉我你的方向、对标账号或增长问题..."
              submitType="enter"
              autoSize={{ minRows: 1, maxRows: 6 }}
              footer={() => (
                <div style={senderFooterStyle}>
                  <span style={{ color: "var(--text-tertiary)" }}>Enter 发送，Shift + Enter 换行</span>
                </div>
              )}
              styles={{
                root: {
                  background: "rgba(23,23,21,0.94)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 26,
                  padding: "12px 12px 10px",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.02)",
                },
                input: {
                  color: "var(--text-primary)",
                  fontSize: 15,
                  lineHeight: 1.75,
                },
                footer: {
                  paddingTop: 8,
                },
                suffix: {
                  alignSelf: "flex-end",
                },
              }}
            />
          </div>
        </div>
      </div>

      {showAnalysis && (
        <AccountAnalysisModal
          onClose={() => setShowAnalysis(false)}
          onResult={(text) => {
            setShowAnalysis(false);
            sendMessage(text);
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

      {showRecommendations && (
        <KOCRecommendationModal
          journeyId={journey.id}
          conversationId={conversationId}
          initialArticles={recommendedArticles}
          autoSearch={recommendedArticles.length === 0}
          onImportComplete={() => {
            setShowRecommendations(false);
            toast.success("对标账号已开始导入，后台会继续同步内容。");
          }}
          onSkip={() => setShowRecommendations(false)}
        />
      )}
    </>
  );
}

function AssistantFooter({
  isLatest,
  isStreaming,
  loadingSnapshot,
  toolEvents,
  hasLayoutTarget,
  onOpenLayout,
}: {
  isLatest: boolean;
  isStreaming: boolean;
  loadingSnapshot: LoadingSnapshot;
  toolEvents: ToolEvent[];
  hasLayoutTarget: boolean;
  onOpenLayout: () => void;
}) {
  const shouldShowProcess = isLatest && (isStreaming || toolEvents.length > 0);
  const summary = buildToolSummary(toolEvents);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let timer: number | undefined;

    if (isStreaming) {
      timer = window.setTimeout(() => {
        setCollapsed(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    if (shouldShowProcess) {
      timer = window.setTimeout(() => {
        setCollapsed(true);
      }, 1600);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isStreaming, shouldShowProcess, summary]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {shouldShowProcess && (
        <div style={collapsed ? miniProcessCollapsedStyle : miniProcessLineStyle}>
          <div style={miniStateTitleStyle}>
            {isStreaming ? <LoadingOutlined /> : <span style={miniDoneDotStyle} />}
            {isStreaming ? loadingSnapshot.title : summary}
          </div>
          {isStreaming ? <div style={miniStateHintStyle}>{loadingSnapshot.hint}</div> : null}
        </div>
      )}
      {hasLayoutTarget && (
        <Button
          type="default"
          icon={<EditOutlined />}
          onClick={onOpenLayout}
          style={layoutActionButtonStyle}
        >
          排版
        </Button>
      )}
    </div>
  );
}

function buildToolSummary(events: ToolEvent[]) {
  const latestResult = [...events].reverse().find((event) => event.type === "tool_result");
  if (!latestResult) return "已完成这轮处理";

  const payload = latestResult.payload ?? {};

  if (latestResult.toolName === "search_hot_topics" && Array.isArray(payload.topics)) {
    return `已搜索热点，找到 ${payload.topics.length} 条候选`;
  }
  if (latestResult.toolName === "search_knowledge_base" && Array.isArray(payload.articles)) {
    return `已检索知识库，命中 ${payload.articles.length} 篇内容`;
  }
  if (latestResult.toolName === "generate_topics" && Array.isArray(payload.topics)) {
    return `已生成 ${payload.topics.length} 个选题方向`;
  }
  if (latestResult.toolName === "generate_full_article") {
    return "已生成完整稿";
  }
  if (latestResult.toolName === "generate_article_draft") {
    return "已生成骨架稿";
  }
  if (latestResult.toolName === "compliance_check") {
    return "已完成合规检查";
  }

  return `已完成${latestResult.label}`;
}

function buildLoadingSnapshot(events: ToolEvent[], assistantStatus: string | null): LoadingSnapshot {
  const activeToolEvent = [...events].reverse().find((event) => event.type === "tool_start");
  const latestToolName = activeToolEvent?.toolName;
  const activeStage = resolveActiveStage(latestToolName, assistantStatus);
  const meta = getToolMeta(latestToolName, assistantStatus);
  const order = ["understand", "retrieve", "compose", "generate", "review", "stream"];

  return {
    title: meta.title,
    hint: meta.hint,
    steps: [
      { key: "understand", label: "理解问题", state: stageState("understand", activeStage, order) },
      { key: "retrieve", label: "检索资料", state: stageState("retrieve", activeStage, order) },
      { key: "compose", label: "组织答案", state: stageState("compose", activeStage, order) },
      { key: "generate", label: "生成内容", state: stageState("generate", activeStage, order) },
      { key: "review", label: "风控检查", state: stageState("review", activeStage, order) },
      { key: "stream", label: "输出结果", state: stageState("stream", activeStage, order) },
    ],
  };
}

function stageState(
  step: string,
  activeStage: string,
  order: string[]
): LoadingStep["state"] {
  const stepIndex = order.indexOf(step);
  const activeIndex = order.indexOf(activeStage);
  if (stepIndex < activeIndex) return "done";
  if (stepIndex === activeIndex) return "active";
  return "pending";
}

function resolveActiveStage(toolName?: string, assistantStatus?: string | null) {
  if (toolName === "search_hot_topics" || toolName === "search_knowledge_base" || toolName === "analyze_journey_data") {
    return "retrieve";
  }
  if (toolName === "generate_topics") return "compose";
  if (toolName === "generate_article_draft" || toolName === "generate_full_article" || toolName === "revise_full_article") return "generate";
  if (toolName === "compliance_check") return "review";
  if (assistantStatus === "输出答案中") return "stream";
  if (assistantStatus === "组织回答中") return "compose";
  if (assistantStatus === "整理上下文中") return "retrieve";
  return "understand";
}

function getToolMeta(toolName?: string, assistantStatus?: string | null) {
  switch (toolName) {
    case "search_hot_topics":
      return { title: "搜索热点中", hint: "从近期内容里找最值得跟进的话题。" };
    case "search_knowledge_base":
      return { title: "检索知识库中", hint: "从已同步文章里找能支撑答案的案例。" };
    case "analyze_journey_data":
      return { title: "分析数据中", hint: "总结爆款规律、账号特征和内容偏好。" };
    case "generate_topics":
      return { title: "生成选题中", hint: "把检索到的信息压缩成可执行的方向。" };
    case "generate_article_draft":
      return { title: "生成骨架稿中", hint: "先搭好结构，再填内容。" };
    case "generate_full_article":
      return { title: "生成完整稿中", hint: "把结构扩成可读、可发的长文正文。" };
    case "revise_full_article":
      return { title: "修改完整稿中", hint: "按你的要求调整语气、结构和表达。" };
    case "compliance_check":
      return { title: "风控检查中", hint: "检查标题、摘要、正文和 CTA 的风险点。" };
    default:
      if (assistantStatus === "输出答案中") return { title: "输出答案中", hint: "先把核心结论流式发出来。" };
      if (assistantStatus === "组织回答中") return { title: "组织回答中", hint: "把线索压缩成更清晰的回答结构。" };
      if (assistantStatus === "整理上下文中") return { title: "整理上下文中", hint: "结合当前对话和赛道背景继续处理。" };
      return { title: "理解问题中", hint: "先判断你想要的是分析、检索还是生成。" };
  }
}

function formatMessage(content: string): string {
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent);font-weight:500">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:11px;background:var(--accent-dim);color:var(--accent);padding:1px 5px;border-radius:3px">$1</code>')
    .replace(/\n/g, "<br />");
}

const chatPageStyle: React.CSSProperties = {
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  background:
    "radial-gradient(circle at top left, rgba(200,150,90,0.10), transparent 34%), var(--bg-void)",
};

const chatHeaderStyle: React.CSSProperties = {
  padding: "24px 36px 12px",
  borderBottom: "1px solid var(--border)",
};

const chatHeaderInnerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 1100,
  margin: "0 auto",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 20,
};

const headerEyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 8,
};

const headerTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 24,
  lineHeight: 1.2,
  color: "var(--text-primary)",
};

const headerTagStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  borderRadius: 999,
  paddingInline: 10,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
};

const chatBodyStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "hidden",
  padding: "28px 36px 12px",
};

const contentShellStyle: React.CSSProperties = {
  height: "100%",
  maxWidth: 920,
  margin: "0 auto",
};

const welcomeWrapStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 26,
  maxWidth: 720,
};

const senderWrapStyle: React.CSSProperties = {
  padding: "8px 36px 28px",
  borderTop: "1px solid var(--border)",
};

const senderInnerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 920,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const senderFooterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  fontSize: 11,
};

const miniProcessLineStyle: React.CSSProperties = {
  maxWidth: 560,
  padding: "2px 0",
};

const miniProcessCollapsedStyle: React.CSSProperties = {
  width: "fit-content",
  maxWidth: 420,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.05)",
};

const miniStateTitleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "var(--accent)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const miniStateHintStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const miniDoneDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--accent)",
  boxShadow: "0 0 0 4px rgba(200,150,90,0.12)",
};

const layoutActionButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  width: "fit-content",
  borderColor: "rgba(200,150,90,0.25)",
  color: "var(--accent)",
  background: "var(--accent-dim)",
};
