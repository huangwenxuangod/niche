"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bubble,
  Prompts,
  Sender,
  ThoughtChain,
  Welcome,
  type BubbleItemType,
  type ThoughtChainItemType,
} from "@ant-design/x";
import {
  AppstoreOutlined,
  EditOutlined,
  FireOutlined,
  LoadingOutlined,
  RadarChartOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { Button, Card, Space, Tag } from "antd";
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
  state: "pending" | "active" | "done" | "error";
};

type LoadingSnapshot = {
  title: string;
  hint: string;
  steps: LoadingStep[];
};

const QUICK_PROMPTS = [
  { key: "topic", label: "给我今日 3 个选题", icon: <FireOutlined /> },
  { key: "pattern", label: "分析同赛道爆款规律", icon: <RadarChartOutlined /> },
  { key: "schedule", label: "最佳发布时间是什么时候", icon: <ReadOutlined /> },
  { key: "competitor", label: "帮我拆解竞品标题", icon: <EditOutlined /> },
];

export function ChatArea({ conversationId, journey, initialMessages, kocCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [importingGhid, setImportingGhid] = useState<string | null>(null);
  const [layoutTarget, setLayoutTarget] = useState<{ id: string; content: string } | null>(null);
  const loadingSnapshot = buildLoadingSnapshot(toolEvents, assistantStatus);
  const thoughtItems = buildThoughtChainItems(toolEvents, loadingSnapshot);

  const importRecommendedKoc = useCallback(async (ghid: string) => {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
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
  }, [journey.id]);

  const bubbleItems = useMemo<BubbleItemType[]>(() => {
    const items: BubbleItemType[] = [];
    const latestMessageId = messages[messages.length - 1]?.id;

    messages.forEach((message) => {
      const isStreamingAssistant =
        streaming && latestMessageId === message.id && message.role === "assistant";
      const isLatestAssistant = latestMessageId === message.id && message.role === "assistant";

      if (
        isLatestAssistant &&
        toolEvents.length > 0
      ) {
        items.push({
          key: `tool-trace-${message.id}`,
          role: "system",
          content: (
            <ToolTracePanel
              events={toolEvents}
              importingGhid={importingGhid}
              onImport={importRecommendedKoc}
              thoughtItems={thoughtItems}
            />
          ),
        });
      }

      const hasLayoutTarget =
        message.role === "assistant" &&
        !isStreamingAssistant &&
        extractArticleFromAssistantMessage(message.content) !== null;

      items.push({
        key: message.id,
        role: message.role === "user" ? "user" : "assistant",
        placement: message.role === "user" ? "end" : "start",
        content:
          isStreamingAssistant && !message.content ? (
            <WaitingState snapshot={loadingSnapshot} thoughtItems={thoughtItems} />
          ) : (
            <div className="msg-prose" dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }} />
          ),
        streaming: isStreamingAssistant,
        typing: false,
        variant: message.role === "user" ? "filled" : "borderless",
        shape: "corner",
        footer:
          message.role === "assistant" ? (
            <AssistantFooter
              isStreaming={isStreamingAssistant}
              loadingSnapshot={loadingSnapshot}
              thoughtItems={thoughtItems}
              hasLayoutTarget={hasLayoutTarget}
              onOpenLayout={() => setLayoutTarget({ id: message.id, content: message.content })}
            />
          ) : undefined,
      });
    });

    return items;
  }, [messages, streaming, toolEvents, thoughtItems, loadingSnapshot, importingGhid, importRecommendedKoc]);

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
                {journey.knowledge_initialized ? "知识库已同步" : "初始化中"}
              </Tag>
              <Tag bordered={false} style={headerTagStyle}>
                {kocCount} KOC
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
                      今天想先解决什么问题？
                    </span>
                  }
                  description={`${journey.niche_level2} 赛道的知识库、热点和选题能力都已就绪。你可以直接发问，也可以从下面的快捷入口开始。`}
                  styles={{
                    root: { padding: 0, background: "transparent" },
                    title: { color: "var(--text-primary)", fontFamily: "var(--font-display)", fontSize: 36, lineHeight: 1.08, maxWidth: 680 },
                    description: { color: "var(--text-secondary)", fontSize: 14, maxWidth: 640, lineHeight: 1.75 },
                  }}
                />
                <Prompts
                  title="快速开始"
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
                        background: "rgba(255,255,255,0.045)",
                        color: "var(--text-primary)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 20,
                        padding: "16px 18px",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
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
                  { key: "analysis", icon: <RadarChartOutlined />, label: "账号分析" },
                  { key: "hot", icon: <FireOutlined />, label: "今日热点" },
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
                    sendMessage("帮我搜索今日赛道最新热点，列出 3 条");
                  }
                }}
              />
            )}
            <Sender
              value={input}
              onChange={(value) => setInput(value)}
              onSubmit={(value) => sendMessage(value)}
              loading={streaming}
              placeholder="问我任何关于这个赛道的事..."
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
    </>
  );
}

function AssistantFooter({
  isStreaming,
  loadingSnapshot,
  thoughtItems,
  hasLayoutTarget,
  onOpenLayout,
}: {
  isStreaming: boolean;
  loadingSnapshot: LoadingSnapshot;
  thoughtItems: ThoughtChainItemType[];
  hasLayoutTarget: boolean;
  onOpenLayout: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {isStreaming && (
        <div style={miniThoughtWrapStyle}>
          <div style={miniStateTitleStyle}>
            <LoadingOutlined />
            {loadingSnapshot.title}
          </div>
          <div style={miniStateHintStyle}>{loadingSnapshot.hint}</div>
          <ThoughtChain
            items={thoughtItems}
            styles={{
              root: { marginTop: 10 },
              item: { paddingBottom: 6 },
            }}
          />
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

function WaitingState({
  snapshot,
  thoughtItems,
}: {
  snapshot: LoadingSnapshot;
  thoughtItems: ThoughtChainItemType[];
}) {
  return (
    <div style={waitingCardStyle}>
      <div style={waitingTopStyle}>
        <Tag bordered={false} style={waitingTagStyle}>
          <LoadingOutlined />
          {snapshot.title}
        </Tag>
      </div>
      <div style={waitingHintStyle}>{snapshot.hint}</div>
      <ThoughtChain
        items={thoughtItems}
        styles={{
          root: { marginTop: 2 },
          item: { paddingBottom: 10 },
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ ...skeletonLineStyle, width: "68%" }} />
        <div style={{ ...skeletonLineStyle, width: "100%" }} />
        <div style={{ ...skeletonLineStyle, width: "84%" }} />
      </div>
    </div>
  );
}

function ToolTracePanel({
  events,
  importingGhid,
  onImport,
  thoughtItems,
}: {
  events: ToolEvent[];
  importingGhid: string | null;
  onImport: (ghid: string) => void;
  thoughtItems: ThoughtChainItemType[];
}) {
  const isRunning = thoughtItems.some((item) => item.status === "loading");
  const [expanded, setExpanded] = useState(false);
  const accounts =
    events.flatMap((event) => (event.payload?.accounts as RecommendedAccount[] | undefined) ?? []);
  const articles =
    events.flatMap((event) => (event.payload?.articles as KnowledgeArticleHit[] | undefined) ?? []);
  const topics =
    events.flatMap((event) => (event.payload?.topics as GeneratedTopic[] | undefined) ?? []);
  const pendingImport = events.find((event) => event.type === "tool_requires_confirmation");
  const pendingPayload = (pendingImport?.payload ?? null) as Record<string, unknown> | null;
  const summary = buildTraceSummary({ accounts, articles, topics, pendingPayload, thoughtItems });
  const displayExpanded = isRunning || expanded;

  return (
    <div style={toolPanelCardStyle}>
      <div style={traceHeaderStyle}>
        <div>
          <div style={toolPanelTitleStyle}>Agent Trace</div>
          {!displayExpanded && <div style={traceSummaryStyle}>{summary}</div>}
        </div>
        {!isRunning && (
          <Button
            size="small"
            type="text"
            onClick={() => setExpanded((value) => !value)}
            style={traceToggleStyle}
          >
            {displayExpanded ? "收起" : "展开"}
          </Button>
        )}
      </div>
      {displayExpanded && (
        <ThoughtChain
          items={thoughtItems}
          styles={{
            root: { marginBottom: 8 },
            item: { paddingBottom: 4 },
          }}
        />
      )}

      {displayExpanded && accounts.length > 0 && (
        <div style={toolSectionStyle}>
          {accounts.map((account) => (
            <Card key={account.ghid} size="small" style={traceItemCardStyle}>
              <div style={traceCardHeaderStyle}>
                <div>
                  <div style={traceItemTitleStyle}>{account.name}</div>
                  <div style={traceItemMetaStyle}>
                    粉丝 {fmtCount(account.fans)} · 平均阅读 {fmtCount(account.avg_top_read)}
                  </div>
                </div>
                <Button
                  size="small"
                  type="primary"
                  loading={importingGhid === account.ghid}
                  onClick={() => onImport(account.ghid)}
                >
                  导入
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {displayExpanded && articles.length > 0 && (
        <div style={toolSectionStyle}>
          {articles.map((article) => (
            <Card key={article.id} size="small" style={traceItemCardStyle}>
              <div style={traceItemTitleStyle}>{article.title}</div>
              <div style={traceItemMetaStyle}>
                {article.account_name} · 阅读 {fmtCount(article.read_count)}
              </div>
              {article.excerpt && <div style={traceExcerptStyle}>{article.excerpt}</div>}
            </Card>
          ))}
        </div>
      )}

      {displayExpanded && topics.length > 0 && (
        <div style={toolSectionStyle}>
          {topics.map((topic) => (
            <Card key={`${topic.index}-${topic.title}`} size="small" style={traceItemCardStyle}>
              <div style={traceItemTitleStyle}>
                {topic.index}. {topic.title}
              </div>
              <div style={traceItemMetaStyle}>{topic.angle}</div>
            </Card>
          ))}
        </div>
      )}

      {displayExpanded && pendingPayload?.ghid ? (
        <Card size="small" style={pendingCardStyle}>
          <div style={traceItemTitleStyle}>
            推荐导入 {String(pendingPayload.account_name || pendingPayload.ghid)}
          </div>
          <div style={traceExcerptStyle}>
            {String(pendingPayload.reason || "这个账号和当前赛道相关，适合加入知识库。")}
          </div>
          <Button
            type="primary"
            size="small"
            loading={importingGhid === String(pendingPayload.ghid)}
            onClick={() => onImport(String(pendingPayload.ghid))}
          >
            确认导入
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function buildTraceSummary(params: {
  accounts: RecommendedAccount[];
  articles: KnowledgeArticleHit[];
  topics: GeneratedTopic[];
  pendingPayload: Record<string, unknown> | null;
  thoughtItems: ThoughtChainItemType[];
}) {
  const finished = params.thoughtItems
    .filter((item) => item.status === "success")
    .map((item) => String(item.title));
  const fragments: string[] = [];

  if (finished.length > 0) {
    fragments.push(`已完成 ${finished.slice(0, 3).join(" / ")}`);
  }
  if (params.articles.length > 0) {
    fragments.push(`知识库命中 ${params.articles.length} 篇`);
  }
  if (params.topics.length > 0) {
    fragments.push(`生成选题 ${params.topics.length} 个`);
  }
  if (params.accounts.length > 0) {
    fragments.push(`筛出账号 ${params.accounts.length} 个`);
  }
  if (params.pendingPayload?.ghid) {
    fragments.push("有 1 个待确认导入");
  }

  return fragments.length > 0 ? fragments.join(" · ") : "这轮处理已完成，展开可查看过程明细。";
}

function buildThoughtChainItems(
  events: ToolEvent[],
  snapshot: LoadingSnapshot
): ThoughtChainItemType[] {
  const activeTool = [...events].reverse().find((event) => event.type === "tool_start")?.toolName;

  return snapshot.steps.map((step) => ({
    key: step.key,
    title: step.label,
    description: step.state === "active" ? snapshot.hint : undefined,
    status:
      step.state === "done"
        ? "success"
        : step.state === "active"
          ? "loading"
          : step.state === "error"
            ? "error"
            : undefined,
    collapsible: false,
    blink: step.state === "active",
    icon: step.key === resolveActiveStage(activeTool, snapshot.title) ? <LoadingOutlined /> : undefined,
  }));
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
  if (toolName === "search_hot_topics" || toolName === "search_koc_accounts" || toolName === "search_knowledge_base" || toolName === "analyze_journey_data") {
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
      if (assistantStatus === "输出答案中") return { title: "正在输出答案", hint: "先把核心结论流式发出来。" };
      if (assistantStatus === "组织回答中") return { title: "正在组织回答", hint: "把线索压缩成更清晰的回答结构。" };
      if (assistantStatus === "整理上下文中") return { title: "正在整理上下文", hint: "结合当前对话和赛道背景继续处理。" };
      return { title: "正在理解问题", hint: "先判断你想要的是分析、检索还是生成。" };
  }
}

function formatMessage(content: string): string {
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent);font-weight:500">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);font-size:11px;background:var(--accent-dim);color:var(--accent);padding:1px 5px;border-radius:3px">$1</code>')
    .replace(/\n/g, "<br />");
}

function fmtCount(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
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

const waitingCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minWidth: 320,
  padding: "4px 0 12px",
};

const waitingTopStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const waitingTagStyle: React.CSSProperties = {
  background: "var(--accent-dim)",
  color: "var(--accent)",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const waitingHintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
};

const skeletonLineStyle: React.CSSProperties = {
  height: 10,
  borderRadius: 999,
  background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
};

const miniThoughtWrapStyle: React.CSSProperties = {
  maxWidth: 560,
  padding: "12px 14px 10px",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))",
  border: "1px solid rgba(255,255,255,0.06)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
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
  marginTop: 6,
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
};

const layoutActionButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  width: "fit-content",
  borderColor: "rgba(200,150,90,0.25)",
  color: "var(--accent)",
  background: "var(--accent-dim)",
};

const toolPanelCardStyle: React.CSSProperties = {
  maxWidth: 620,
  padding: "14px 16px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.01))",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 20,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
};

const traceHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 4,
};

const toolPanelTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 10,
};

const traceSummaryStyle: React.CSSProperties = {
  marginTop: -2,
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
};

const traceToggleStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  paddingInline: 8,
  borderRadius: 999,
};

const toolSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
};

const traceItemCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  borderColor: "rgba(255,255,255,0.06)",
  borderRadius: 14,
  boxShadow: "none",
};

const traceCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const traceItemTitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-primary)",
  marginBottom: 4,
  lineHeight: 1.5,
};

const traceItemMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-tertiary)",
  lineHeight: 1.6,
};

const traceExcerptStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: 1.65,
};

const pendingCardStyle: React.CSSProperties = {
  ...traceItemCardStyle,
  borderColor: "rgba(200,150,90,0.24)",
  background: "rgba(200,150,90,0.05)",
};
