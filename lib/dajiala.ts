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
  }
};
