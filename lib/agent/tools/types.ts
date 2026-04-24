import type { createClient } from "@/lib/supabase/server";

export type ToolContextJourney = {
  keywords?: string[];
  niche_level1?: string;
  niche_level2?: string;
  niche_level3?: string;
};

export type ToolExecutionContext = {
  journeyId: string;
  userId: string;
  supabase: ReturnType<typeof createClient>;
  journey: ToolContextJourney | null;
};
