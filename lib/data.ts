export const NICHE_TREE: Record<string, string[]> = {
  "AI与科技": [
    "AI产品体验",
    "AI工具教程",
    "AI行业分析",
    "AI编程开发",
    "AI设计",
    "AI创业",
  ],
  职场成长: ["职场技巧", "求职面试", "领导力", "时间管理", "副业变现", "远程工作"],
  生活方式: ["极简生活", "健身运动", "旅行探索", "美食烹饪", "家居设计", "穿搭风格"],
  财经商业: ["个人理财", "股票投资", "创业故事", "商业分析", "独立开发", "副业"],
  教育: ["学习方法", "英语学习", "编程教育", "考研备考", "留学申请", "职业转型"],
  健康: ["心理健康", "营养饮食", "运动健身", "睡眠优化", "冥想正念", "慢病管理"],
};

export const CONTENT_TYPES = [
  { key: "评测型", desc: "体验 → 评分 → 推荐" },
  { key: "教程型", desc: "步骤拆解，手把手教" },
  { key: "观点型", desc: "输出独特视角与判断" },
  { key: "记录型", desc: "真实过程，用户代入" },
  { key: "综合型", desc: "多种形式混搭" },
];

export const PLATFORMS = [
  { key: "wechat_mp", label: "公众号", available: true },
  { key: "xiaohongshu", label: "小红书", available: false },
  { key: "wechat_channels", label: "视频号", available: false },
];

export type Journey = {
  id: string;
  name: string;
  platform: string;
  niche_level1?: string | null;
  niche_level2?: string | null;
  niche_level3?: string | null;
  keywords?: string[] | null;
  is_active: boolean;
  knowledge_initialized: boolean;
  init_status: "pending" | "running" | "done" | "error";
  created_at: string;
};

export type Conversation = {
  id: string;
  journey_id: string;
  title: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  tool_used: string | null;
  created_at: string;
};

export type KOCSource = {
  id: string;
  journey_id: string;
  account_name: string;
  account_id: string | null;
  max_read_count: number;
  avg_read_count: number;
  article_count: number;
  is_manually_added: boolean;
  last_fetched_at: string | null;
};

export type WechatDashboardSummary = {
  article_count: number;
  total_reads: number;
  avg_reads: number;
  avg_likes: number;
  avg_shares: number;
  avg_comments: number;
  peak_reads: number;
};

export type WechatDashboardArticle = {
  id: string;
  title: string;
  read_num: number;
  like_num: number;
  share_num: number;
  comment_num: number;
  publish_time: string;
};

export type WechatDashboardData = {
  account: { name: string; avatar_url: string | null };
  summary: WechatDashboardSummary;
  articles: WechatDashboardArticle[];
  ai_insights: string;
};
