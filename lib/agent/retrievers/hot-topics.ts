import type { HotTopicContext } from "@/lib/hot-topic-search";
import { searchHotTopicCandidates } from "@/lib/hot-topic-search";

export async function retrieveHotTopics(params: {
  baseQuery: string;
  journey: HotTopicContext | null;
  maxResults?: number;
  days?: number;
}) {
  return searchHotTopicCandidates(params);
}
