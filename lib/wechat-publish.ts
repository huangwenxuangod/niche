import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";

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

export function buildWechatCoverDataUrl(title: string) {
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const svg = `
    <svg width="900" height="383" viewBox="0 0 900 383" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="383" rx="32" fill="#F4EBDD"/>
      <rect x="34" y="34" width="832" height="315" rx="24" fill="#FFFDF8"/>
      <rect x="72" y="74" width="96" height="10" rx="5" fill="#D2B17C"/>
      <rect x="72" y="98" width="210" height="10" rx="5" fill="#E6D2AE"/>
      <text x="72" y="172" fill="#17202A" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="42" font-weight="700">
        ${safeTitle.slice(0, 18)}
      </text>
      <text x="72" y="230" fill="#5B6570" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="24">
        微信公众号草稿封面
      </text>
      <circle cx="794" cy="112" r="38" fill="#F0DFC2"/>
      <circle cx="756" cy="258" r="20" fill="#E6D2AE"/>
      <circle cx="815" cy="282" r="12" fill="#D2B17C"/>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function saveWechatDraft(params: {
  accessToken: string;
  title: string;
  author?: string;
  summary?: string;
  html: string;
  thumbMediaId: string;
}) {
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
