import { z } from "zod";

export const ProjectCardPatchSchema = z.object({
  project_name: z.string().min(1).optional(),
  niche: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  positioning: z.string().min(1).optional(),
  target_user: z.string().min(1).optional(),
  monetization_model: z.string().min(1).optional(),
  core_value: z.string().min(1).optional(),
  current_stage: z.string().min(1).optional(),
  current_goal: z.string().min(1).optional(),
  success_metric: z.string().min(1).optional(),
  content_style: z.string().min(1).optional(),
  distribution_channels: z.array(z.string().min(1)).max(6).optional(),
});

export const JourneyStrategyPatchSchema = z.object({
  confirmed_benchmarks: z.array(z.string().min(1)).max(6).optional(),
  confirmed_directions: z.array(z.string().min(1)).max(6).optional(),
  current_content_strategy: z.string().min(1).optional(),
  last_generated_asset: z.string().min(1).optional(),
  last_publish_state: z.string().min(1).optional(),
  current_blockers: z.array(z.string().min(1)).max(6).optional(),
  current_todos: z.array(z.string().min(1)).max(6).optional(),
  next_best_action: z.string().min(1).optional(),
  current_problem: z.string().min(1).optional(),
  current_focus_keyword: z.string().min(1).optional(),
  focus_confidence: z.number().min(0).max(1).optional(),
  current_benchmark_name: z.string().min(1).optional(),
  last_search_mode: z.string().min(1).optional(),
  last_successful_keyword: z.string().min(1).optional(),
  next_best_question: z.string().min(1).optional(),
});

export const ProjectMemoryUpdateSchema = z.object({
  project_card_patch: ProjectCardPatchSchema.default({}),
  strategy_patch: JourneyStrategyPatchSchema.default({}),
});

export type ProjectMemoryUpdateStructuredOutput = z.infer<typeof ProjectMemoryUpdateSchema>;
