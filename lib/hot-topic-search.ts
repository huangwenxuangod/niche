import { chat } from "@/lib/llm";
import { tavilySearch } from "@/lib/tavily";

export type HotTopicContext = {
  platform?: string;
  keywords?: string[];
};

export type HotTopicItem = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

type RefinedHotTopic = {
  title: string;
  url: string;
  published_date: string | undefined;
  excerpt: string;
};

export async function searchHotTopicCandidates(params: {
  baseQuery: string;
  journey: HotTopicContext | null;
  maxResults?: number;
  days?: number;
}) {
  const maxResults = params.maxResults ?? 5;
  const days = params.days ?? 3;
  const queries = await expandHotQueries(params.baseQuery, params.journey);
  const results = await tavilySearch(queries, {
    max_results: Math.max(4, Math.min(6, maxResults)),
    days,
  });
  const reranked = rerankHotTopics(results, params.journey, queries).slice(
    0,
    Math.max(8, maxResults * 2)
  );
  const refined: RefinedHotTopic[] = await refineHotTopics(reranked, params.journey, maxResults);

  return {
    query: queries[0] || params.baseQuery,
    queries,
    topics: refined.map((item) => ({
      title: item.title,
      url: item.url,
      published_date: item.published_date,
      excerpt: item.excerpt,
    })),
  };
}

async function expandHotQueries(baseQuery: string, journey: HotTopicContext | null) {
  const fallback = buildFallbackHotQueries(baseQuery, journey);

  try {
    const prompt = buildExpansionPrompt(baseQuery, journey, fallback);
    const reply = await chat({
      systemPrompt: "你是一个增长情报搜索助手。你负责把泛化赛道词扩成适合搜索真实热点的具体查询词。",
      userContent: prompt,
    });
    const match = reply.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return fallback;

    const cleaned = parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .filter((item) => item.length >= 4)
      .slice(0, 6);

    return cleaned.length ? Array.from(new Set([...cleaned, ...fallback])).slice(0, 6) : fallback;
  } catch {
    return fallback;
  }
}

function buildExpansionPrompt(
  baseQuery: string,
  journey: HotTopicContext | null,
  fallback: string[]
) {
  const keywordSummary = formatJourneyKeywords(journey);
  const contentTypeHint = getContentTypeSearchHint(journey);
  return `你要把一个偏泛的内容赛道词，扩成 4-6 个更适合搜索真实热点的查询。

要求：
1. 不要只重复赛道名本身。
2. 优先输出“具体产品 / 具体事件 / 具体能力变化 / 具体岗位冲击 / 具体争议点”。
3. 每个查询都要像用户真的会拿去搜网页热点，而不是抽象概念。
4. 适当发散，但仍然要和赛道高度相关。
5. 用 JSON 数组返回，不要输出别的内容。

赛道信息：
- 平台：${journey?.platform || ""}
- 旅程关键词：${keywordSummary}
- 当前基础词：${baseQuery}

内容定位提示：
${contentTypeHint}

示例：
- 如果赛道是“AI设计”，好的查询会更像：
  - "Claude Code 设计工作流 争议"
  - "GPT image 2 设计师 替代"
  - "Figma AI 新功能 用户体验"
  - "AI设计 工作流 设计师 失业 焦虑"

你也可以参考这些基础查询作为保底：
${fallback.map((item) => `- ${item}`).join("\n")}

只返回 JSON 数组。`;
}

async function refineHotTopics(
  candidates: HotTopicItem[],
  journey: HotTopicContext | null,
  maxResults: number
) {
  if (!candidates.length) return [];

  const shortlist = candidates.slice(0, Math.max(6, maxResults * 2));
  const fallback: RefinedHotTopic[] = shortlist.slice(0, maxResults).map((item) => ({
    title: item.title,
    url: item.url,
    published_date: item.published_date,
    excerpt: item.content ? item.content.slice(0, 200) : "",
  }));

  try {
    const prompt = `你是一个内容增长教练。请从下面候选热点中挑出最值得跟进的 ${maxResults} 个“增长机会”。

要求：
1. 不是简单挑最热门，而是挑最适合当前赛道和内容定位的。
2. 优先选择“具体变化、具体产品、具体争议、具体新功能、具体工作流变化”。
3. 避免过于泛的科普、企业介绍、无明显内容角度的材料。
4. 对每条入选结果，给一句不超过 32 字的中文理由，说明它为什么值得跟进。
5. 用 JSON 数组返回，每项格式：
   {"title":"...","url":"...","reason":"..."}

赛道：
- 平台：${journey?.platform || ""}
- 关键词：${formatJourneyKeywords(journey)}

内容定位提示：
${getContentTypeSelectionHint(journey)}

候选结果：
${shortlist
  .map(
    (item, index) =>
      `${index + 1}. ${item.title}\nURL: ${item.url}\n摘要: ${(item.content || "").slice(0, 220)}`
  )
  .join("\n\n")}

只返回 JSON 数组。`;

    const reply = await chat({
      systemPrompt: "你是一个热点机会筛选助手。",
      userContent: prompt,
    });
    const match = reply.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return fallback;

    const byUrl = new Map(shortlist.map((item) => [item.url, item]));
    const selected: RefinedHotTopic[] = parsed
      .map((entry) => {
        const url = String(entry?.url || "").trim();
        const title = String(entry?.title || "").trim();
        const reason = String(entry?.reason || "").trim();
        const hit =
          (url && byUrl.get(url)) ||
          shortlist.find((item) => normalizeText(item.title) === normalizeText(title));
        if (!hit) return null;
        return {
          title: hit.title,
          url: hit.url,
          published_date: hit.published_date,
          excerpt: reason || (hit.content ? hit.content.slice(0, 200) : ""),
        };
      })
      .filter((item): item is RefinedHotTopic => Boolean(item))
      .slice(0, maxResults);

    return selected.length ? selected : fallback;
  } catch {
    return fallback;
  }
}

function buildFallbackHotQueries(baseQuery: string, journey: HotTopicContext | null) {
  const normalizedQuery = baseQuery.trim();
  const platformLabel = getPlatformLabel(journey?.platform);
  const keywords = (journey?.keywords ?? []).map((item) => String(item || "").trim()).filter(Boolean);
  const keywordPhrase = keywords.slice(0, 2).join(" ");

  const candidates = [
    normalizedQuery,
    ...keywords,
    keywordPhrase,
    platformLabel,
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  const specificSeeds = candidates.filter((item) => !isGenericHotSeed(item));
  const primarySeed =
    specificSeeds[0] || keywordPhrase || normalizedQuery || platformLabel;
  const secondarySeed =
    specificSeeds.find((item) => item !== primarySeed) || keywords[1] || platformLabel;

  return Array.from(
    new Set(
      [
        `${primarySeed} 最新产品发布 趋势`,
        `${primarySeed} 用户体验 案例 拆解`,
        `${primarySeed} 实测 评测 新功能`,
        secondarySeed ? `${secondarySeed} 最近热议 产品` : "",
        keywordPhrase ? `${keywordPhrase} 最近案例` : "",
      ].filter(Boolean)
    )
  ).slice(0, 5);
}

function rerankHotTopics(
  results: HotTopicItem[],
  journey: HotTopicContext | null,
  queries: string[]
) {
  const seen = new Set<string>();
  const journeyTerms = [
    getPlatformLabel(journey?.platform),
    ...(journey?.keywords ?? []),
    ...queries,
  ]
    .flatMap((item) => item.split(/\s+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !isGenericHotSeed(item));

  return results
    .filter((item) => {
      const key = normalizeTopicKey(item.url || item.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      ...item,
      _rank: scoreHotTopic(item, journeyTerms),
    }))
    .sort((a, b) => b._rank - a._rank || (b.score ?? 0) - (a.score ?? 0));
}

function scoreHotTopic(
  item: { title: string; url: string; content: string; published_date?: string },
  journeyTerms: string[]
) {
  const haystack = `${item.title} ${item.content || ""}`.toLowerCase();
  let score = 0;

  for (const term of journeyTerms) {
    if (term && haystack.includes(term.toLowerCase())) {
      score += 3;
    }
  }

  if (/(发布|上线|实测|评测|案例|趋势|新功能|体验|拆解|替代|工作流|争议)/.test(item.title)) {
    score += 2;
  }

  if (item.published_date) {
    const published = new Date(item.published_date).getTime();
    if (!Number.isNaN(published)) {
      const ageDays = (Date.now() - published) / 86400000;
      if (ageDays <= 7) score += 2;
      else if (ageDays <= 30) score += 1;
    }
  }

  if (/(csdn\.net|blog\.csdn\.net)/i.test(item.url)) {
    score -= 2;
  }

  if (/(coocaa\.net)/i.test(item.url)) {
    score -= 1;
  }

  return score;
}

function normalizeTopicKey(value: string) {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").trim();
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function isGenericHotSeed(value: string) {
  return /^(AI|科技|互联网|产品|内容|体验|运营|公众号|小红书|社媒|增长)$|^(AI产品体验|内容创作|产品体验)$/i.test(
    value.trim()
  );
}

function getContentTypeSearchHint(journey: HotTopicContext | null | undefined) {
  const profile = detectContentProfile(journey);
  switch (profile) {
    case "review":
      return "优先发散到：新产品上线、实测对比、体验变化、替代关系、性能争议。";
    case "tutorial":
      return "优先发散到：新工作流、新功能用法、具体工具组合、实操步骤变化。";
    case "opinion":
      return "优先发散到：行业冲击、岗位变化、争议点、范式转移、立场对立。";
    case "journal":
      return "优先发散到：真实使用过程、踩坑经历、替代尝试、成长路径。";
    default:
      return "同时兼顾具体产品、能力变化、工作流变化和争议点。";
  }
}

function getContentTypeSelectionHint(journey: HotTopicContext | null | undefined) {
  const profile = detectContentProfile(journey);
  switch (profile) {
    case "review":
      return "更偏好可以做体验对比、优缺点评测、替代判断的机会。";
    case "tutorial":
      return "更偏好可以转成可执行步骤、工具教程、上手方法的机会。";
    case "opinion":
      return "更偏好有冲突、有判断、有行业转向意味的机会。";
    case "journal":
      return "更偏好适合做真实经历、试用记录、踩坑复盘的机会。";
    default:
      return "优先挑选既具体又容易转成内容选题的机会。";
  }
}

function formatJourneyKeywords(journey: HotTopicContext | null | undefined) {
  const keywords = (journey?.keywords ?? []).map((item) => String(item || "").trim()).filter(Boolean);
  return keywords.length ? keywords.join("、") : "暂无";
}

function getPlatformLabel(platform?: string) {
  switch (platform) {
    case "wechat_mp":
      return "公众号";
    case "wechat_channels":
      return "视频号";
    case "xiaohongshu":
      return "小红书";
    default:
      return String(platform || "").trim();
  }
}

function detectContentProfile(journey: HotTopicContext | null | undefined) {
  const haystack = (journey?.keywords ?? []).join(" ");
  if (/评测|测评|对比|体验/.test(haystack)) return "review";
  if (/教程|工作流|实操|方法|步骤/.test(haystack)) return "tutorial";
  if (/观点|判断|趋势|分析|拆解/.test(haystack)) return "opinion";
  if (/记录|复盘|踩坑|成长|尝试/.test(haystack)) return "journal";
  return "general";
}
