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
    max_results: Math.max(3, Math.min(5, maxResults)),
    days,
  });
  const reranked = rerankHotTopics(results, params.journey, queries).slice(
    0,
    Math.max(5, maxResults * 2)
  );
  const refined: RefinedHotTopic[] = reranked.slice(0, maxResults).map((item) => ({
    title: item.title,
    url: item.url,
    published_date: item.published_date,
    excerpt: item.content ? item.content.slice(0, 200) : "",
  }));

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
  const normalizedBase = normalizeSearchSeed(baseQuery);
  if (normalizedBase && !isGenericHotSeed(normalizedBase)) {
    return Array.from(new Set([normalizedBase, ...fallback])).slice(0, 2);
  }

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
      .map((item) => normalizeSearchSeed(item))
      .filter((item) => item.length >= 2)
      .filter((item) => !isGenericHotSeed(item))
      .slice(0, 2);

    return cleaned.length ? Array.from(new Set([...cleaned, ...fallback])).slice(0, 2) : fallback;
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
  return `你要把一个偏泛的内容赛道词，收敛成 1-2 个更适合搜索真实热点的关键词短语。

要求：
1. 每个结果都必须是 2-5 个词组成的短关键词，不要写完整句子。
2. 优先保留“具体产品名 / 具体工具名 / 具体能力词 / 具体动作词”。
3. 禁止混入平台词、增长词、运营词、泛泛形容词，除非它们是搜索必要词。
4. 如果基础词已经足够具体，就直接返回更短的关键词版本，不要扩写。
5. 最多返回 2 个关键词短语，用 JSON 数组返回，不要输出别的内容。

赛道信息：
- 平台：${journey?.platform || ""}
- 旅程关键词：${keywordSummary}
- 当前基础词：${baseQuery}

内容定位提示：
${contentTypeHint}

示例：
- 输入 "微信公众号 接入GPTs插件 AI工具账号 涨粉方法"
  输出 ["GPTs 插件", "公众号 AI 工具"]
- 输入 "AI设计 最近趋势"
  输出 ["Figma AI", "GPT image 2"]

你也可以参考这些基础查询作为保底：
${fallback.map((item) => `- ${item}`).join("\n")}

只返回 JSON 数组。`;
}

function buildFallbackHotQueries(baseQuery: string, journey: HotTopicContext | null) {
  const normalizedQuery = normalizeSearchSeed(baseQuery);
  const platformLabel = getPlatformLabel(journey?.platform);
  const keywords = (journey?.keywords ?? []).map((item) => String(item || "").trim()).filter(Boolean);
  const keywordPhrase = normalizeSearchSeed(keywords.slice(0, 2).join(" "));

  const candidates = [
    normalizedQuery,
    ...keywords.map((item) => normalizeSearchSeed(item)),
    keywordPhrase,
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
        primarySeed,
        secondarySeed,
      ].filter(Boolean)
    )
  )
    .filter((item) => item.length >= 2)
    .slice(0, 2);
}

function rerankHotTopics(
  results: HotTopicItem[],
  journey: HotTopicContext | null,
  queries: string[]
) {
  const seen = new Set<string>();
  const journeyTerms = [
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

  if (/(公众号|微信公众平台|gpts|gpts插件|插件|agent|ai工具|自动化)/i.test(item.title)) {
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

function normalizeSearchSeed(value: string) {
  return value
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\b(为什么|怎么|如何|有哪些|最近|热点|趋势|增长|涨粉|方法|技巧|运营|账号)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
