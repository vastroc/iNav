export type LinkStatus = "unknown" | "alive" | "warn" | "dead";

export type AiProvider =
  | "pollinations"
  | "openai"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "volcengine"
  | "custom";

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  parentId: number | null;
  sortOrder: number;
  /** Includes sites in all descendant categories. */
  siteCount: number;
  children?: Category[];
}

export interface CategoryPathItem {
  id: number;
  name: string;
  slug: string;
}

export interface Site {
  id: number;
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  name: string;
  slug: string;
  url: string;
  domain: string;
  description: string;
  iconUrl: string;
  screenshotUrl: string;
  tags: string[];
  /** 该站点详情页被打开的次数 */
  views: number;
  /** 该站点外链被点开的次数 */
  jumps: number;
  aiGenerated: boolean;
  /** AI 简介是否正在后台生成 */
  aiPending: boolean;
  /** 上一次 AI 生成的失败原因，成功后清空 */
  aiError: string;
  linkStatus: LinkStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SiteDetail extends Site {
  detailContent: string;
  categoryPath: CategoryPathItem[];
}

export interface AdminSite extends Site {
  detailContent: string;
}

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  footerText: string;
  seoKeywords: string;
  /**
   * @deprecated 旧版「后台填写管理员名单」的存量值，仅用于升级提示，**不参与授权**。
   * 可登录后台的用户只认环境变量 ADMIN_GITHUB_LOGINS，后台已改为只读展示。
   */
  githubAdmins: string;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string;
  /** 自定义接口的密钥（旧字段，兼容存量数据）；新配置按供应商存在 aiKeys 里 */
  aiApiKey: string;
  /**
   * 各供应商在后台设置里保存的密钥，键是 provider id。
   * 只在 worker 侧使用：GET /api/admin/settings 会整块剥掉，只回 aiKeySaved 的布尔值。
   */
  aiKeys?: Partial<Record<AiProvider, string>>;
  /** 生成简介的提示词模板，支持 {name} 这类变量 */
  aiPrompt: string;
  commentsEnabled: boolean;
  commentModeration: boolean;
  bannedWords: string;
}

export interface SiteConfigPublic {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  footerText: string;
  seoKeywords: string;
  aiProvider: AiProvider;
  aiModel: string;
  commentsEnabled: boolean;
  commentModeration: boolean;
  showComments: boolean;
}

/**
 * 浏览上报的目标类型：站点详情页（sites.views）或页面（pages.views）。
 * 首页、关于页都是 pages 里的行，所以只有这两种。
 */
export type PageViewKind = "site" | "page";

export interface NavStats {
  totalSites: number;
  /** 全站浏览总数（sites.views + pages.views，含首页与关于页） */
  totalViews: number;
  /** 全站外链跳转总数（sites.jumps 求和） */
  totalJumps: number;
  totalComments: number;
  healthyLinks: number;
  deadLinks: number;
  unknownLinks: number;
  /** 今日所有页面被打开的总次数（daily_stats.views） */
  todayViews: number;
  /** 今日所有跳转的总次数（daily_stats.jumps） */
  todayJumps: number;
}

export interface NavPage {
  id: number;
  title: string;
  slug: string;
  showInNav: boolean;
  sortOrder: number;
}

/** 前台标签栏用：标签名 + 使用该标签的书签数 */
export interface NavTag {
  name: string;
  count: number;
}

export interface NavPayload {
  categories: Category[];
  sites: Site[];
  pages: NavPage[];
  settings: SiteConfigPublic;
  stats: NavStats;
  tags: NavTag[];
}

export interface PublicPage {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  /** 该页面被浏览次数（page_views，page_kind='page'） */
  views: number;
  updatedAt: string;
}

export interface AdminPage extends PublicPage {
  showInNav: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
}

export type CommentTargetType = "site" | "page";

export interface PublicComment {
  id: number;
  siteId: number | null;
  pageId: number | null;
  author: string;
  website: string;
  content: string;
  createdAt: string;
  /** 完整归属地（如「江苏省南京市 电信」），仅后台可见 */
  ipLocation?: string;
  /** 前台展示用：只到省份/国家，如「江苏」 */
  ipProvince?: string;
}

export interface CommentsPayload {
  comments: PublicComment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecentComment {
  id: number;
  author: string;
  content: string;
  createdAt: string;
  targetType: CommentTargetType;
  targetName: string;
  targetSlug: string;
}

export interface CaptchaChallenge {
  token: string;
  question: string;
  expiresAt: string;
}

export interface CommentSubmitResult {
  ok: boolean;
  status: "approved" | "pending";
  message: string;
  comment?: PublicComment;
}

export interface AuthUser {
  login: string;
  name: string;
  avatarUrl: string;
  provider: "github";
}

export interface AuthConfig {
  githubEnabled: boolean;
  /** 环境变量 ADMIN_GITHUB_LOGINS 是否配了人；为 false 时谁都无法登录，登录页要明确提示 */
  adminLoginsConfigured: boolean;
}

export interface AdminComment {
  id: number;
  siteId: number | null;
  pageId: number | null;
  targetType: CommentTargetType;
  targetName: string;
  targetSlug: string;
  author: string;
  email: string;
  website: string;
  content: string;
  status: "pending" | "approved" | "spam";
  ipHash: string;
  /** 评论来源 IP（明文，只在后台展示） */
  ip: string;
  /** 原始 UA */
  userAgent: string;
  /** 解析结果：手机 / 平板 / 桌面 / 爬虫 / 未知 */
  device: string;
  /** 解析结果：Chrome 120 / Safari 17 … */
  browser: string;
  /** 操作系统 + 主版本：Windows 10/11 / macOS 14 / iOS 17 / Android 14 */
  os: string;
  /** 归属地全称，如「江苏省南京市 电信」 */
  ipLocation: string;
  /** 归属地省级，如「江苏」 */
  ipProvince: string;
  createdAt: string;
}

export interface AdminCategory extends Category {
  directSiteCount: number;
  totalSiteCount: number;
}

export interface AiKeyStatus {
  pollinations: boolean;
  openai: boolean;
  deepseek: boolean;
  gemini: boolean;
  qwen: boolean;
  volcengine: boolean;
  custom: boolean;
}

export interface AdminSettingsPayload {
  settings: SiteSettings;
  /** 该供应商当前能不能生成（设置里存了、或环境变量里有） */
  aiKeys: AiKeyStatus;
  /** 各供应商在「设置」里是否存过密钥，用于输入框的占位提示（密钥本体不下发） */
  aiKeySaved: Record<AiProvider, boolean>;
  githubOauthConfigured: boolean;
  /** 环境变量里配置的管理员 GitHub 用户名（小写），后台只读展示，不接受写回 */
  adminLoginsFromEnv: string[];
}

export interface LinkCheckResult {
  siteId: number;
  siteName: string;
  status: LinkStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

/** 管理端标签：方案 A 不建表，按 sites.tags 的 JSON 实时聚合。 */
export interface AdminTag {
  name: string;
  /** 使用该标签的书签数量 */
  count: number;
}

export interface AdminTagsPayload {
  tags: AdminTag[];
  /** 至少带一个标签的书签数量 */
  totalSites: number;
}

export interface PaginatedAdminSites {
  sites: AdminSite[];
  total: number;
  page: number;
  pageSize: number;
}