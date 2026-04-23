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
