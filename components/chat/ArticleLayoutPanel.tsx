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

type SavedDraft = {
  id: string;
  source_markdown: string;
  rendered_markdown: string;
  rendered_html: string;
};

type WechatConfig = {
  id: string;
  account_name: string | null;
  app_id: string;
  default_author: string | null;
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
  const [draftId, setDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [wechatConfig, setWechatConfig] = useState<WechatConfig | null>(null);
  const [accountName, setAccountName] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [defaultAuthor, setDefaultAuthor] = useState("");
  const [publishAuthor, setPublishAuthor] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [publishSummary, setPublishSummary] = useState("");

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
    return data.draft as SavedDraft;
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
        const configRes = await fetch("/api/wechat/config");
        const configData = await configRes.json();
        if (!cancelled && configRes.ok && configData.config) {
          setWechatConfig(configData.config);
          setAccountName(configData.config.account_name || "");
          setAppId(configData.config.app_id || "");
          setDefaultAuthor(configData.config.default_author || "");
          setPublishAuthor(configData.config.default_author || "");
        }

        const existingRes = await fetch(`/api/article-layout?message_id=${encodeURIComponent(currentMessageId)}`);
        const existingData = await existingRes.json();
        if (!cancelled && existingRes.ok && existingData.draft) {
          setSourceMarkdown(existingData.draft.source_markdown || article.bodyMarkdown);
          setRenderedMarkdown(existingData.draft.rendered_markdown || article.bodyMarkdown);
          setDraftId(existingData.draft.id || null);
          setPublishSummary(article.summary || "");
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
        setPublishSummary(article.summary || "");

        const savedDraft = await persistDraft({
          source_markdown: nextSource,
          rendered_markdown: nextRendered,
          rendered_html: renderWechatHtml(nextRendered),
        });
        setDraftId(savedDraft?.id || null);

        if (!cancelled) {
          setNotice("已应用默认长文排版策略。后续你改 Markdown，预览会按这套固定规则继续更新。");
        }
      } catch (err) {
        if (!cancelled) {
          setSourceMarkdown(article.bodyMarkdown);
          setRenderedMarkdown(article.bodyMarkdown);
          setNotice(err instanceof Error ? err.message : "默认排版生成失败");
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
      const savedDraft = await persistDraft({
        source_markdown: sourceMarkdown,
        rendered_markdown: renderedMarkdown,
        rendered_html: renderedHtml,
      });
      setDraftId(savedDraft?.id || null);
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

  async function handleSaveWechatConfig() {
    setNotice("");
    try {
      const method = wechatConfig ? "PUT" : "POST";
      const res = await fetch("/api/wechat/config", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_name: accountName,
          app_id: appId,
          app_secret: appSecret,
          default_author: defaultAuthor,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "公众号配置保存失败");
      }
      setWechatConfig(data.config);
      setAppSecret("");
      setPublishAuthor(data.config?.default_author || defaultAuthor);
      setNotice("公众号配置已保存。");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "公众号配置保存失败");
    }
  }

  async function handlePublishToWechat() {
    setPublishing(true);
    setNotice("");
    try {
      const savedDraft = await persistDraft({
        source_markdown: sourceMarkdown,
        rendered_markdown: renderedMarkdown,
        rendered_html: renderedHtml,
      });

      const activeDraftId = savedDraft?.id || draftId;
      if (!activeDraftId) {
        throw new Error("请先保存排版草稿后再发布。");
      }
      if (!coverImageUrl.trim()) {
        throw new Error("请先填写封面图链接。");
      }

      const res = await fetch("/api/wechat/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: activeDraftId,
          message_id: messageId,
          title: article.title,
          summary: publishSummary,
          author: publishAuthor,
          cover_image_url: coverImageUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "发布失败");
      }

      setDraftId(activeDraftId);
      setPublishOpen(false);
      setNotice(`已成功保存到公众号草稿箱。media_id：${data.media_id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  if (!open || !extracted || !messageId) {
    return null;
  }

  const article = extracted;

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
          <button onClick={() => setPublishOpen((prev) => !prev)} style={publishButtonStyle}>
            发布到公众号
          </button>
        </div>

        {notice && <div style={noticeStyle}>{notice}</div>}

        {publishOpen && (
          <div style={publishCardStyle}>
            <div style={publishSectionTitleStyle}>公众号配置</div>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="公众号名称（可选）"
              style={inputStyle}
            />
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="AppID"
              style={inputStyle}
            />
            <input
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={wechatConfig ? "如需更新请填写新的 AppSecret" : "AppSecret"}
              style={inputStyle}
            />
            <input
              value={defaultAuthor}
              onChange={(e) => setDefaultAuthor(e.target.value)}
              placeholder="默认作者名（可选）"
              style={inputStyle}
            />
            <button onClick={handleSaveWechatConfig} style={secondaryActionStyle}>
              保存公众号配置
            </button>

            <div style={publishSectionTitleStyle}>本次发布信息</div>
            <input
              value={publishAuthor}
              onChange={(e) => setPublishAuthor(e.target.value)}
              placeholder="本次发布作者名（可选）"
              style={inputStyle}
            />
            <textarea
              value={publishSummary}
              onChange={(e) => setPublishSummary(e.target.value)}
              placeholder="摘要"
              style={summaryStyle}
            />
            <input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="封面图 URL（必填）"
              style={inputStyle}
            />
            <button onClick={handlePublishToWechat} disabled={publishing} style={publishActionStyle}>
              {publishing ? "发布中..." : "确认保存到草稿箱"}
            </button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>正在应用默认长文排版策略...</div>
        ) : mode === "preview" ? (
          <div style={previewWrapStyle}>
            <div style={phoneFrameStyle}>
              <div style={phoneInnerStyle}>
                <div style={previewTitleStyle}>{article.title}</div>
                {article.summary && <div style={previewSummaryStyle}>{article.summary}</div>}
                <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
              </div>
            </div>
          </div>
        ) : (
          <div style={editorWrapStyle}>
            <div style={editorHintStyle}>你正在编辑排版后的 Markdown。预览会实时按固定排版规则更新，不会再重新生成新的版式。</div>
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

const publishCardStyle: React.CSSProperties = {
  margin: "12px 18px 0",
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(200,150,90,0.2)",
  background: "rgba(22,22,20,0.85)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const publishSectionTitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "var(--accent)",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  padding: "10px 12px",
  fontSize: 12,
  outline: "none",
};

const summaryStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 88,
  resize: "vertical",
  fontFamily: "var(--font-body)",
};

const secondaryActionStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};

const publishActionStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(200,150,90,0.35)",
  background: "var(--accent)",
  color: "var(--bg-void)",
  fontSize: 12,
  cursor: "pointer",
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
