import { z } from "zod";

export const GrowthAnalysisReportSchema = z.object({
  content_overview: z.object({
    posting_pattern: z.string().min(1),
    title_pattern: z.string().min(1),
    best_topics: z.array(z.string().min(1)).max(5),
  }),
  top_articles: z.array(
    z.object({
      title: z.string().min(1),
      read_num: z.number().int().nonnegative(),
      publish_time: z.string().nullable(),
      reason: z.string().min(1),
    })
  ).max(3),
  competitor_gap: z.object({
    overview: z.string().min(1),
    topic_gap: z.array(z.string().min(1)).max(5),
    title_gap: z.array(z.string().min(1)).max(5),
    structure_gap: z.array(z.string().min(1)).max(5),
  }),
  next_actions: z.array(z.string().min(1)).min(1).max(5),
});

export type GrowthAnalysisStructuredOutput = z.infer<typeof GrowthAnalysisReportSchema>;
