import type { createClient } from "@/lib/supabase/server";

export type ToolContextJourney = {
  keywords?: string[];
  platform?: string | null;
  primaryBenchmarkName?: string | null;
  primaryBenchmarkId?: string | null;
};

export type ToolExecutionContext = {
  journeyId: string;
  userId: string;
  supabase: ReturnType<typeof createClient>;
  journey: ToolContextJourney | null;
  conversationId?: string; // 用于情景记忆记录
};
