import type { LlmMessage } from "./llm";

export function buildToolBasedAnswer(llmMessages: LlmMessage[], userContent: string) {
  const latestFullArticle = findLatestToolPayloadFromMessages<{
    title?: string;
    summary?: string;
    title_options?: string[];
    article_markdown?: string;
    reference_note?: string;
  }>(llmMessages, "generate_full_article");

  if (latestFullArticle?.article_markdown?.trim()) {
    const titleOptions = Array.isArray(latestFullArticle.title_options)
      ? latestFullArticle.title_options.slice(0, 5)
      : [];

    return [
      latestFullArticle.title ? `# ${latestFullArticle.title}` : "",
      latestFullArticle.summary ? `> ${latestFullArticle.summary}` : "",
      titleOptions.length
        ? `## 备选标题\n${titleOptions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      latestFullArticle.reference_note ? `## 参考说明\n${latestFullArticle.reference_note}` : "",
      latestFullArticle.article_markdown,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const latestHotTopics = findLatestToolPayloadFromMessages<{
    query?: string;
    topics?: Array<{ title?: string; excerpt?: string; url?: string }>;
  }>(llmMessages, "search_hot_topics");

  if (latestHotTopics?.topics?.length) {
    const topics = latestHotTopics.topics.slice(0, 3);
    return [
      `我先按 **${latestHotTopics.query || "当前赛道"}** 这个收敛关键词帮你搜了一轮外部热点。`,
      `目前更值得跟进的是这 ${topics.length} 个方向：\n${topics
        .map(
          (topic, index) =>
            `${index + 1}. **${topic.title || "未命名热点"}**\n${topic.excerpt ? `   - 看点：${topic.excerpt}` : ""}${topic.url ? `\n   - 链接：${topic.url}` : ""}`
        )
        .join("\n")}`,
      /增长|涨粉|机会|破局/.test(userContent)
        ? "如果只从增长机会看，优先级最高的是：**能直接提升内容生产效率、能形成案例感、能讲出具体结果的 AI 工具实战题。** 这类内容最容易同时带来点击和转发。 "
        : "如果你愿意，我下一步可以直接把这 3 个热点继续收敛成适合你账号的选题。 ",
    ].join("\n\n");
  }

  const latestGeneratedTopics = findLatestToolPayloadFromMessages<{
    topics?: Array<{
      index?: number;
      title?: string;
      angle?: string;
      why_fit_user?: string;
      why_now?: string;
      reference_titles?: string[];
    }>;
  }>(llmMessages, "generate_topics");

  if (latestGeneratedTopics?.topics?.length) {
    const topics = latestGeneratedTopics.topics.slice(0, 3);
    return [
      "这轮我已经先帮你整理出一版可直接往下写的选题方向。",
      topics
        .map((topic, index) => {
          const references = Array.isArray(topic.reference_titles)
            ? topic.reference_titles.slice(0, 2)
            : [];
          return [
            `### ${topic.index || index + 1}. ${topic.title || "未命名选题"}`,
            topic.angle ? `切入角度：${topic.angle}` : "",
            topic.why_fit_user ? `为什么适合你：${topic.why_fit_user}` : "",
            topic.why_now ? `为什么现在值得写：${topic.why_now}` : "",
            references.length ? `参考标题：${references.join(" / ")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n"),
      "你可以直接回复“第一个可以”或“我选第二个”，我会继续往成稿方向推进。",
    ].join("\n\n");
  }

  const latestAnalyze = findLatestToolPayloadFromMessages<{
    patterns?: string[];
    top_articles?: Array<{ title?: string; read_count?: number }>;
    top_kocs?: Array<{ account_name?: string; max_read_count?: number; avg_read_count?: number }>;
  }>(llmMessages, "analyze_journey_data");

  if (latestAnalyze) {
    const topKoc = latestAnalyze.top_kocs?.[0];
    const topArticles = Array.isArray(latestAnalyze.top_articles)
      ? latestAnalyze.top_articles.slice(0, 3)
      : [];
    const patterns = Array.isArray(latestAnalyze.patterns)
      ? latestAnalyze.patterns.slice(0, 3)
      : [];

    const lines = [
      "从这批已导入文章看，阅读量高主要不是偶然，而是因为它同时占了 **标题、选题、实用价值** 这三个点。",
      topKoc?.account_name
        ? `账号基本盘上，**${topKoc.account_name}** 本身已经有较强的读者信任，最高阅读 ${fmtNum(topKoc.max_read_count ?? 0)}，平均阅读 ${fmtNum(topKoc.avg_read_count ?? 0)}。`
        : "",
      patterns.length
        ? `最明显的规律是：\n${patterns.map((pattern, index) => `${index + 1}. **${pattern}**`).join("\n")}`
        : "",
      topArticles.length
        ? `结合高阅读文章看，它们共同更像是：\n${topArticles
            .map(
              (article) =>
                `- **${article.title || "未命名文章"}**：阅读 ${fmtNum(article.read_count ?? 0)}`
            )
            .join("\n")}`
        : "",
      /为什么/.test(userContent)
        ? "一句话总结：**它不是靠泛泛聊 AI 起量，而是靠“具体案例 + 明确收益感 + 可直接带走的方法”起量。**"
        : "",
    ].filter(Boolean);

    return lines.join("\n\n");
  }

  const latestKnowledge = findLatestToolPayloadFromMessages<{
    articles?: Array<{ title?: string; read_count?: number; account_name?: string }>;
  }>(llmMessages, "search_knowledge_base");

  if (latestKnowledge?.articles?.length) {
    const articles = latestKnowledge.articles.slice(0, 3);
    return [
      "这轮我已经从知识库里拿到了几篇高阅读文章，但还没完成更深入的归因分析。",
      `目前能先确认的是，表现最好的内容集中在这些方向：\n${articles
        .map(
          (article) =>
            `- **${article.title || "未命名文章"}**｜${article.account_name || "未知账号"}｜阅读 ${fmtNum(article.read_count ?? 0)}`
        )
        .join("\n")}`,
      "如果只基于这批标题先做初步判断，最明显的共同点是：**标题具体、问题明确、读者能立刻感知收益。**",
    ].join("\n\n");
  }

  const latestWxvideo = findLatestToolPayloadFromMessages<{
    patterns?: string[];
    top_posts?: Array<{
      title?: string;
      like_count?: number;
      comment_count?: number;
    }>;
    migration_suggestion?: string;
  }>(llmMessages, "analyze_wxvideo_data");

  if (latestWxvideo) {
    const topPosts = Array.isArray(latestWxvideo.top_posts)
      ? latestWxvideo.top_posts.slice(0, 3)
      : [];
    const patterns = Array.isArray(latestWxvideo.patterns)
      ? latestWxvideo.patterns.slice(0, 3)
      : [];

    return [
      "我已经先把当前旅程里导入的视频号样本过了一遍。",
      patterns.length
        ? `目前最明显的互动规律是：\n${patterns.map((pattern, index) => `${index + 1}. ${pattern}`).join("\n")}`
        : "",
      topPosts.length
        ? `表现最好的作品样本：\n${topPosts
            .map(
              (post) =>
                `- **${post.title || "未命名作品"}**｜喜欢 ${fmtNum(post.like_count ?? 0)}｜评论 ${fmtNum(post.comment_count ?? 0)}`
            )
            .join("\n")}`
        : "",
      latestWxvideo.migration_suggestion ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return "";
}

export function buildFallbackMessage(userContent: string) {
  if (/(写稿|成稿|完整稿|文章)/.test(userContent)) {
    return "这轮写稿结果没有成功整理出来，请重新触发一次写稿。";
  }
  return "这轮我拿到了部分数据，但还没成功组织成有效回答。";
}

function findLatestToolPayloadFromMessages<T>(llmMessages: LlmMessage[], toolName: string) {
  for (let index = llmMessages.length - 1; index >= 0; index -= 1) {
    const message = llmMessages[index];
    if (message.role !== "assistant" || !("tool_calls" in message) || !message.tool_calls?.length) {
      continue;
    }

    const matchedCall = message.tool_calls.find((toolCall) => {
      const fn = "function" in toolCall ? toolCall.function : undefined;
      return fn?.name === toolName;
    });

    if (!matchedCall) {
      continue;
    }

    const toolCallId = matchedCall.id;
    const toolMessage = llmMessages.find(
      (candidate) =>
        candidate.role === "tool" &&
        "tool_call_id" in candidate &&
        candidate.tool_call_id === toolCallId &&
        typeof candidate.content === "string"
    );

    if (!toolMessage || typeof toolMessage.content !== "string") {
      continue;
    }

    try {
      return JSON.parse(toolMessage.content) as T;
    } catch {
      return null;
    }
  }

  return null;
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}
