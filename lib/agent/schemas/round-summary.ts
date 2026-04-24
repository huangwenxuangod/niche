import { z } from "zod";

export const RoundSummarySchema = z.object({
  user_intent: z.string().min(1),
  confirmed_decisions: z.array(z.string().min(1)).max(6),
  produced_outputs: z.array(z.string().min(1)).max(6),
  open_questions: z.array(z.string().min(1)).max(6),
  next_action: z.string().min(1),
});

export type RoundSummaryStructuredOutput = z.infer<typeof RoundSummarySchema>;
