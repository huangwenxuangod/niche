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
  const query = buildFocusedHotQuery(params.baseQuery, params.journey);
  const results = await tavilySearch(query, {
    max_results: Math.max(3, Math.min(5, maxResults)),
    days,
  });
  const reranked = rerankHotTopics(results, params.journey, query).slice(
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
    query,
    topics: refined.map((item) => ({
      title: item.title,
      url: item.url,
      published_date: item.published_date,
      excerpt: item.excerpt,
    })),
  };
}

function buildFocusedHotQuery(baseQuery: string, journey: HotTopicContext | null) {
  const intent = detectHotIntent(baseQuery);
  const journeyKeywords = (journey?.keywords ?? [])
    .map((item) => sanitizeKeyword(item))
    .filter(Boolean)
    .filter((item) => !isGenericHotSeed(item));
  const queryKeywords = sanitizeKeyword(baseQuery)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !isGenericStopWord(item));

  const domain = pickPrimaryDomainPhrase(queryKeywords, journeyKeywords, journey);
  const suffix = pickIntentSuffix(intent, journey, domain);
  const query = [domain, suffix].filter(Boolean).join(" ").trim();

  return query || fallbackHotQuery(journeyKeywords, journey);
}

function pickPrimaryDomainPhrase(
  queryKeywords: string[],
  journeyKeywords: string[],
  journey: HotTopicContext | null
) {
  const merged = [
    ...collapseKeywordPhrases(queryKeywords),
    ...collapseKeywordPhrases(journeyKeywords),
  ].filter(Boolean);

  const specific = merged.filter((item) => !isGenericHotSeed(item));
  if (specific.length) {
    return specific[0];
  }

  const platformLabel = getPlatformLabel(journey?.platform);
  if (platformLabel) {
    return platformLabel === "公众号" ? "AI工具公众号" : platformLabel;
  }

  return "AI工具公众号";
}

function pickIntentSuffix(
  intent: HotIntent,
  journey: HotTopicContext | null,
  domain: string
) {
  if (intent === "growth") return "增长案例";
  if (intent === "monetization") return "变现案例";
  if (intent === "controversy") return "争议";
  if (intent === "feature") return "新功能";

  const profile = detectContentProfile(journey);
  if (profile === "review") return domain.includes("AI") ? "实测" : "测评";
  if (profile === "tutorial") return "工作流";
  if (profile === "opinion") return "趋势";
  return "案例";
}

function fallbackHotQuery(journeyKeywords: string[], journey: HotTopicContext | null) {
  const firstKeyword = collapseKeywordPhrases(journeyKeywords).find(
    (item) => item && !isGenericHotSeed(item)
  );
  if (firstKeyword) {
    return `${firstKeyword} 案例`;
  }

  const platformLabel = getPlatformLabel(journey?.platform);
  if (platformLabel === "公众号") {
    return "AI工具公众号 案例";
  }

  return `${platformLabel || "AI工具"} 案例`.trim();
}

function rerankHotTopics(
  results: HotTopicItem[],
  journey: HotTopicContext | null,
  query: string
) {
  const seen = new Set<string>();
  const journeyTerms = [
    ...(journey?.keywords ?? []),
    ...query.split(/\s+/),
  ]
    .map((item) => String(item || "").trim())
    .filter((item) => item.length >= 2 && !isGenericStopWord(item));

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

  if (/(发布|上线|实测|评测|案例|趋势|新功能|体验|拆解|替代|工作流|争议|增长)/.test(item.title)) {
    score += 2;
  }

  if (/(公众号|微信公众平台|gpts|插件|agent|ai工具|自动化)/i.test(item.title)) {
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

function detectHotIntent(value: string): HotIntent {
  const text = value.toLowerCase();
  if (/增长|涨粉|获客|拉新|破局/.test(text)) return "growth";
  if (/变现|转化|付费|客单价/.test(text)) return "monetization";
  if (/争议|同质化|抄袭|合规|风险/.test(text)) return "controversy";
  if (/热点|趋势|最近|最新|新功能|发布|上线/.test(text)) return "feature";
  return "general";
}

function sanitizeKeyword(value: string) {
  return value
    .replace(/[0-9]{4}/g, " ")
    .replace(/[，。！？、,.!?/|\\()[\]{}:;"'`~\-+_=<>]/g, " ")
    .replace(/(增长机会|增长策略|增长逻辑|增长路径|涨粉方法|涨粉技巧|热点趋势|运营方法|运营技巧|实测玩法|破局方法|案例拆解)/gi, " ")
    .replace(/\b(growth|trend|trends|case|cases|hot|latest)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseKeywordPhrases(keywords: string[]) {
  const joined = keywords.join(" ").trim();
  if (!joined) return [];

  const phrases: string[] = [];
  const matchedEntities = joined.match(
    /(Claude Code|Claude|GPTs插件|GPTs|DeepSeek|Manus|Cursor|Coze|Dify|Lovable|Figma AI|Midjourney|公众号|微信公众平台|AI工具公众号|AI工具)/gi
  );

  if (matchedEntities?.length) {
    phrases.push(...matchedEntities.map((item) => item.trim()));
  }

  const compact = joined
    .split(/\s+/)
    .filter(Boolean)
    .filter((item) => !isGenericStopWord(item));

  if (compact.length) {
    phrases.push(compact.slice(0, 3).join(" "));
  }

  return Array.from(new Set(phrases.map((item) => item.trim()).filter(Boolean)));
}

function isGenericStopWord(value: string) {
  return /(为什么|怎么|如何|有哪些|最近|最新|热点|趋势|增长|机会|涨粉|方法|技巧|运营|账号|内容|阅读量|高|低|微信|一个|哪些|什么|一下|一下子)/i.test(
    value.trim()
  );
}

function isGenericHotSeed(value: string) {
  return /^(AI|科技|互联网|产品|内容|体验|运营|小红书|社媒|增长|公众号|微信|AI工具|AI工具公众号)$|^(AI产品体验|内容创作|产品体验)$/i.test(
    value.trim()
  );
}

function normalizeTopicKey(value: string) {
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").trim();
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

type HotIntent =
  | "growth"
  | "monetization"
  | "controversy"
  | "feature"
  | "general";
