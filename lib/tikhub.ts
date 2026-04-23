const BASE_URL = "https://api.tikhub.io";

async function tikhubFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.TIKHUB_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikHub ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export const tikhub = {
  wechatMP: {
    fetchArticleDetail: (articleUrl: string) =>
      tikhubFetch("/api/v1/wechat/web/fetch_mp_article_detail_json", {
        url: articleUrl,
      }),

    fetchArticleListByFakeid: (fakeid: string) =>
      tikhubFetch("/api/v1/wechat/web/fetch_mp_article_list", { fakeid }),

    fetchArticleListByGhid: (ghid: string, offset?: string) =>
      tikhubFetch("/api/v1/wechat_mp/web/fetch_mp_article_list", {
        ghid,
        ...(offset ? { offset } : {}),
      }),

    fetchArticleReadCount: (articleUrl: string) =>
      tikhubFetch("/api/v1/wechat/web/fetch_mp_article_read_count", {
        url: articleUrl,
      }),
  },
};
