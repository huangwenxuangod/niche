import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dajiala,
  type DajialaHistoryByGhidResult,
  type DajialaWxvideoPost,
} from "@/lib/dajiala";

type KocSourceForWxvideo = {
  id: string;
  journey_id: string;
  account_name: string | null;
  account_id: string | null;
  ghid?: string | null;
};

type ImportedWxvideoPost = {
  likeCount: number;
};

const DEFAULT_WXVIDEO_IMPORT_LIMIT = 3;

export async function discoverBoundWxvideoFromKoc(
  _supabase: SupabaseClient,
  koc: KocSourceForWxvideo
) {
  const ghid = koc.ghid || koc.account_id;
  if (!ghid) {
    return {
      success: false,
      bound: false,
      reason: "missing_ghid",
    } as const;
  }

  const history = await dajiala.getHistoryByGhid({ ghid });
  assertDajialaCodeOk(history.code, history.msg);

  const finder = history.finder;
  if (!finder?.v2_name) {
    return {
      success: true,
      bound: false,
      history,
    } as const;
  }

  return {
    success: true,
    bound: true,
    finder,
    history,
  } as const;
}

export async function importBoundWxvideoFromKoc(
  supabase: SupabaseClient,
  koc: KocSourceForWxvideo,
  options?: {
    limit?: number;
  }
) {
  const discovery = await discoverBoundWxvideoFromKoc(supabase, koc);
  if (!discovery.success || !discovery.bound) {
    return discovery;
  }

  const source = await upsertWxvideoSource(supabase, {
    journeyId: koc.journey_id,
    linkedKocSourceId: koc.id,
    v2Name: discovery.finder.v2_name || "",
    accountName: discovery.finder.nickname || null,
    history: discovery.history,
  });

  const importResult = await importWxvideoForJourney(supabase, {
    journeyId: koc.journey_id,
    wxvideoSourceId: source.id,
    v2Name: discovery.finder.v2_name || "",
    limit: options?.limit ?? DEFAULT_WXVIDEO_IMPORT_LIMIT,
  });

  return {
    success: true,
    bound: true,
    sourceId: source.id,
    finder: discovery.finder,
    importedCount: importResult.importedCount,
  };
}

export async function importWxvideoForJourney(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    wxvideoSourceId: string;
    v2Name: string;
    limit?: number;
  }
) {
  const list = await dajiala.getWxvideoPosts({
    v2_name: params.v2Name,
  });
  assertDajialaCodeOk(list.code, list.msg);

  const items = list.items.slice(0, params.limit ?? DEFAULT_WXVIDEO_IMPORT_LIMIT);
  const imported = await Promise.all(
    items.map((item) =>
      saveWxvideoPostWithMetrics(supabase, {
        journeyId: params.journeyId,
        wxvideoSourceId: params.wxvideoSourceId,
        post: item,
      })
    )
  );

  await supabase
    .from("wxvideo_sources")
    .update({
      feed_count: list.feeds_count ?? items.length,
      original_count: list.original_count ?? 0,
      max_like_count: imported.length ? Math.max(...imported.map((item) => item.likeCount)) : 0,
      avg_like_count: imported.length
        ? Math.round(imported.reduce((sum, item) => sum + item.likeCount, 0) / imported.length)
        : 0,
      last_buffer: list.last_buffer ?? null,
      last_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.wxvideoSourceId);

  return {
    success: true,
    importedCount: imported.length,
  };
}

async function upsertWxvideoSource(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    linkedKocSourceId: string;
    v2Name: string;
    accountName: string | null;
    history: DajialaHistoryByGhidResult;
  }
) {
  const { data, error } = await supabase
    .from("wxvideo_sources")
    .upsert(
      {
        journey_id: params.journeyId,
        linked_koc_source_id: params.linkedKocSourceId,
        platform: "wechat_channels",
        v2_name: params.v2Name,
        account_name: params.accountName,
        avatar_url: params.history.account?.head_img_url ?? null,
        last_fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "journey_id,v2_name" }
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("保存视频号来源失败");
  }

  return { id: data.id as string };
}

async function saveWxvideoPostWithMetrics(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    wxvideoSourceId: string;
    post: DajialaWxvideoPost;
  }
): Promise<ImportedWxvideoPost> {
  const metrics = await dajiala.getWxvideoPostMetrics({
    object_id: params.post.object_id,
    object_nonce_id: params.post.object_nonce_id,
  });
  assertDajialaCodeOk(metrics.code);

  const likeCount = metrics.count_info.like_count || params.post.like_count || 0;
  const favCount = metrics.count_info.fav_count || params.post.fav_count || 0;
  const forwardCount = metrics.count_info.forward_count || params.post.forward_count || 0;
  const commentCount = metrics.count_info.comment_count || params.post.comment_count || 0;

  const { error } = await supabase.from("wxvideo_posts").upsert(
    {
      journey_id: params.journeyId,
      wxvideo_source_id: params.wxvideoSourceId,
      object_id: params.post.object_id,
      export_id: params.post.export_id,
      object_nonce_id: params.post.object_nonce_id,
      media_type: params.post.media_type,
      title: null,
      cover_url: params.post.cover_url,
      thumb_url: params.post.thumb_url,
      download_url: params.post.download_url,
      decode_key: params.post.decode_key,
      publish_time: normalizeIsoDate(params.post.publish_time),
      file_size: params.post.file_size,
      video_play_len: params.post.video_play_len,
      fav_count: favCount,
      like_count: likeCount,
      forward_count: forwardCount,
      comment_count: commentCount,
      is_live: params.post.media_type === "直播",
      source_type: "bound_wechat_account",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "journey_id,object_id" }
  );

  if (error) {
    throw new Error(`保存视频号作品失败: ${params.post.object_id} - ${error.message}`);
  }

  return {
    likeCount,
  };
}

function normalizeIsoDate(value?: string) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function assertDajialaCodeOk(code: number, msg?: string) {
  if (code !== 0 && code !== 200) {
    throw new Error(`API错误: code=${code}${msg ? `, msg=${msg}` : ""}`);
  }
}
