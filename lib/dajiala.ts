const BASE_URL = "https://www.dajiala.com/fbmain/monitor/v3";

async function post<T>(path: string, data: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.DAJIALA_API_KEY;
  if (!apiKey) {
    throw new Error("DAJIALA_API_KEY not configured");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: apiKey,
      ...data
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function get<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.DAJIALA_API_KEY;
  if (!apiKey) {
    throw new Error("DAJIALA_API_KEY not configured");
  }

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("key", apiKey);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString(), {
    method: "GET",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export interface DajialaArticleListItem {
  title: string;
  url: string;
  post_time: number;
  cover_url?: string;
  original?: number;
  digest?: string;
  author?: string;
  copyright_stat?: number;
  ip_wording?: string;
  item_show_type?: number;
  real_item_show_type?: number;
  idx?: number;
  msg_daily_idx?: number;
  create_time?: number;
  biz?: string;
  alias?: string;
  source_url?: string;
  video_page_infos?: unknown;
}

export interface DajialaPostHistoryResult {
  code: number;
  msg?: string;
  articles: DajialaArticleListItem[];
  mp_nickname?: string;
  mp_wxid?: string;
  mp_ghid?: string;
  head_img?: string;
  cost_money?: number;
  remain_money?: number;
  raw: unknown;
}

type DajialaPostHistoryRaw = {
  code?: number | string;
  msg?: string;
  data?: DajialaArticleListItem[] | (Record<string, unknown> & {
    list?: DajialaArticleListItem[];
  });
  mp_nickname?: string;
  mp_wxid?: string;
  mp_ghid?: string;
  head_img?: string;
  cost_money?: number;
  remain_money?: number;
};

export interface DajialaArticleDetail {
  code?: number;
  msg?: string;
  cost_money?: number;
  remain_money?: number;
  title: string;
  content: string;
  content_multi_text?: string;
  digest?: string;
  desc?: string;
  url?: string;
  author?: string;
}

type DajialaArticleDetailRaw = {
  code?: number;
  msg?: string;
  data?: DajialaArticleDetail;
  title?: string;
  content?: string;
  content_multi_text?: string;
  digest?: string;
  desc?: string;
  url?: string;
  author?: string;
  cost_money?: number;
  remain_money?: number;
};

export interface DajialaArticleStats {
  read: number;
  zan: number;
  looking: number;
  share_num: number;
  collect_num: number;
  comment_count: number;
}

export interface DajialaPostHistoryResponse {
  code: number;
  msg: string;
  data: {
    mp_nickname?: string;
    mp_wxid?: string;
    mp_ghid?: string;
    head_img?: string;
    cost_money?: number;
    remain_money?: number;
    list: DajialaArticleListItem[];
  };
}

export interface DajialaHotArticle {
  url: string;
  mp_nickname: string;
  title: string;
  pub_time: string;
  wxid: string;
  hot: number;
  read_num: number;
  fans: number;
  cover?: string;
  avg?: number;
  category?: string;
  position?: number;
  is_original?: string;
  publish_type?: string;
}

export interface DajialaHotSearchResponse {
  code: number;
  msg: string;
  cost?: number;
  remain_money?: number;
  total?: number;
  total_page?: number;
  data: DajialaHotArticle[];
}

export interface DajialaHistoryByGhidArticle {
  title: string;
  digest?: string;
  item_index?: number;
  content_url?: string;
  source_url?: string;
  cover_img_url?: string;
  cover_img_url_1_1?: string;
  cover_img_url_235_1?: string;
  cover_img_url_16_9?: string;
  item_show_type?: number;
  is_original?: boolean;
  send_time?: number;
  read?: number;
  zan?: number;
}

export interface DajialaHistoryByGhidResult {
  code: number;
  msg?: string;
  cost?: number;
  remain_money?: number;
  account?: {
    ghid?: string;
    nickname?: string;
    service_type?: number;
    head_img_url?: string;
  };
  finder?: {
    v2_name?: string;
    nickname?: string;
  };
  has_article?: boolean;
  articles: DajialaHistoryByGhidArticle[];
  paging?: {
    offset?: string;
    is_end?: number;
  };
  ip_wording?: string;
  gender?: number;
  ban_reason?: string[];
  raw: unknown;
}

type DajialaHistoryByGhidRaw = {
  code?: number;
  msg?: string;
  cost?: number;
  remain_money?: number;
  VideoFinderInfo?: {
    user_name?: string;
    nickname?: string;
  };
  AccountInfo?: {
    UserName?: string;
    ServiceType?: number;
    NickName?: string;
    HeadImgUrl?: string;
  };
  HasArtile?: boolean;
  MsgList?: {
    Msg?: Array<{
      AppMsg?: {
        DetailInfo?: Array<{
          Title?: string;
          Digest?: string;
          ItemIndex?: number;
          ContentUrl?: string;
          SourceUrl?: string;
          CoverImgUrl?: string;
          CoverImgUrl_1_1?: string;
          CoverImgUrl_235_1?: string;
          CoverImgUrl_16_9?: string;
          ItemShowType?: number;
          IsOriginal?: number;
          send_time?: number;
          Read?: number;
          Zan?: number;
        }>;
      };
    }>;
  };
  PagingInfo?: {
    Offset?: string;
    IsEnd?: number;
  };
  IPWording?: string;
  Gender?: number;
  BanReason?: string[];
};

export interface DajialaWxvideoPost {
  media_type?: string;
  object_id: string;
  export_id?: string;
  object_nonce_id?: string;
  fav_count?: number;
  like_count?: number;
  forward_count?: number;
  comment_count?: number;
  sticky_time?: string;
  download_url?: string;
  decode_key?: string;
  publish_time?: string;
  cover_url?: string;
  thumb_url?: string;
  file_size?: number;
  video_play_len?: number;
}

export interface DajialaWxvideoPostsResult {
  code: number;
  msg?: string;
  cost?: number;
  remain_money?: number;
  feeds_count?: number;
  original_count?: number;
  last_buffer?: string;
  continue_flag?: number;
  items: DajialaWxvideoPost[];
  raw: unknown;
}

type DajialaWxvideoPostsRaw = {
  code?: number;
  msg?: string;
  cost?: number;
  remain_money?: number;
  feeds_count?: number;
  original_count?: number;
  last_buffer?: string;
  continue_flag?: number;
  object?: Array<Record<string, unknown>>;
  data?: {
    object?: Array<Record<string, unknown>>;
    feeds_count?: number;
    original_count?: number;
    last_buffer?: string;
    continue_flag?: number;
  };
};

export interface DajialaWxvideoMetricsResult {
  code: number;
  cost?: number;
  remain_money?: number;
  last_buffer?: string;
  down_continue_flag?: number;
  count_info: {
    comment_count: number;
    like_count: number;
    forward_count: number;
    fav_count: number;
  };
  raw: unknown;
}

type DajialaWxvideoMetricsRaw = {
  code?: number;
  cost?: number;
  remain_money?: number;
  last_buffer?: string;
  down_continue_flag?: number;
  count_info?: {
    comment_count?: number;
    like_count?: number;
    forward_count?: number;
    fav_count?: number;
  };
};

// 大佳啦 post_history API 参数说明
// 根据 API 文档，参数为 biz、url、name 任选一个：
// - name: 公众号名称或微信ID（字符串）
// - biz: biz 标识（字符串）
// - url: 公众号文章完整 URL（字符串）
//
// 优先级：biz > url > name
// 推荐使用：name 参数（公众号名称）

export const dajiala = {
  getPostHistory: async (input: string, page = 1) => {
    const params: Record<string, unknown> = {
      page,
      verifycode: "",
    };

    // 判断输入类型，只给一个参数赋值，其他字段不传！
    if (input.startsWith("http")) {
      params.url = input;
    } else if (input.includes("http://mp.weixin.qq.com/") || input.includes("mp.weixin.qq.com/")) {
      // 微信公众号文章 URL，使用 url 参数
      params.url = input;
    } else {
      // 其他情况都用 name（公众号名称）
      params.name = input;
    }

    console.log("[dajiala] Calling post_history with params:", params);
    const res = await post<DajialaPostHistoryRaw>("/post_history", params);
    console.log("[dajiala] post_history full response:", res);

    return normalizePostHistory(res);
  },

  getPostHistoryByAccount: async (account: { name?: string | null; wxid?: string | null; ghid?: string | null }, page = 1) => {
    const params: Record<string, unknown> = {
      page,
      verifycode: "",
    };

    if (account.name) {
      params.name = account.name;
    } else if (account.wxid) {
      params.wxid = account.wxid;
    } else if (account.ghid) {
      params.ghid = account.ghid;
    } else {
      throw new Error("Missing account identifier");
    }

    console.log("[dajiala] Calling post_history by account with params:", params);
    const res = await post<DajialaPostHistoryRaw>("/post_history", params);
    console.log("[dajiala] post_history by account full response:", res);
    return normalizePostHistory(res);
  },

  getArticleDetail: async (url: string) => {
    const res = await get<DajialaArticleDetailRaw>("/article_detail", { url, mode: 2 });

    const detail: DajialaArticleDetailRaw = res.data && typeof res.data === "object"
      ? res.data
      : res;

    return {
      code: Number(detail.code ?? res.code ?? 0),
      msg: detail.msg ?? res.msg,
      cost_money: detail.cost_money ?? res.cost_money,
      remain_money: detail.remain_money ?? res.remain_money,
      title: detail.title ?? "",
      content: detail.content ?? "",
      content_multi_text: detail.content_multi_text ?? "",
      digest: detail.digest ?? detail.desc ?? "",
      desc: detail.desc ?? detail.digest ?? "",
      url: detail.url ?? url,
      author: detail.author ?? "",
    } satisfies DajialaArticleDetail;
  },

  getArticleStats: async (url: string) => {
    const res = await post<{
      code: number;
      msg: string;
      data: DajialaArticleStats;
    }>("/read_zan_pro", { url });
    return res.data;
  },

  searchHotArticles: async (keyword: string, startTime: string, endTime: string, category = "0", page = "1") => {
    const res = await post<DajialaHotSearchResponse>("/hot_typical_search", {
      keyword,
      category,
      page,
      start_time: startTime,
      end_time: endTime,
    });
    return res;
  },

  getHistoryByGhid: async (input: { ghid?: string; url?: string; verifycode?: string }) => {
    if (!input.ghid && !input.url) {
      throw new Error("Missing ghid or url");
    }

    const res = await post<DajialaHistoryByGhidRaw>("/history_by_ghid", {
      ghid: input.ghid || "",
      url: input.url || "",
      get_finder: 1,
      verifycode: input.verifycode || "",
    });
    return normalizeHistoryByGhid(res);
  },

  getWxvideoPosts: async (input: {
    v2_name: string;
    last_buffer?: string;
    verifycode?: string;
  }) => {
    const res = await post<DajialaWxvideoPostsRaw>("/wxvideo", {
      v2_name: input.v2_name,
      last_buffer: input.last_buffer || "",
      verifycode: input.verifycode || "",
      type: "1",
    });
    return normalizeWxvideoPosts(res);
  },

  getWxvideoPostMetrics: async (input: {
    object_id: string;
    object_nonce_id?: string;
    last_buffer?: string;
    verifycode?: string;
  }) => {
    const res = await post<DajialaWxvideoMetricsRaw>("/wxvideo", {
      object_id: input.object_id,
      object_nonce_id: input.object_nonce_id || "",
      last_buffer: input.last_buffer || "",
      verifycode: input.verifycode || "",
      type: 9,
    });
    return normalizeWxvideoMetrics(res);
  },
};

function normalizePostHistory(res: DajialaPostHistoryRaw): DajialaPostHistoryResult {
  const data = res?.data;
  const dataObject = data && !Array.isArray(data) ? data : {};
  const articles = Array.isArray(data)
    ? data
    : Array.isArray(dataObject.list)
      ? dataObject.list
      : [];

  return {
    code: Number(res?.code ?? 0),
    msg: res?.msg,
    articles,
    mp_nickname: res?.mp_nickname ?? stringFromUnknown(dataObject.mp_nickname),
    mp_wxid: res?.mp_wxid ?? stringFromUnknown(dataObject.mp_wxid),
    mp_ghid: res?.mp_ghid ?? stringFromUnknown(dataObject.mp_ghid),
    head_img: normalizeImageUrl(res?.head_img ?? dataObject.head_img),
    cost_money: res?.cost_money ?? numberFromUnknown(dataObject.cost_money),
    remain_money: res?.remain_money ?? numberFromUnknown(dataObject.remain_money),
    raw: res,
  };
}

function normalizeHistoryByGhid(res: DajialaHistoryByGhidRaw): DajialaHistoryByGhidResult {
  const msgList = Array.isArray(res.MsgList?.Msg) ? res.MsgList.Msg : [];
  const articles = msgList.flatMap((msg) => {
    const detailInfo = Array.isArray(msg.AppMsg?.DetailInfo) ? msg.AppMsg?.DetailInfo : [];
    return detailInfo.map((item) => ({
      title: item.Title || "",
      digest: item.Digest,
      item_index: item.ItemIndex,
      content_url: item.ContentUrl,
      source_url: item.SourceUrl,
      cover_img_url: normalizeImageUrl(item.CoverImgUrl),
      cover_img_url_1_1: normalizeImageUrl(item.CoverImgUrl_1_1),
      cover_img_url_235_1: normalizeImageUrl(item.CoverImgUrl_235_1),
      cover_img_url_16_9: normalizeImageUrl(item.CoverImgUrl_16_9),
      item_show_type: item.ItemShowType,
      is_original: item.IsOriginal === 1,
      send_time: item.send_time,
      read: item.Read,
      zan: item.Zan,
    }));
  });

  return {
    code: Number(res.code ?? 0),
    msg: res.msg,
    cost: res.cost,
    remain_money: res.remain_money,
    account: res.AccountInfo
      ? {
          ghid: res.AccountInfo.UserName,
          nickname: res.AccountInfo.NickName,
          service_type: res.AccountInfo.ServiceType,
          head_img_url: normalizeImageUrl(res.AccountInfo.HeadImgUrl),
        }
      : undefined,
    finder: res.VideoFinderInfo
      ? {
          v2_name: res.VideoFinderInfo.user_name,
          nickname: res.VideoFinderInfo.nickname,
        }
      : undefined,
    has_article: res.HasArtile,
    articles,
    paging: res.PagingInfo
      ? {
          offset: res.PagingInfo.Offset,
          is_end: res.PagingInfo.IsEnd,
        }
      : undefined,
    ip_wording: res.IPWording,
    gender: res.Gender,
    ban_reason: Array.isArray(res.BanReason) ? res.BanReason : undefined,
    raw: res,
  };
}

function normalizeWxvideoPosts(res: DajialaWxvideoPostsRaw): DajialaWxvideoPostsResult {
  const itemsRaw = Array.isArray(res.object)
    ? res.object
    : Array.isArray(res.data?.object)
      ? res.data.object
      : [];

  return {
    code: Number(res.code ?? 0),
    msg: res.msg,
    cost: res.cost,
    remain_money: res.remain_money,
    feeds_count: res.feeds_count ?? res.data?.feeds_count,
    original_count: res.original_count ?? res.data?.original_count,
    last_buffer: res.last_buffer ?? res.data?.last_buffer,
    continue_flag: res.continue_flag ?? res.data?.continue_flag,
    items: itemsRaw
      .map((item) => normalizeWxvideoPost(item))
      .filter((item): item is DajialaWxvideoPost => Boolean(item?.object_id)),
    raw: res,
  };
}

function normalizeWxvideoPost(item: Record<string, unknown>): DajialaWxvideoPost | null {
  const objectId = stringFromUnknown(item.object_id);
  if (!objectId) return null;

  return {
    media_type: stringFromUnknown(item.media_type),
    object_id: objectId,
    export_id: stringFromUnknown(item.export_id),
    object_nonce_id: stringFromUnknown(item.object_nonce_id),
    fav_count: numberFromNumberish(item.fav_count),
    like_count: numberFromNumberish(item.like_count),
    forward_count: numberFromNumberish(item.forward_count),
    comment_count: numberFromNumberish(item.comment_count),
    sticky_time: stringFromUnknown(item.sticky_time),
    download_url: stringFromUnknown(item.download_url),
    decode_key: stringFromUnknown(item.decode_key),
    publish_time: stringFromUnknown(item.publish_time),
    cover_url: normalizeImageUrl(item.cover_url),
    thumb_url: normalizeImageUrl(item.thumb_url),
    file_size: numberFromNumberish(item.file_size),
    video_play_len: numberFromNumberish(item.video_play_len),
  };
}

function normalizeWxvideoMetrics(res: DajialaWxvideoMetricsRaw): DajialaWxvideoMetricsResult {
  return {
    code: Number(res.code ?? 0),
    cost: res.cost,
    remain_money: res.remain_money,
    last_buffer: res.last_buffer,
    down_continue_flag: res.down_continue_flag,
    count_info: {
      comment_count: numberFromNumberish(res.count_info?.comment_count) ?? 0,
      like_count: numberFromNumberish(res.count_info?.like_count) ?? 0,
      forward_count: numberFromNumberish(res.count_info?.forward_count) ?? 0,
      fav_count: numberFromNumberish(res.count_info?.fav_count) ?? 0,
    },
    raw: res,
  };
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function numberFromNumberish(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeImageUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return undefined;
  return url.trim().replace(/^http:\/\//, "https://");
}
