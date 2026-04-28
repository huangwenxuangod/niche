import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const analyzeWxvideoDataSchema = z.object({
  focus: z
    .enum(["viral_patterns", "content_migration"])
    .optional()
    .describe("分析重点：爆款规律或公众号迁移建议"),
});

export const analyzeWxvideoDataToolDefinition: AgentToolDefinition<
  typeof analyzeWxvideoDataSchema
> = {
  name: "analyze_wxvideo_data",
  description: `
【功能】分析当前旅程里已导入的视频号样本

【适用场景】
- 想看绑定视频号最近哪些内容更容易出互动
- 想判断公众号内容能不能迁移到视频号
- 想总结视频号题材、互动规律

【参数】
- focus: viral_patterns（默认，分析互动规律）或 content_migration（给公众号迁移建议）
`,
  schema: analyzeWxvideoDataSchema,
};

type WxvideoPost = {
  media_type: string | null;
  title: string | null;
  like_count: number | null;
  fav_count: number | null;
  forward_count: number | null;
  comment_count: number | null;
  publish_time: string | null;
  wxvideo_sources:
    | {
        account_name: string | null;
      }
    | {
        account_name: string | null;
      }[]
    | null;
};

export async function runAnalyzeWxvideoData(
  args: z.infer<typeof analyzeWxvideoDataSchema>,
  context: ToolExecutionContext
) {
  const focus = args.focus ?? "viral_patterns";
  const [sourcesRes, postsRes] = await Promise.all([
    context.supabase
      .from("wxvideo_sources")
      .select("account_name, feed_count, avg_like_count, max_like_count")
      .eq("journey_id", context.journeyId)
      .order("max_like_count", { ascending: false })
      .limit(5),
    context.supabase
      .from("wxvideo_posts")
      .select(
        "media_type, title, like_count, fav_count, forward_count, comment_count, publish_time, wxvideo_sources(account_name)"
      )
      .eq("journey_id", context.journeyId)
      .order("like_count", { ascending: false })
      .limit(8),
  ]);

  const sources = sourcesRes.data ?? [];
  const posts = (postsRes.data ?? []) as WxvideoPost[];
  const patterns = summarizeWxvideoPatterns(posts);

  return {
    focus,
    source_count: sources.length,
    post_count: posts.length,
    top_sources: sources.slice(0, 3),
    top_posts: posts.slice(0, 5),
    patterns,
    migration_suggestion:
      focus === "content_migration"
        ? buildMigrationSuggestion(posts)
        : undefined,
  };
}

function summarizeWxvideoPatterns(posts: WxvideoPost[]) {
  const patterns: string[] = [];
  const titles = posts.map((post) => post.title || "");

  if (titles.some((title) => /\d/.test(title))) {
    patterns.push("高互动视频标题里常出现数字，说明清单型与步骤型选题更容易被点开。");
  }
  if (titles.some((title) => /实测|测评|体验/.test(title))) {
    patterns.push("实测和体验型内容更容易带来互动，说明用户偏好真实使用感而不是空泛观点。");
  }
  if (posts.some((post) => (post.comment_count ?? 0) > 200)) {
    patterns.push("评论区活跃的视频通常更适合继续扩写成长文，因为话题本身有讨论空间。");
  }
  if (!patterns.length) {
    patterns.push("现有视频号样本还不多，建议优先继续补更多作品样本再做更强结论。");
  }

  return patterns;
}

function buildMigrationSuggestion(posts: WxvideoPost[]) {
  const topPost = posts[0];
  if (!topPost?.title) {
    return "先补充更多视频号样本，再判断哪些内容最适合从公众号迁移过去。";
  }

  return `当前最值得迁移到公众号长文的方向是《${topPost.title}》这类题材，因为它已经证明自己能在短内容里拿到互动，适合扩写成“案例 + 方法 + 复盘”的长文结构。`;
}
