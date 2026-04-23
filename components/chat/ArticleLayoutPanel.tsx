"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { extractArticleFromAssistantMessage, renderWechatHtml } from "@/lib/article-layout";

interface Props {
  open: boolean;
  conversationId: string;
  journeyId: string;
  messageId: string | null;
  messageContent: string;
  onClose: () => void;
}

type DraftPayload = {
  source_markdown: string;
  rendered_markdown: string;
  rendered_html: string;
};

export function ArticleLayoutPanel({
  open,
  conversationId,
  journeyId,
  messageId,
  messageContent,
  onClose,
}: Props) {
  const extracted = useMemo(
    () => extractArticleFromAssistantMessage(messageContent),
    [messageContent]
  );
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [sourceMarkdown, setSourceMarkdown] = useState("");
  const [renderedMarkdown, setRenderedMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const renderedHtml = useMemo(
    () => renderWechatHtml(renderedMarkdown || sourceMarkdown),
    [renderedMarkdown, sourceMarkdown]
  );

  const persistDraft = useCallback(async (payload: DraftPayload, status: "draft" | "published" = "draft") => {
    if (!messageId) return;
    const res = await fetch("/api/article-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        journey_id: journeyId,
        message_id: messageId,
        source_markdown: payload.source_markdown,
        rendered_markdown: payload.rendered_markdown,
        rendered_html: payload.rendered_html,
        status,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "保存失败");
    }
  }, [conversationId, journeyId, messageId]);

  useEffect(() => {
    if (!open || !messageId || !extracted) return;
    const article = extracted;
    const currentMessageId = messageId;

    let cancelled = false;

    async function loadOrOptimize() {
      setLoading(true);
      setNotice("");
      setMode("preview");

      try {
        const existingRes = await fetch(`/api/article-layout?message_id=${encodeURIComponent(currentMessageId)}`);
        const existingData = await existingRes.json();
        if (!cancelled && existingRes.ok && existingData.draft) {
          setSourceMarkdown(existingData.draft.source_markdown || article.bodyMarkdown);
          setRenderedMarkdown(existingData.draft.rendered_markdown || article.bodyMarkdown);
          setLoading(false);
          return;
        }

        const optimizeRes = await fetch("/api/article-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "optimize",
            title: article.title,
            summary: article.summary,
            source_markdown: article.bodyMarkdown,
          }),
        });
        const optimizeData = await optimizeRes.json();
        if (!optimizeRes.ok) {
          throw new Error(optimizeData.error || "排版优化失败");
        }
        if (cancelled) return;

        const nextRendered = optimizeData.rendered_markdown || article.bodyMarkdown;
        const nextSource = article.bodyMarkdown;
        setSourceMarkdown(nextSource);
        setRenderedMarkdown(nextRendered);

        await persistDraft({
          source_markdown: nextSource,
          rendered_markdown: nextRendered,
          rendered_html: renderWechatHtml(nextRendered),
        });

        if (!cancelled) {
          setNotice("已完成一次 AI 排版优化。后续你改 Markdown，排版结构将按当前版本延续。");
        }
      } catch (err) {
        if (!cancelled) {
          setSourceMarkdown(article.bodyMarkdown);
          setRenderedMarkdown(article.bodyMarkdown);
          setNotice(err instanceof Error ? err.message : "排版优化失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOrOptimize();

    return () => {
      cancelled = true;
    };
  }, [open, messageId, extracted, persistDraft]);

  async function handleSave() {
    setSaving(true);
    setNotice("");
    try {
      await persistDraft({
        source_markdown: sourceMarkdown,
        rendered_markdown: renderedMarkdown,
        rendered_html: renderedHtml,
      });
      setNotice("已保存最新排版草稿。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyHtml() {
    try {
      await navigator.clipboard.writeText(renderedHtml);
      setNotice("公众号 HTML 已复制。");
    } catch {
      setNotice("复制 HTML 失败，请重试。");
    }
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(renderedMarkdown);
      setNotice("排版后的 Markdown 已复制。");
    } catch {
      setNotice("复制 Markdown 失败，请重试。");
    }
  }

  async function handlePublishPlaceholder() {
    setNotice("“发布到公众号”入口已预留，后续将接入真实发布流程。");
  }

  if (!open || !extracted || !messageId) {
    return null;
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>排版工作台</div>
            <div style={titleStyle}>简洁专业</div>
          </div>
          <button onClick={onClose} style={closeButtonStyle}>×</button>
        </div>

        <div style={toolbarStyle}>
          <button onClick={() => setMode("preview")} style={mode === "preview" ? activeToolButtonStyle : toolButtonStyle}>
            预览
          </button>
          <button onClick={() => setMode("edit")} style={mode === "edit" ? activeToolButtonStyle : toolButtonStyle}>
            编辑
          </button>
          <button onClick={handleCopyHtml} style={toolButtonStyle}>复制 HTML</button>
          <button onClick={handleCopyMarkdown} style={toolButtonStyle}>复制 Markdown</button>
          <button onClick={handleSave} disabled={saving} style={toolButtonStyle}>
            {saving ? "保存中..." : "保存草稿"}
          </button>
          <button onClick={handlePublishPlaceholder} style={publishButtonStyle}>发布到公众号</button>
        </div>

        {notice && <div style={noticeStyle}>{notice}</div>}

        {loading ? (
          <div style={loadingStyle}>正在应用一次 AI 排版优化...</div>
        ) : mode === "preview" ? (
          <div style={previewWrapStyle}>
            <div style={phoneFrameStyle}>
              <div style={phoneInnerStyle}>
                <div style={previewTitleStyle}>{extracted.title}</div>
                {extracted.summary && <div style={previewSummaryStyle}>{extracted.summary}</div>}
                <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              </div>
            </div>
          </div>
        ) : (
          <div style={editorWrapStyle}>
            <div style={editorHintStyle}>你正在编辑排版后的 Markdown。预览会实时按当前结构更新，不会重新跑 AI 排版。</div>
            <textarea
              value={renderedMarkdown}
              onChange={(e) => {
                setRenderedMarkdown(e.target.value);
                setNotice("");
              }}
              style={editorStyle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 500,
  maxWidth: "100vw",
  background: "rgba(8,8,7,0.96)",
  borderLeft: "1px solid var(--border)",
  zIndex: 60,
  display: "flex",
};

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  minWidth: 0,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "18px 18px 14px",
  borderBottom: "1px solid var(--border)",
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--accent)",
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 18,
  color: "var(--text-primary)",
};

const closeButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  fontSize: 18,
  cursor: "pointer",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  padding: "14px 18px 10px",
  borderBottom: "1px solid var(--border)",
};

const toolButtonStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  fontSize: 11,
  cursor: "pointer",
};

const activeToolButtonStyle: React.CSSProperties = {
  ...toolButtonStyle,
  borderColor: "rgba(200,150,90,0.45)",
  color: "var(--accent)",
  background: "var(--accent-dim)",
};

const publishButtonStyle: React.CSSProperties = {
  ...toolButtonStyle,
  borderColor: "rgba(200,150,90,0.35)",
  color: "var(--accent)",
};

const noticeStyle: React.CSSProperties = {
  margin: "12px 18px 0",
  padding: "10px 12px",
  borderRadius: 10,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  fontSize: 12,
};

const loadingStyle: React.CSSProperties = {
  padding: "22px 18px",
  color: "var(--text-secondary)",
};

const previewWrapStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "20px 16px 28px",
  display: "flex",
  justifyContent: "center",
};

const phoneFrameStyle: React.CSSProperties = {
  width: 360,
  maxWidth: "100%",
  borderRadius: 28,
  background: "#EDE7DB",
  padding: "16px 12px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};

const phoneInnerStyle: React.CSSProperties = {
  minHeight: "100%",
  borderRadius: 20,
  background: "#FFFFFF",
  padding: "22px 20px 28px",
};

const previewTitleStyle: React.CSSProperties = {
  fontSize: 28,
  lineHeight: 1.35,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 14,
};

const previewSummaryStyle: React.CSSProperties = {
  marginBottom: 18,
  padding: "12px 14px",
  borderRadius: 14,
  background: "#F8F5EC",
  color: "#6B7280",
  lineHeight: 1.7,
  fontSize: 14,
};

const editorWrapStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  padding: "16px 18px 20px",
  gap: 10,
};

const editorHintStyle: React.CSSProperties = {
  color: "var(--text-tertiary)",
  fontSize: 12,
  lineHeight: 1.6,
};

const editorStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  padding: "16px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.8,
  resize: "none",
  outline: "none",
};
