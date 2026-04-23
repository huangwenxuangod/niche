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

export interface DajialaAccount {
  name: string;
  biz: string;
  owner_name: string;
  customer_type: string;
  ghid: string;
  wxid: string;
  fans: number;
  avg_top_read: number;
  avg_top_like: number;
  avatar: string;
  qrcode: string;
  week_articles: number;
  signature?: string;
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
  title: string;
  content: string;
  content_multi_text?: string;
  digest?: string;
}

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

export const dajiala = {
  searchAccounts: async (keyword: string, page = 1, pageSize = 20) => {
    const res = await post<{
      code: number;
      msg: string;
      data: DajialaAccount[];
    }>("/wx_account/search", {
      keyword,
      page,
      page_size: pageSize,
      mode: 1,
    });
    return res.data || [];
  },

  getPostHistory: async (input: string, page = 1) => {
    const params: Record<string, unknown> = {
      page,
      verifycode: "",
    };

    // 判断输入类型，只给一个参数赋值，其他字段不传！
    if (input.startsWith("http")) {
      params.url = input;
    } else {
      // 其他情况都用 name
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
    const res = await get<{
      code: number;
      msg: string;
      data: DajialaArticleDetail;
    }>("/article_detail", { url });
    return res.data;
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
