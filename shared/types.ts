export type LinkStatus = "unknown" | "alive" | "warn" | "dead";

export type AiProvider =
  | "pollinations"
  | "openai"
  | "deepseek"
  | "gemini";

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
  detailEnabled: boolean;
  sortOrder: number;
  views: number;
  aiGenerated: boolean;
  linkStatus: LinkStatus;
  linkStatusCode: number | null;
  linkCheckedAt: string | null;
  linkLatencyMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteDetail extends Site {
  detailContent: string;
  categoryPath: CategoryPathItem[];
}

export interface AdminSite extends Site {
  isVisible: boolean;
  detailContent: string;
}

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  footerText: string;
  aboutContent: string;
  seoKeywords: string;
  githubAdmins: string;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string;
  commentsEnabled: boolean;
  commentModeration: boolean;
  bannedWords: string;
}

export interface SiteConfigPublic {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  footerText: string;
  aboutContent: string;
  seoKeywords: string;
  aiProvider: AiProvider;
  aiModel: string;
  commentsEnabled: boolean;
  commentModeration: boolean;
  showComments: boolean;
}

export interface NavStats {
  totalSites: number;
  totalViews: number;
  totalComments: number;
  healthyLinks: number;
  deadLinks: number;
  unknownLinks: number;
  todayViews: number;
}

export interface NavPage {
  id: number;
  title: string;
  slug: string;
  showInNav: boolean;
  sortOrder: number;
}

export interface NavPayload {
  categories: Category[];
  sites: Site[];
  pages: NavPage[];
  settings: SiteConfigPublic;
  stats: NavStats;
  tags: string[];
}

export interface PublicPage {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
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
}

export interface AdminSettingsPayload {
  settings: SiteSettings;
  aiKeys: AiKeyStatus;
  githubOauthConfigured: boolean;
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

export interface PaginatedAdminSites {
  sites: AdminSite[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: string;
  detail?: string;
}