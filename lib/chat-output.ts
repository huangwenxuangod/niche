export function buildFallbackMessage(userContent: string) {
  if (/(写稿|成稿|完整稿|文章)/.test(userContent)) {
    return "这轮写稿结果没有成功整理出来，请重新触发一次写稿。";
  }
  return "这轮我拿到了部分数据，但还没成功组织成有效回答。";
}
