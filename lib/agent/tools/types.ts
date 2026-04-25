import type { createClient } from "@/lib/supabase/server";

export type ToolContextJourney = {
  keywords?: string[];
  niche_level1?: string | null;
  niche_level2?: string | null;
  niche_level3?: string | null;
  platform?: string | null;
};

export type ToolExecutionContext = {
  journeyId: string;
  userId: string;
  supabase: ReturnType<typeof createClient>;
  journey: ToolContextJourney | null;
};
