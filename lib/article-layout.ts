export type ExtractedArticle = {
  title: string;
  summary: string;
  bodyMarkdown: string;
};

export type LayoutDraftRecord = {
  id: string;
  conversation_id: string;
  journey_id: string;
  message_id: string;
  source_markdown: string;
  rendered_markdown: string;
  rendered_html: string;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
};

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "highlight"; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "cta"; lines: string[] }
  | { type: "divider"; lines: string[] }
  | { type: "image"; lines: string[] };

export function extractArticleFromAssistantMessage(content: string): ExtractedArticle | null {
  const title = captureSection(content, "主标题", "公众号摘要");
  const summary = captureSection(content, "公众号摘要", "备选标题");
  const body = captureBody(content);

  if (!title || !body) return null;

  return {
    title: title.trim(),
    summary: summary.trim(),
    bodyMarkdown: body.trim(),
  };
}

export function renderWechatHtml(markdown: string) {
  const blocks = parseMarkdown(markdown);
  const html = blocks.map(renderBlock).join("");
  return `<section style="${containerStyle}">${html}</section>`;
}

export function normalizeLayoutMarkdown(markdown: string) {
  return markdown.replace(/\r\n/g, "\n").trim();
}

export function applyDefaultWechatLayout(markdown: string) {
  const normalized = normalizeLayoutMarkdown(markdown);
  if (!normalized) return "";

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const nextBlocks = blocks.flatMap((block) => formatDefaultBlock(block));

  if (!nextBlocks.length) return normalized;

  const lastIndex = nextBlocks.length - 1;
  const lastBlock = nextBlocks[lastIndex];
  if (lastBlock && shouldWrapAsCta(lastBlock)) {
    nextBlocks[lastIndex] = `:::cta\n${stripCustomBlock(lastBlock)}\n:::`;
  }

  return nextBlocks.join("\n\n").trim();
}

function captureSection(content: string, startLabel: string, endLabel: string) {
  const escapedStart = escapeRegExp(`**${startLabel}**`);
  const escapedEnd = escapeRegExp(`**${endLabel}**`);
  const match = content.match(new RegExp(`${escapedStart}\\s*([\\s\\S]*?)\\s*${escapedEnd}`));
  return match?.[1] ?? "";
}

function captureBody(content: string) {
  const startLabel = escapeRegExp("**完整初稿**");
  const match = content.match(new RegExp(`${startLabel}\\s*([\\s\\S]*?)(?:\\n\\n如果你想继续调|$)`));
  return match?.[1] ?? "";
}

function formatDefaultBlock(block: string) {
  if (!block) return [];
  if (block.startsWith(":::")) {
    return [block];
  }
  if (/^#{1,3}\s/.test(block) || /^>\s/.test(block) || /^-\s/.test(block) || /^\d+\.\s/.test(block)) {
    return [block];
  }

  return splitLongParagraph(block);
}

function splitLongParagraph(paragraph: string) {
  const compact = paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return [];
  if (compact.length <= 110) return [compact];

  const sentences = compact.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [compact];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = `${current}${sentence}`.trim();
    if (current && next.length > 78) {
      parts.push(current.trim());
      current = sentence.trim();
    } else {
      current = next;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length ? parts : [compact];
}

function shouldWrapAsCta(block: string) {
  const text = stripCustomBlock(block);
  if (!text || /^#{1,3}\s/.test(text) || /^>\s/.test(text) || /^-\s/.test(text) || /^\d+\.\s/.test(text)) {
    return false;
  }
  return /(如果你|如果这篇|欢迎|建议你|不妨|可以先|收藏|留言|评论区|转给|下一步)/.test(text) || text.length <= 88;
}

function stripCustomBlock(block: string) {
  return block
    .replace(/^:::\w+\s*/g, "")
    .replace(/\n:::\s*$/g, "")
    .trim();
}

function parseMarkdown(markdown: string): Block[] {
  const lines = normalizeLayoutMarkdown(markdown).split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      index++;
      continue;
    }

    if (line.startsWith(":::")) {
      const blockType = line.slice(3).trim() as Block["type"];
      const collected: string[] = [];
      index++;
      while (index < lines.length && lines[index].trim() !== ":::") {
        collected.push(lines[index]);
        index++;
      }
      if (index < lines.length && lines[index].trim() === ":::") {
        index++;
      }
      if (blockType === "highlight" || blockType === "quote" || blockType === "cta" || blockType === "divider" || blockType === "image") {
        blocks.push({ type: blockType, lines: collected });
        continue;
      }
    }

    if (line.startsWith("### ")) {
      blocks.push({ type: "heading", level: 3, text: line.slice(4).trim() });
      index++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "heading", level: 2, text: line.slice(3).trim() });
      index++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ type: "heading", level: 1, text: line.slice(2).trim() });
      index++;
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s/, ""));
        index++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2).trim());
        index++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("> ")) {
        quoteLines.push(lines[index].trim().slice(2).trim());
        index++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || current.startsWith("#") || current.startsWith("- ") || /^\d+\.\s/.test(current) || current.startsWith("> ") || current.startsWith(":::")) {
        break;
      }
      paragraphLines.push(lines[index]);
      index++;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
  }

  return blocks;
}

function renderBlock(block: Block) {
  switch (block.type) {
    case "heading":
      return renderHeading(block.level, block.text);
    case "paragraph":
      return `<p style="${paragraphStyle}">${formatInline(block.text)}</p>`;
    case "list":
      return block.ordered
        ? `<ol style="${orderedListStyle}">${block.items.map((item) => `<li style="${listItemStyle}">${formatInline(item)}</li>`).join("")}</ol>`
        : `<ul style="${unorderedListStyle}">${block.items.map((item) => `<li style="${listItemStyle}">${formatInline(item)}</li>`).join("")}</ul>`;
    case "blockquote":
      return `<blockquote style="${blockquoteStyle}">${block.lines.map((line) => `<p style="${blockquoteParagraphStyle}">${formatInline(line)}</p>`).join("")}</blockquote>`;
    case "highlight":
      return `<section style="${highlightStyle}">${block.lines.map((line) => `<p style="${highlightParagraphStyle}">${formatInline(line)}</p>`).join("")}</section>`;
    case "quote":
      return `<section style="${quoteCardStyle}">${block.lines.map((line) => `<p style="${quoteParagraphStyle}">${formatInline(line)}</p>`).join("")}</section>`;
    case "cta":
      return `<section style="${ctaStyle}">${block.lines.map((line) => `<p style="${ctaParagraphStyle}">${formatInline(line)}</p>`).join("")}</section>`;
    case "divider":
      return `<section style="${dividerWrapStyle}"><div style="${dividerLineStyle}"></div>${block.lines[0] ? `<span style="${dividerLabelStyle}">${formatInline(block.lines[0].trim())}</span>` : ""}</section>`;
    case "image":
      return `<section style="${imagePlaceholderStyle}"><span style="${imagePlaceholderLabelStyle}">配图建议</span>${block.lines.map((line) => `<p style="${imagePlaceholderTextStyle}">${formatInline(line)}</p>`).join("")}</section>`;
    default:
      return "";
  }
}

function renderHeading(level: 1 | 2 | 3, text: string) {
  if (level === 1) {
    return `<h1 style="${h1Style}">${formatInline(text)}</h1>`;
  }
  if (level === 2) {
    return `<h2 style="${h2Style}">${formatInline(text)}</h2>`;
  }
  return `<h3 style="${h3Style}">${formatInline(text)}</h3>`;
}

function formatInline(text: string) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.*?)\*\*/g, `<strong style="${strongStyle}">$1</strong>`)
    .replace(/`([^`]+)`/g, `<code style="${codeStyle}">$1</code>`);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const containerStyle = [
  "max-width:100%",
  "padding:0 0 32px",
  "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
  "font-size:16px",
  "line-height:1.8",
  "color:#2B2B2B",
  "word-break:break-word",
].join(";");

const h1Style = "margin:0 0 18px;font-size:28px;line-height:1.35;font-weight:700;color:#111827;letter-spacing:-0.02em;";
const h2Style = "margin:32px 0 14px;padding-left:12px;border-left:4px solid #111827;font-size:22px;line-height:1.45;font-weight:700;color:#111827;";
const h3Style = "margin:24px 0 10px;font-size:18px;line-height:1.5;font-weight:700;color:#202938;";
const paragraphStyle = "margin:0 0 16px;color:#2B2B2B;";
const orderedListStyle = "margin:0 0 18px 22px;padding:0;color:#2B2B2B;";
const unorderedListStyle = "margin:0 0 18px 20px;padding:0;color:#2B2B2B;";
const listItemStyle = "margin:0 0 8px;";
const blockquoteStyle = "margin:20px 0;padding:14px 16px;border-left:4px solid #D4AF37;background:#F8F5EC;border-radius:0 12px 12px 0;";
const blockquoteParagraphStyle = "margin:0 0 8px;color:#4B5563;";
const highlightStyle = "margin:24px 0;padding:18px 20px;background:linear-gradient(180deg,#FFF8E6 0%,#FFFDF7 100%);border:1px solid #F3E2A1;border-radius:16px;";
const highlightParagraphStyle = "margin:0 0 10px;color:#6B4E16;font-weight:600;";
const quoteCardStyle = "margin:24px 0;padding:18px 20px;background:#F3F4F6;border-radius:16px;border:1px solid #E5E7EB;";
const quoteParagraphStyle = "margin:0 0 10px;color:#374151;font-style:italic;";
const ctaStyle = "margin:28px 0;padding:18px 20px;background:#111827;border-radius:18px;";
const ctaParagraphStyle = "margin:0 0 8px;color:#FFFFFF;font-weight:500;";
const dividerWrapStyle = "display:flex;align-items:center;gap:12px;margin:28px 0;";
const dividerLineStyle = "flex:1;height:1px;background:linear-gradient(90deg,rgba(17,24,39,0),rgba(17,24,39,0.3),rgba(17,24,39,0));";
const dividerLabelStyle = "font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#9CA3AF;";
const imagePlaceholderStyle = "margin:24px 0;padding:20px;border:1px dashed #CBD5E1;border-radius:16px;background:#F8FAFC;";
const imagePlaceholderLabelStyle = "display:inline-block;margin-bottom:8px;padding:4px 8px;border-radius:999px;background:#E2E8F0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#475569;";
const imagePlaceholderTextStyle = "margin:0;color:#64748B;";
const strongStyle = "color:#111827;font-weight:700;";
const codeStyle = "padding:2px 6px;border-radius:6px;background:#F3F4F6;font-size:0.9em;font-family:'SFMono-Regular',Consolas,monospace;color:#B45309;";
