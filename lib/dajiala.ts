const BASE_URL = "https://www.dajiala.com/fbmain/monitor/v3";

async function post<T>(path: string, data: any): Promise<T> {
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

async function get<T>(path: string, params: any): Promise<T> {
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
  video_page_infos?: any;
}

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
    const params: any = {
      biz: "",
      url: "",
      name: "",
      page,
      verifycode: "",
    };

    // 判断输入类型，只给一个参数赋值
    if (input.startsWith("http")) {
      params.url = input;
    } else {
      // 其他情况都用 name
      params.name = input;
    }

    const res = await post<DajialaPostHistoryResponse>("/post_history", params);
    return res.data;
  },

  getArticleList: async (ghid: string, page = 1) => {
    const res = await post<{
      code: number;
      msg: string;
      data: {
        list: DajialaArticleListItem[];
      };
    }>("/post_history", {
      wxid: ghid,
      page,
    });
    return res.data?.list || [];
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
