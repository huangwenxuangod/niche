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

const themeVars = [
  "--niche-text:#222222",
  "--niche-text-soft:#645B51",
  "--niche-text-muted:#887D71",
  "--niche-primary:#B8864B",
  "--niche-primary-soft:#F7F2E8",
  "--niche-primary-line:#E7DACA",
  "--niche-surface:#FAF7F2",
  "--niche-quote-bg:#F8F4ED",
  "--niche-code-bg:#F4EFE7",
  "--niche-code-text:#9B6B34",
  "--niche-divider:#EAE1D6",
  "--niche-radius:14px",
  "--niche-font-size:16px",
  "--niche-line-height:1.85",
  "--niche-paragraph-gap:18px",
  "--niche-list-gap:9px",
].join(";");

const containerStyle = [
  themeVars,
  "max-width:100%",
  "padding:0 0 32px",
  "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
  "font-size:var(--niche-font-size)",
  "line-height:var(--niche-line-height)",
  "color:var(--niche-text)",
  "word-break:break-word",
].join(";");

const h1Style = [
  "margin:0 0 18px",
  "font-size:25px",
  "line-height:1.34",
  "font-weight:700",
  "color:var(--niche-text)",
  "letter-spacing:-0.02em",
].join(";");

const h2Style = [
  "margin:30px 0 14px",
  "padding:0 0 0 12px",
  "border-left:3px solid var(--niche-primary)",
  "font-size:19px",
  "line-height:1.5",
  "font-weight:700",
  "color:var(--niche-text)",
  "letter-spacing:-0.01em",
].join(";");

const h3Style = [
  "margin:22px 0 10px",
  "font-size:17px",
  "line-height:1.55",
  "font-weight:650",
  "color:var(--niche-text)",
].join(";");

const paragraphStyle = [
  "margin:0 0 var(--niche-paragraph-gap)",
  "color:var(--niche-text)",
  "text-align:left",
].join(";");

const orderedListStyle = [
  "margin:0 0 18px 22px",
  "padding:0",
  "color:var(--niche-text)",
].join(";");

const unorderedListStyle = [
  "margin:0 0 18px 20px",
  "padding:0",
  "color:var(--niche-text)",
].join(";");

const listItemStyle = [
  "margin:0 0 var(--niche-list-gap)",
  "padding-left:2px",
].join(";");

const blockquoteStyle = [
  "margin:22px 0",
  "padding:12px 14px",
  "border-left:3px solid var(--niche-primary)",
  "background:var(--niche-quote-bg)",
  "border-radius:0 12px 12px 0",
].join(";");

const blockquoteParagraphStyle = "margin:0 0 8px;color:var(--niche-text-soft);";

const highlightStyle = [
  "margin:24px 0",
  "padding:16px 18px",
  "background:var(--niche-primary-soft)",
  "border:1px solid var(--niche-primary-line)",
  "border-radius:var(--niche-radius)",
].join(";");

const highlightParagraphStyle = "margin:0 0 10px;color:var(--niche-text);font-weight:600;";

const quoteCardStyle = [
  "margin:24px 0",
  "padding:16px 18px",
  "background:var(--niche-surface)",
  "border:1px solid var(--niche-divider)",
  "border-radius:var(--niche-radius)",
].join(";");

const quoteParagraphStyle = "margin:0 0 10px;color:var(--niche-text-soft);font-style:italic;";

const ctaStyle = [
  "margin:28px 0",
  "padding:16px 18px",
  "background:var(--niche-surface)",
  "border:1px solid var(--niche-primary-line)",
  "border-radius:16px",
].join(";");

const ctaParagraphStyle = "margin:0 0 8px;color:var(--niche-text);font-weight:520;";

const dividerWrapStyle = "display:flex;align-items:center;gap:12px;margin:26px 0;";
const dividerLineStyle = "flex:1;height:1px;background:var(--niche-divider);";
const dividerLabelStyle = "font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--niche-text-muted);";

const imagePlaceholderStyle = [
  "margin:24px 0",
  "padding:18px 18px",
  "border:1px dashed var(--niche-primary-line)",
  "border-radius:16px",
  "background:var(--niche-surface)",
].join(";");

const imagePlaceholderLabelStyle = [
  "display:inline-block",
  "margin-bottom:8px",
  "padding:4px 8px",
  "border-radius:999px",
  "background:var(--niche-primary-soft)",
  "font-size:11px",
  "letter-spacing:0.1em",
  "text-transform:uppercase",
  "color:var(--niche-text-soft)",
].join(";");

const imagePlaceholderTextStyle = "margin:0;color:var(--niche-text-muted);";
const strongStyle = "color:var(--niche-text);font-weight:700;";
const codeStyle = "padding:2px 6px;border-radius:6px;background:var(--niche-code-bg);font-size:0.9em;font-family:'SFMono-Regular',Consolas,monospace;color:var(--niche-code-text);";
