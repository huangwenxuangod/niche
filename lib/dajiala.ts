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

// 大佳啦 post_history API 参数说明
// 根据搜索结果，API 接受的参数类型：
// - name: 公众号名称（字符串）
// - biz: biz 或 url 标识（布尔值）
// - url: 公众号完整 URL（字符串）
//
// 推荐使用：优先使用 name 参数，避免使用 biz/url 方式

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
      // 其他情况都用 account_name（公众号名称）
      params.account_name = input;
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

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function normalizeImageUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return undefined;
  return url.trim().replace(/^http:\/\//, "https://");
}
