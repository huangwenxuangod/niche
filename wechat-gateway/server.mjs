import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const FREEPUBLISH_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";
const DATACUBE_ARTICLE_SUMMARY_URL = "https://api.weixin.qq.com/datacube/getarticlesummary";
const DATACUBE_ARTICLE_TOTAL_URL = "https://api.weixin.qq.com/datacube/getarticletotal";

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "wechat-gateway", request_id: requestId });
    }

    if (!authorize(req)) {
      return sendJson(res, 401, { error: "Unauthorized gateway request", request_id: requestId });
    }

    const body = await readJson(req);

    if (req.method === "POST" && url.pathname === "/v1/access-token") {
      requireFields(body, ["appId", "appSecret"]);
      const data = await fetchWechatAccessToken(body.appId, body.appSecret);
      return sendJson(res, 200, { request_id: requestId, ...data });
    }

    if (req.method === "POST" && url.pathname === "/v1/material/upload-url") {
      requireFields(body, ["accessToken", "imageUrl"]);
      const mediaId = await uploadWechatImageFromUrl(body.imageUrl, body.accessToken);
      return sendJson(res, 200, { request_id: requestId, media_id: mediaId });
    }

    if (req.method === "POST" && url.pathname === "/v1/draft/add") {
      requireFields(body, ["accessToken", "title", "html", "thumbMediaId"]);
      const mediaId = await saveWechatDraft(body);
      return sendJson(res, 200, { request_id: requestId, media_id: mediaId });
    }

    if (req.method === "POST" && url.pathname === "/v1/freepublish/batchget") {
      requireFields(body, ["accessToken"]);
      const payload = await postWechatJson(FREEPUBLISH_BATCHGET_URL, body.accessToken, {
        offset: Number(body.offset || 0),
        count: Number(body.count || 20),
        no_content: Number(body.noContent || 0),
      });
      return sendJson(res, 200, { request_id: requestId, ...payload });
    }

    if (req.method === "POST" && url.pathname === "/v1/datacube/articlesummary") {
      requireFields(body, ["accessToken", "beginDate", "endDate"]);
      const payload = await postWechatJson(DATACUBE_ARTICLE_SUMMARY_URL, body.accessToken, {
        begin_date: body.beginDate,
        end_date: body.endDate,
      });
      return sendJson(res, 200, { request_id: requestId, ...payload });
    }

    if (req.method === "POST" && url.pathname === "/v1/datacube/articletotal") {
      requireFields(body, ["accessToken", "beginDate", "endDate"]);
      const payload = await postWechatJson(DATACUBE_ARTICLE_TOTAL_URL, body.accessToken, {
        begin_date: body.beginDate,
        end_date: body.endDate,
      });
      return sendJson(res, 200, { request_id: requestId, ...payload });
    }

    return sendJson(res, 404, { error: "Not found", request_id: requestId });
  } catch (error) {
    return sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Gateway request failed",
      request_id: requestId,
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[wechat-gateway] listening on :${PORT}`);
});

function authorize(req) {
  if (!GATEWAY_TOKEN) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${GATEWAY_TOKEN}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!body[field]) {
      throw new Error(`Missing field: ${field}`);
    }
  }
}

async function fetchWechatAccessToken(appId, appSecret) {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取 access_token 失败：${res.status}`);
  }
  const data = await res.json();
  if (data.errcode || !data.access_token) {
    throw new Error(data.errmsg || "access_token 返回异常");
  }
  return data;
}

async function uploadWechatImageFromUrl(imageUrl, accessToken) {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error("封面图下载失败，请检查图片链接是否可访问。");
  }
  const bytes = await imageRes.arrayBuffer();
  if (!bytes.byteLength) {
    throw new Error("封面图为空，请更换图片链接。");
  }

  const contentType = imageRes.headers.get("content-type") || "image/jpeg";
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("gif")
      ? "gif"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: contentType }), `cover.${extension}`);

  const uploadRes = await fetch(`${UPLOAD_MATERIAL_URL}?access_token=${encodeURIComponent(accessToken)}&type=image`, {
    method: "POST",
    body: form,
  });
  const uploadData = await uploadRes.json();
  if (uploadData.errcode || !uploadData.media_id) {
    throw new Error(uploadData.errmsg || "封面图上传失败");
  }
  return uploadData.media_id;
}

async function saveWechatDraft({ accessToken, title, author = "", summary = "", html, thumbMediaId }) {
  const res = await fetch(`${DRAFT_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articles: [
        {
          article_type: "news",
          title,
          author,
          digest: summary,
          content: html,
          thumb_media_id: thumbMediaId,
          need_open_comment: 1,
          only_fans_can_comment: 0,
        },
      ],
    }),
  });
  const data = await res.json();
  if (data.errcode || !data.media_id) {
    throw new Error(data.errmsg || "保存公众号草稿失败");
  }
  return data.media_id;
}

async function postWechatJson(url, accessToken, payload) {
  const res = await fetch(`${url}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`微信接口请求失败：${res.status}`);
  }
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || "微信接口返回异常");
  }
  return data;
}
