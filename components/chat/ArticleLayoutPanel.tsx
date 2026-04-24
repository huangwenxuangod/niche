"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { extractArticleFromAssistantMessage, renderWechatHtml } from "@/lib/article-layout";
import { toast } from "@/lib/toast";

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
  app_id: string;
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
  const [wechatConfig, setWechatConfig] = useState<WechatConfig | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");

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
      setMode("preview");

      try {
        const configRes = await fetch("/api/wechat/config");
        const configData = await configRes.json();
        if (!cancelled && configRes.ok && configData.config) {
          setWechatConfig(configData.config);
          setAppId(configData.config.app_id || "");
        }

        const existingRes = await fetch(`/api/article-layout?message_id=${encodeURIComponent(currentMessageId)}`);
        const existingData = await existingRes.json();
        if (!cancelled && existingRes.ok && existingData.draft) {
          setSourceMarkdown(existingData.draft.source_markdown || article.bodyMarkdown);
          setRenderedMarkdown(existingData.draft.rendered_markdown || article.bodyMarkdown);
          setDraftId(existingData.draft.id || null);
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

        const savedDraft = await persistDraft({
          source_markdown: nextSource,
          rendered_markdown: nextRendered,
          rendered_html: renderWechatHtml(nextRendered),
        });
        setDraftId(savedDraft?.id || null);

        if (!cancelled) {
          toast.success("已应用默认长文排版策略。");
        }
      } catch (err) {
        if (!cancelled) {
          setSourceMarkdown(article.bodyMarkdown);
          setRenderedMarkdown(article.bodyMarkdown);
          toast.error(err instanceof Error ? err.message : "默认排版生成失败");
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
    try {
      const savedDraft = await persistDraft({
        source_markdown: sourceMarkdown,
        rendered_markdown: renderedMarkdown,
        rendered_html: renderedHtml,
      });
      setDraftId(savedDraft?.id || null);
      toast.success("已保存最新排版草稿。");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyHtml() {
    try {
      await navigator.clipboard.writeText(renderedHtml);
      toast.success("公众号 HTML 已复制。");
    } catch {
      toast.error("复制 HTML 失败，请重试。");
    }
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(renderedMarkdown);
      toast.success("排版后的 Markdown 已复制。");
    } catch {
      toast.error("复制 Markdown 失败，请重试。");
    }
  }

  async function handlePublishToWechat() {
    setPublishing(true);
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

      if (!appId.trim() || (!wechatConfig && !appSecret.trim())) {
        throw new Error("请先填写 AppID 和 AppSecret。");
      }

      if (!wechatConfig || appSecret.trim()) {
        const saveRes = await fetch("/api/wechat/config", {
          method: wechatConfig ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
          }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) {
          throw new Error(saveData.error || "公众号配置保存失败");
        }
        setWechatConfig(saveData.config);
        setAppSecret("");
      }

      const res = await fetch("/api/wechat/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: activeDraftId,
          message_id: messageId,
          title: article.title,
          summary: article.summary,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "发布失败");
      }

      setDraftId(activeDraftId);
      setPublishOpen(false);
      toast.success(`已成功保存到公众号草稿箱。media_id：${data.media_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败");
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

        {loading ? (
          <div style={loadingStyle}>正在应用默认长文排版策略...</div>
        ) : mode === "preview" ? (
          <div style={previewWrapStyle}>
            <div style={phoneFrameStyle}>
              <div className="wechat-preview-scroll" style={phoneInnerStyle}>
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
              }}
              style={editorStyle}
            />
          </div>
        )}
      </div>
      {publishOpen && (
        <div style={modalOverlayStyle} onClick={() => setPublishOpen(false)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={eyebrowStyle}>发布到公众号</div>
                <div style={modalTitleStyle}>保存到草稿箱</div>
              </div>
              <button onClick={() => setPublishOpen(false)} style={closeButtonStyle}>×</button>
            </div>
            <div style={modalHintStyle}>
              只需要填写公众号的 <strong>AppID</strong> 和 <strong>AppSecret</strong>。其余信息将使用当前文章默认值自动处理。
            </div>
            <div style={modalFormStyle}>
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
            </div>
            <div style={modalActionsStyle}>
              <button onClick={() => setPublishOpen(false)} style={secondaryActionStyle}>
                取消
              </button>
              <button onClick={handlePublishToWechat} disabled={publishing} style={publishActionStyle}>
                {publishing ? "发布中..." : "确认保存到草稿箱"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .wechat-preview-scroll {
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(120, 102, 74, 0.45) transparent;
        }

        .wechat-preview-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .wechat-preview-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .wechat-preview-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(196, 168, 120, 0.75), rgba(120, 102, 74, 0.85));
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.88);
        }

        .wechat-preview-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(214, 185, 136, 0.95), rgba(138, 116, 84, 0.95));
        }
      `}</style>
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

const secondaryActionStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6,6,5,0.58)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 90,
  padding: 24,
};

const modalCardStyle: React.CSSProperties = {
  width: "min(520px, 100%)",
  borderRadius: 24,
  border: "1px solid rgba(200,150,90,0.22)",
  background: "linear-gradient(180deg, rgba(21,21,19,0.98) 0%, rgba(15,15,14,0.98) 100%)",
  boxShadow: "0 28px 90px rgba(0,0,0,0.38)",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const modalTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 24,
  color: "var(--text-primary)",
  lineHeight: 1.2,
};

const modalHintStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 14,
  background: "rgba(200,150,90,0.08)",
  border: "1px solid rgba(200,150,90,0.14)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
};

const modalFormStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const modalActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
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
  alignItems: "flex-start",
};

const phoneFrameStyle: React.CSSProperties = {
  width: 360,
  maxWidth: "100%",
  height: "min(760px, calc(100vh - 220px))",
  minHeight: 520,
  borderRadius: 30,
  background: "linear-gradient(180deg, #F3ECE0 0%, #E6DCCB 100%)",
  padding: "14px 12px",
  boxShadow: "0 24px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.45)",
  border: "1px solid rgba(140, 120, 92, 0.24)",
  overflow: "hidden",
  position: "relative",
};

const phoneInnerStyle: React.CSSProperties = {
  height: "100%",
  borderRadius: 22,
  background: "#FFFFFF",
  padding: "22px 18px 28px 20px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
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
