import { z } from "zod";

export const ArticleOutputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  body_markdown: z.string().min(1),
  alt_titles: z.array(z.string().min(1)).max(5).optional().default([]),
});

export type ArticleOutputStructured = z.infer<typeof ArticleOutputSchema>;
