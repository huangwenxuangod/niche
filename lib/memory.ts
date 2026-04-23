import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MEMORY_ROOT = path.join(process.cwd(), "memory");

export async function getUserMemory(userId: string) {
  return readMemoryFile(getUserMemoryPath(userId));
}

export async function getJourneyMemory(journeyId: string) {
  return readMemoryFile(getJourneyMemoryPath(journeyId));
}

export async function saveUserMemory(userId: string, markdown: string) {
  await writeMemoryFile(getUserMemoryPath(userId), markdown.trim());
}

export async function saveJourneyMemory(journeyId: string, markdown: string) {
  await writeMemoryFile(getJourneyMemoryPath(journeyId), markdown.trim());
}

export async function syncUserIdentityMemory(userId: string, identityMemo: string) {
  const current = await getUserMemory(userId);
  const next = upsertSection(
    current || defaultUserMemory(),
    "我是谁",
    identityMemo.trim() || "（暂未填写）"
  );
  await saveUserMemory(userId, next);
  return next;
}

export async function ensureJourneyMemory(params: {
  journeyId: string;
  platform: string;
  nicheLevel1: string;
  nicheLevel2: string;
  nicheLevel3: string;
}) {
  const existing = await getJourneyMemory(params.journeyId);
  if (existing) return existing;

  const markdown = [
    "# 旅程记忆",
    "",
    "## 当前赛道",
    `${params.platform} | ${params.nicheLevel1} > ${params.nicheLevel2} > ${params.nicheLevel3}`,
    "",
    "## 选题偏好",
    "- 待沉淀",
    "",
    "## 风格偏好",
    "- 待沉淀",
    "",
    "## 已确认选题",
    "- 暂无",
    "",
    "## 用户反馈",
    "- 暂无",
  ].join("\n");

  await saveJourneyMemory(params.journeyId, markdown);
  return markdown;
}

export async function captureMessageMemory(params: {
  userId: string;
  journeyId: string;
  content: string;
}) {
  const entries = inferMemoryEntries(params.content);
  if (!entries.length) return;

  let userMemory = (await getUserMemory(params.userId)) || defaultUserMemory();
  let journeyMemory = (await getJourneyMemory(params.journeyId)) || defaultJourneyMemory();

  for (const entry of entries) {
    if (entry.scope === "user") {
      userMemory = appendBullet(userMemory, entry.section, entry.text);
    } else {
      journeyMemory = appendBullet(journeyMemory, entry.section, entry.text);
    }
  }

  await Promise.all([
    saveUserMemory(params.userId, userMemory),
    saveJourneyMemory(params.journeyId, journeyMemory),
  ]);
}

export async function appendJourneyMemory(journeyId: string, section: string, text: string) {
  const current = (await getJourneyMemory(journeyId)) || defaultJourneyMemory();
  const next = appendBullet(current, section, text);
  await saveJourneyMemory(journeyId, next);
  return next;
}

function inferMemoryEntries(content: string) {
  const text = content.trim();
  const entries: Array<{
    scope: "user" | "journey";
    section: string;
    text: string;
  }> = [];

  if (!text) return entries;

  if (/(以后|之后|接下来).*(风格|语气|写法)|我(更)?喜欢.*(风格|语气|写法)|按.*风格写/.test(text)) {
    entries.push({
      scope: "user",
      section: "风格偏好",
      text,
    });
  }

  if (/(选题|方向|主题).*(喜欢|优先|偏好|想做)|我(更)?喜欢.*(选题|方向|主题)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "选题偏好",
      text,
    });
  }

  if (/(这个选题不错|这个方向可以|采用这个选题|就写这个|这个可以写)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "已确认选题",
      text,
    });
  }

  if (/(太空了|不要这种|太像别人了|这个不错|这个很好|这个不行|不喜欢这个)/.test(text)) {
    entries.push({
      scope: "journey",
      section: "用户反馈",
      text,
    });
  }

  return entries;
}

function appendBullet(markdown: string, section: string, text: string) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const current = ensureSection(markdown, section, "- 暂无");
  const marker = `- ${cleanText}`;
  if (current.includes(marker)) return current;

  const regex = new RegExp(`(## ${escapeRegex(section)}\\n)([\\s\\S]*?)(\\n## |$)`);
  const match = current.match(regex);
  if (!match) return current;

  const body = match[2]
    .split("\n")
    .filter((line) => line.trim() && line.trim() !== "- 暂无");
  const nextBody = [...body, marker].join("\n");

  return current.replace(regex, `$1${nextBody}$3`);
}

function upsertSection(markdown: string, section: string, body: string) {
  const current = ensureSection(markdown, section, "（暂未填写）");
  const regex = new RegExp(`(## ${escapeRegex(section)}\\n)([\\s\\S]*?)(\\n## |$)`);
  return current.replace(regex, `$1${body.trim() || "（暂未填写）"}$3`);
}

function ensureSection(markdown: string, section: string, defaultBody: string) {
  if (markdown.includes(`## ${section}`)) {
    return markdown;
  }

  return `${markdown.trim()}\n\n## ${section}\n${defaultBody}`;
}

function defaultUserMemory() {
  return [
    "# 用户记忆",
    "",
    "## 我是谁",
    "（暂未填写）",
    "",
    "## 风格偏好",
    "- 暂无",
    "",
    "## 选题偏好",
    "- 暂无",
  ].join("\n");
}

function defaultJourneyMemory() {
  return [
    "# 旅程记忆",
    "",
    "## 当前赛道",
    "（暂未初始化）",
    "",
    "## 选题偏好",
    "- 暂无",
    "",
    "## 风格偏好",
    "- 暂无",
    "",
    "## 已确认选题",
    "- 暂无",
    "",
    "## 用户反馈",
    "- 暂无",
  ].join("\n");
}

function getUserMemoryPath(userId: string) {
  return path.join(MEMORY_ROOT, "users", `${userId}.md`);
}

function getJourneyMemoryPath(journeyId: string) {
  return path.join(MEMORY_ROOT, "journeys", `${journeyId}.md`);
}

async function readMemoryFile(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function writeMemoryFile(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content.trim()}\n`, "utf8");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
