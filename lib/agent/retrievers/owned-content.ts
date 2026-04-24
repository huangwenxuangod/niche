import type { SupabaseClient } from "@supabase/supabase-js";

export async function retrieveOwnedContent(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    accountName?: string;
    limit?: number;
  }
) {
  let query = supabase
    .from("owned_wechat_articles")
    .select("title, digest, content, read_num, like_num, share_num, comment_num, favorite_num, publish_time, account_name")
    .eq("journey_id", params.journeyId)
    .order("publish_time", { ascending: false })
    .limit(params.limit ?? 20);

  if (params.accountName?.trim()) {
    query = query.ilike("account_name", `%${params.accountName.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => ({
    title: item.title as string,
    digest: (item.digest as string | null) ?? null,
    content: (item.content as string | null) ?? null,
    read_num: Number(item.read_num ?? 0),
    like_num: Number(item.like_num ?? 0),
    share_num: Number(item.share_num ?? 0),
    comment_num: Number(item.comment_num ?? 0),
    favorite_num: Number(item.favorite_num ?? 0),
    publish_time: (item.publish_time as string | null) ?? null,
    account_name: (item.account_name as string | null) ?? null,
  }));
}
