export function normalizeAccountName(raw: string) {
  let text = String(raw || "").trim();
  if (!text) return "";

  text = text
    .replace(/[“”"'‘’《》【】\[\]()（）]/g, " ")
    .replace(/[，。！？、；：,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const prefixPatterns = [
    /^(帮我|给我|麻烦|请|想|我想|我想看|我想研究|我想对标|我要|我准备|我想导入)/,
    /^(对标一下|对标|导入一下|导入|添加一下|添加|同步一下|同步|分析一下|分析|研究一下|研究|看看|看下|查一下|查下)/,
  ];
  for (const pattern of prefixPatterns) {
    text = text.replace(pattern, "").trim();
  }

  text = text
    .replace(/^(这个|这个号|这个公众号|这个账号|那个号|那个公众号|那个账号)\s*/i, "")
    .replace(/\s*(作为对标|做对标|拿来对标|拿来研究)$/i, "")
    .replace(/\s*(这个号|这个公众号|这个账号)$/i, "")
    .replace(/\s*(的号|的公众号|的账号)(嘛|吗|呢|呀|啊|吧)?$/i, "")
    .replace(/\s*(号|公众号|账号)(嘛|吗|呢|呀|啊|吧)?$/i, "")
    .replace(/\s*(嘛|吗|呢|呀|啊|吧|呗)$/i, "")
    .trim();

  text = text.replace(/\s+/g, " ").trim();

  if (!text) return "";

  const quoted =
    raw.match(/[“"']([^“”"'‘’]+)[”"']/)?.[1]?.trim() ||
    raw.match(/《([^》]+)》/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  return text;
}

