import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const analyzePublishTimingSchema = z.object({
  scope: z
    .enum(["auto", "wechat_mp", "wechat_channels"])
    .optional()
    .describe("分析范围：公众号、视频号或自动判断"),
});

export const analyzePublishTimingToolDefinition: AgentToolDefinition<
  typeof analyzePublishTimingSchema
> = {
  name: "analyze_publish_timing",
  description: `
【功能】分析当前旅程样本内容的发布时间规律，给出更容易起量的发布时间段建议

【适用场景】
- 什么时候发布更容易起量
- 几点发更合适
- 发布时间怎么选
- 哪个时间段更容易出高阅读/高互动

【参数】
- scope: auto（默认）/ wechat_mp / wechat_channels
`,
  schema: analyzePublishTimingSchema,
};

type WechatArticleRow = {
  publish_time: string | null;
  read_count: number | null;
  is_viral: boolean | null;
  title: string | null;
};

type WxvideoPostRow = {
  publish_time: string | null;
  like_count: number | null;
  comment_count: number | null;
  forward_count: number | null;
  title: string | null;
};

type TimingSample = {
  title: string;
  publishTime: string;
  score: number;
  isStrong: boolean;
};

export async function runAnalyzePublishTiming(
  args: z.infer<typeof analyzePublishTimingSchema>,
  context: ToolExecutionContext
) {
  const scope = args.scope ?? "auto";

  const [wechatRes, wxvideoRes] = await Promise.all([
    context.supabase
      .from("knowledge_articles")
      .select("publish_time, read_count, is_viral, title")
      .eq("journey_id", context.journeyId)
      .not("publish_time", "is", null)
      .order("read_count", { ascending: false })
      .limit(60),
    context.supabase
      .from("wxvideo_posts")
      .select("publish_time, like_count, comment_count, forward_count, title")
      .eq("journey_id", context.journeyId)
      .not("publish_time", "is", null)
      .order("like_count", { ascending: false })
      .limit(60),
  ]);

  const wechatSamples = ((wechatRes.data ?? []) as WechatArticleRow[])
    .map((row) => normalizeWechatSample(row))
    .filter((item): item is TimingSample => item !== null);
  const wxvideoSamples = ((wxvideoRes.data ?? []) as WxvideoPostRow[])
    .map((row) => normalizeWxvideoSample(row))
    .filter((item): item is TimingSample => item !== null);

  const resolvedScope = resolveScope(scope, wechatSamples.length, wxvideoSamples.length, context);
  const samples = resolvedScope === "wechat_channels" ? wxvideoSamples : wechatSamples;

  if (!samples.length) {
    return {
      scope: resolvedScope,
      sample_size: 0,
      best_slots: [],
      patterns: ["现有发布时间样本还不够，建议先继续补内容样本后再分析发布时间规律。"],
      top_examples: [],
    };
  }

  const grouped = groupSamplesBySlot(samples);
  const rankedSlots = Object.entries(grouped)
    .map(([slot, bucket]) => {
      const avgScore = Math.round(bucket.reduce((sum, item) => sum + item.score, 0) / bucket.length);
      const strongCount = bucket.filter((item) => item.isStrong).length;
      return {
        slot,
        avg_score: avgScore,
        strong_ratio: Number((strongCount / bucket.length).toFixed(2)),
        sample_count: bucket.length,
      };
    })
    .sort((a, b) => {
      if (b.strong_ratio !== a.strong_ratio) return b.strong_ratio - a.strong_ratio;
      if (b.avg_score !== a.avg_score) return b.avg_score - a.avg_score;
      return b.sample_count - a.sample_count;
    });

  const bestSlots = rankedSlots.slice(0, 3).map((slot) => ({
    weekday: formatWeekday(slot.slot),
    hour_range: formatHourRange(slot.slot),
    avg_score: slot.avg_score,
    sample_count: slot.sample_count,
    strong_ratio: slot.strong_ratio,
    reason: `该时段样本 ${slot.sample_count} 条，强表现内容占比 ${Math.round(slot.strong_ratio * 100)}%。`,
  }));

  const patterns = buildTimingPatterns(bestSlots, resolvedScope);
  const topExamples = samples
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((sample) => ({
      title: sample.title,
      publish_time: sample.publishTime,
      score: sample.score,
    }));

  return {
    scope: resolvedScope,
    sample_size: samples.length,
    best_slots: bestSlots,
    patterns,
    top_examples: topExamples,
  };
}

function normalizeWechatSample(row: WechatArticleRow): TimingSample | null {
  if (!row.publish_time) return null;
  const score = row.read_count ?? 0;
  return {
    title: row.title || "未命名文章",
    publishTime: row.publish_time,
    score,
    isStrong: Boolean(row.is_viral) || score >= 10000,
  };
}

function normalizeWxvideoSample(row: WxvideoPostRow): TimingSample | null {
  if (!row.publish_time) return null;
  const score = (row.like_count ?? 0) + (row.comment_count ?? 0) * 3 + (row.forward_count ?? 0) * 5;
  return {
    title: row.title || "未命名作品",
    publishTime: row.publish_time,
    score,
    isStrong: score >= 500,
  };
}

function resolveScope(
  scope: z.infer<typeof analyzePublishTimingSchema>["scope"],
  wechatCount: number,
  wxvideoCount: number,
  context: ToolExecutionContext
) {
  if (scope && scope !== "auto") return scope;
  if (context.journey?.platform === "wechat_channels" && wxvideoCount > 0) {
    return "wechat_channels";
  }
  if (wechatCount > 0) return "wechat_mp";
  if (wxvideoCount > 0) return "wechat_channels";
  return context.journey?.platform === "wechat_channels" ? "wechat_channels" : "wechat_mp";
}

function groupSamplesBySlot(samples: TimingSample[]) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });

  const grouped: Record<string, TimingSample[]> = {};

  for (const sample of samples) {
    const parts = formatter.formatToParts(new Date(sample.publishTime));
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "周一";
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const hourBucket = `${Math.floor(hour / 4) * 4}`.padStart(2, "0");
    const key = `${weekday}|${hourBucket}`;
    grouped[key] ??= [];
    grouped[key].push(sample);
  }

  return grouped;
}

function formatWeekday(slot: string) {
  return slot.split("|")[0] || "未知";
}

function formatHourRange(slot: string) {
  const hour = Number(slot.split("|")[1] || "0");
  const end = (hour + 4) % 24;
  return `${String(hour).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00`;
}

function buildTimingPatterns(
  bestSlots: Array<{ weekday: string; hour_range: string; sample_count: number; strong_ratio: number }>,
  scope: string
) {
  if (!bestSlots.length) {
    return ["现有发布时间样本还不够，建议继续补样本后再分析。"];
  }

  const top = bestSlots[0];
  const patterns = [
    `${scope === "wechat_channels" ? "视频号" : "公众号"}当前表现最好的时段集中在 **${top.weekday} ${top.hour_range}**。`,
    `最佳时段样本数是 ${top.sample_count}，强表现内容占比约 ${Math.round(top.strong_ratio * 100)}%。`,
  ];

  if (bestSlots.length > 1) {
    const second = bestSlots[1];
    patterns.push(`次优时段是 **${second.weekday} ${second.hour_range}**，适合做备选发布时间。`);
  }

  return patterns;
}
