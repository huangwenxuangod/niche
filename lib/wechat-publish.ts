import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ImageResponse } from "next/og";
import { createElement } from "react";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const FREEPUBLISH_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";
const DATACUBE_ARTICLE_SUMMARY_URL = "https://api.weixin.qq.com/datacube/getarticlesummary";
const DATACUBE_ARTICLE_TOTAL_URL = "https://api.weixin.qq.com/datacube/getarticletotal";

const GATEWAY_URL = process.env.WECHAT_GATEWAY_URL?.replace(/\/$/, "") || "";
const GATEWAY_TOKEN = process.env.WECHAT_GATEWAY_TOKEN || "";

type AccessTokenResponse = {
  access_token?: string;
  errcode?: number;
  errmsg?: string;
};

type UploadResponse = {
  media_id?: string;
  url?: string;
  errcode?: number;
  errmsg?: string;
};

type DraftAddResponse = {
  media_id?: string;
  errcode?: number;
  errmsg?: string;
};

type GatewayResponse<T> = T & {
  error?: string;
};

function getEncryptionKey() {
  const raw = process.env.WECHAT_CREDENTIALS_SECRET || "";
  if (!raw) {
    throw new Error("缺少 WECHAT_CREDENTIALS_SECRET，暂时无法保存公众号密钥。");
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptWechatSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptWechatSecret(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("公众号密钥格式无效。");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivText, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export async function fetchWechatAccessToken(appId: string, appSecret: string) {
  if (GATEWAY_URL) {
    const data = await callWechatGateway<AccessTokenResponse>("/v1/access-token", {
      appId,
      appSecret,
    });
    if (data.errcode || !data.access_token) {
      throw new Error(data.errmsg || data.error || "access_token 返回异常");
    }
    return data.access_token;
  }

  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取 access_token 失败：${res.status}`);
  }
  const data = (await res.json()) as AccessTokenResponse;
  if (data.errcode || !data.access_token) {
    throw new Error(data.errmsg || "access_token 返回异常");
  }
  return data.access_token;
}

export async function uploadWechatImageFromUrl(imageUrl: string, accessToken: string) {
  if (GATEWAY_URL) {
    const data = await callWechatGateway<UploadResponse>("/v1/material/upload-url", {
      imageUrl,
      accessToken,
    });
    if (data.errcode || !data.media_id) {
      throw new Error(data.errmsg || data.error || "封面图上传失败");
    }
    return data.media_id;
  }

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new Error("封面图下载失败，请检查图片链接是否可访问。");
  }
  const bytes = await imageRes.arrayBuffer();
  if (!bytes.byteLength) {
    throw new Error("封面图为空，请更换图片链接。");
  }

  const contentType = imageRes.headers.get("content-type") || "image/jpeg";
  if (contentType.includes("svg")) {
    throw new Error("当前微信素材接口不支持 SVG 封面，请改用 PNG 或 JPG。");
  }
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("gif")
      ? "gif"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
  const fileName = `cover.${extension}`;
  const form = new FormData();
  form.append(
    "media",
    new Blob([bytes], { type: contentType }),
    fileName
  );

  const uploadRes = await fetch(`${UPLOAD_MATERIAL_URL}?access_token=${encodeURIComponent(accessToken)}&type=image`, {
    method: "POST",
    body: form,
  });
  const uploadData = (await uploadRes.json()) as UploadResponse;
  if (uploadData.errcode || !uploadData.media_id) {
    throw new Error(uploadData.errmsg || "封面图上传失败");
  }
  return uploadData.media_id;
}

export async function buildWechatCoverDataUrl(title: string) {
  const normalizedTitle = title.trim() || "Niche 内容草稿";
  const maxCharsPerLine = 11;
  const maxLines = 2;
  const titleLines: string[] = [];

  for (let index = 0; index < normalizedTitle.length && titleLines.length < maxLines; index += maxCharsPerLine) {
    titleLines.push(normalizedTitle.slice(index, index + maxCharsPerLine));
  }

  const image = new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "900px",
          height: "383px",
          display: "flex",
          background: "#F4EBDD",
          padding: "34px",
          boxSizing: "border-box",
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        },
      },
      createElement(
        "div",
        {
          style: {
            width: "100%",
            height: "100%",
            borderRadius: "24px",
            background: "#FFFDF8",
            padding: "40px 38px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "relative",
            overflow: "hidden",
          },
        },
        createElement("div", {
          style: {
            width: "96px",
            height: "10px",
            borderRadius: "999px",
            background: "#D2B17C",
          },
        }),
        createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxWidth: "620px",
            },
          },
          ...titleLines.map((line) =>
            createElement(
              "div",
              {
                key: line,
                style: {
                  display: "flex",
                  fontSize: "44px",
                  lineHeight: 1.2,
                  fontWeight: 700,
                  color: "#17202A",
                  letterSpacing: "-0.02em",
                },
              },
              line
            )
          )
        ),
        createElement(
          "div",
          {
            style: {
              display: "flex",
              fontSize: "24px",
              color: "#5B6570",
            },
          },
          "微信公众号草稿封面"
        ),
        createElement("div", {
          style: {
            position: "absolute",
            right: "72px",
            top: "56px",
            width: "76px",
            height: "76px",
            borderRadius: "999px",
            background: "#F0DFC2",
          },
        }),
        createElement("div", {
          style: {
            position: "absolute",
            right: "116px",
            bottom: "54px",
            width: "38px",
            height: "38px",
            borderRadius: "999px",
            background: "#E6D2AE",
          },
        }),
        createElement("div", {
          style: {
            position: "absolute",
            right: "54px",
            bottom: "42px",
            width: "18px",
            height: "18px",
            borderRadius: "999px",
            background: "#D2B17C",
          },
        })
      )
    ),
    {
      width: 900,
      height: 383,
    }
  );

  const bytes = await image.arrayBuffer();
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function saveWechatDraft(params: {
  accessToken: string;
  title: string;
  author?: string;
  summary?: string;
  html: string;
  thumbMediaId: string;
}) {
  if (GATEWAY_URL) {
    const data = await callWechatGateway<DraftAddResponse>("/v1/draft/add", {
      accessToken: params.accessToken,
      title: params.title,
      author: params.author || "",
      summary: params.summary || "",
      html: params.html,
      thumbMediaId: params.thumbMediaId,
    });
    if (data.errcode || !data.media_id) {
      throw new Error(data.errmsg || data.error || "保存公众号草稿失败");
    }
    return data.media_id;
  }

  const res = await fetch(`${DRAFT_URL}?access_token=${encodeURIComponent(params.accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articles: [
        {
          article_type: "news",
          title: params.title,
          author: params.author || "",
          digest: params.summary || "",
          content: params.html,
          thumb_media_id: params.thumbMediaId,
          need_open_comment: 1,
          only_fans_can_comment: 0,
        },
      ],
    }),
  });

  const data = (await res.json()) as DraftAddResponse;
  if (data.errcode || !data.media_id) {
    throw new Error(data.errmsg || "保存公众号草稿失败");
  }
  return data.media_id;
}

export async function fetchWechatPublishedBatch(params: {
  accessToken: string;
  offset?: number;
  count?: number;
  noContent?: number;
}) {
  if (GATEWAY_URL) {
    return callWechatGateway<Record<string, unknown>>("/v1/freepublish/batchget", {
      accessToken: params.accessToken,
      offset: params.offset ?? 0,
      count: params.count ?? 20,
      noContent: params.noContent ?? 0,
    });
  }

  return postWechatJson(FREEPUBLISH_BATCHGET_URL, params.accessToken, {
    offset: params.offset ?? 0,
    count: params.count ?? 20,
    no_content: params.noContent ?? 0,
  });
}

export async function fetchWechatArticleSummary(params: {
  accessToken: string;
  beginDate: string;
  endDate: string;
}) {
  if (GATEWAY_URL) {
    return callWechatGateway<Record<string, unknown>>("/v1/datacube/articlesummary", params);
  }

  return postWechatJson(DATACUBE_ARTICLE_SUMMARY_URL, params.accessToken, {
    begin_date: params.beginDate,
    end_date: params.endDate,
  });
}

export async function fetchWechatArticleTotal(params: {
  accessToken: string;
  beginDate: string;
  endDate: string;
}) {
  if (GATEWAY_URL) {
    return callWechatGateway<Record<string, unknown>>("/v1/datacube/articletotal", params);
  }

  return postWechatJson(DATACUBE_ARTICLE_TOTAL_URL, params.accessToken, {
    begin_date: params.beginDate,
    end_date: params.endDate,
  });
}

async function callWechatGateway<T>(path: string, body: Record<string, unknown>) {
  if (!GATEWAY_URL) {
    throw new Error("未配置 WECHAT_GATEWAY_URL。");
  }

  if (!GATEWAY_TOKEN) {
    throw new Error("已配置 WECHAT_GATEWAY_URL，但缺少 WECHAT_GATEWAY_TOKEN。");
  }

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as GatewayResponse<T>;
  if (!res.ok) {
    throw new Error(data.error || `微信网关请求失败：${res.status}`);
  }
  return data;
}

async function postWechatJson(url: string, accessToken: string, payload: Record<string, unknown>) {
  const res = await fetch(`${url}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`微信接口请求失败：${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.errcode === "number" && data.errcode !== 0) {
    throw new Error(String(data.errmsg || "微信接口返回异常"));
  }

  return data;
}
