import type { ChatIntent } from "./chat-intent-router";

export type ArticleMode = "normal" | "high_leverage_article";

export type CognitiveGap =
  | "judgment"
  | "anxiety"
  | "event"
  | "personal"
  | "conflict";

export function detectArticleMode(
  userContent: string,
  intent: ChatIntent
): ArticleMode {
  if (intent !== "full_article" && intent !== "general") return "normal";
  const text = userContent.replace(/\s+/g, "");
  if (
    /(爆文|卡兹克|事件解读|深度长文|借.*写|模仿.*写|技术奇点|发布会|OpenAI|Claude|Gemma|DeepMind|workspaceagents|GPT-5\.5)/i.test(
      text
    )
  ) {
    return "high_leverage_article";
  }
  return "normal";
}

export function explicitlyWantsDirectDraft(userContent: string) {
  const text = userContent.replace(/\s+/g, "");
  return /(直接写|直接成稿|直接出稿|现在就写|现在直接写|不要继续分析|别再分析|不要继续挖|直接输出文章|直接给我全文)/.test(
    text
  );
}

export function explicitlyWantsDeepening(userContent: string) {
  const text = userContent.replace(/\s+/g, "");
  return /(继续深入|继续挖|继续分析|先别写|不要急着写|先想清楚|先提炼|继续拆|继续往下挖)/.test(
    text
  );
}

export function detectPrimaryCognitiveGap(
  userContent: string
): CognitiveGap | null {
  const text = userContent.trim();

  const hasJudgment =
    /(我认为|我觉得|我判断|真正的问题是|本质上|核心是|说白了|大家都理解错了|我反对)/.test(
      text
    );
  if (!hasJudgment) return "judgment";

  const hasAudienceOrAnxiety =
    /(普通人|创作者|内容创作者|博主|产品人|打工人|创业者|新媒体|焦虑|痛点|卡住|不会用|跟不上|赚不到钱|被替代)/.test(
      text
    );
  if (!hasAudienceOrAnxiety) return "anxiety";

  const hasConcreteEvent =
    /(GPT-5\.5|workspace agents|workspaceagents|Claude Opus 4\.7|Claude Design|Gemma 4|OpenAI|Anthropic|DeepMind|Google I\/O|发布会|更新|发布|上线|模型)/i.test(
      text
    );
  if (!hasConcreteEvent) return "event";

  const hasPersonalTrace =
    /(我自己|我踩过|我吃过亏|我发现|我观察到|我试过|让我最烦|我最受不了|我之前|我的经历)/.test(
      text
    );
  if (!hasPersonalTrace) return "personal";

  const hasConflict =
    /(我反对|我最烦|错在|误解|根本不是|不是.*而是|真正不是|别再|不要再|大多数人都错了)/.test(
      text
    );
  if (!hasConflict) return "conflict";

  return null;
}

export function buildGapInstruction(gap: CognitiveGap) {
  switch (gap) {
    case "judgment":
      return "当前最主要的认知缺口是：判断缺口。不要直接成稿，先只问一个问题：`你真正想让读者相信什么？`";
    case "anxiety":
      return "当前最主要的认知缺口是：焦虑缺口。不要直接成稿，先只问一个问题：`你这篇东西到底在替谁解决哪一种焦虑？`";
    case "event":
      return "当前最主要的认知缺口是：事件缺口。不要直接成稿，先只问一个问题：`你想借哪个具体事件，把这个判断打出去？`";
    case "personal":
      return "当前最主要的认知缺口是：个人性缺口。不要直接成稿，先只问一个问题：`你为什么会对这个问题这么敏感？你自己踩过什么坑？`";
    case "conflict":
      return "当前最主要的认知缺口是：冲突缺口。不要直接成稿，先只问一个问题：`你最反对现在大家在这个问题上的哪种共识？`";
    default:
      return "";
  }
}

export function buildGapQuestion(gap: CognitiveGap) {
  switch (gap) {
    case "judgment":
      return "先别急着写，我先只问一个最关键的问题：你真正想让读者相信什么？";
    case "anxiety":
      return "先别急着写，我先只问一个最关键的问题：你这篇东西到底在替谁解决哪一种焦虑？";
    case "event":
      return "先别急着写，我先只问一个最关键的问题：你想借哪个具体事件，把这个判断打出去？";
    case "personal":
      return "先别急着写，我先只问一个最关键的问题：你为什么会对这个问题这么敏感？你自己踩过什么坑？";
    case "conflict":
      return "先别急着写，我先只问一个最关键的问题：你最反对现在大家在这个问题上的哪种共识？";
    default:
      return "先别急着写，我先只问一个最关键的问题。";
  }
}
