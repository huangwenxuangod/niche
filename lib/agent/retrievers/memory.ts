import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatJourneyProjectMemoryForPrompt,
  getJourneyMemory,
  getJourneyProjectMemory,
  getUserMemory,
} from "@/lib/memory";

export async function retrieveMemoryContext(
  supabase: SupabaseClient,
  params: {
    userId: string;
    journeyId: string;
  }
) {
  const [userMemory, journeyMemory, journeyProjectMemory] = await Promise.all([
    getUserMemory(supabase, params.userId),
    getJourneyMemory(supabase, params.journeyId),
    getJourneyProjectMemory(supabase, params.journeyId),
  ]);

  return {
    userMemory,
    journeyMemory,
    journeyProjectMemory,
    formattedProjectMemory: formatJourneyProjectMemoryForPrompt(journeyProjectMemory),
  };
}
