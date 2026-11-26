import type { AiProvider } from "./types";

/**
 * AI 供应商预设：后台「服务」下拉、默认接口地址、默认模型、关闭思考用的参数都从这里来，
 * worker 与 admin 前端共用同一份，避免两边各写一套导致对不上。
 *
 * 各家的差异都按官方文档校准过（2026-11 核对）：
 * - DeepSeek：`https://api.deepseek.com`，模型 `deepseek-flash` / `deepseek-v4-pro`，
 *   文档明确「默认开启思考模式」，不关的话 max_tokens 会被思考过程吃光、正文为空。
 * - 通义千问：OpenAI 兼容模式仍可用 `dashscope.aliyuncs.com`，千问 3 系列用 `enable_thinking`。
 * - 火山方舟：`/api/v3/chat/completions`，model 直接填模型 ID（`doubao-seed-2-1-lite-260915`），
 *   不再要求推理接入点 `ep-xxx`；关闭思考用 `thinking.type = disabled`。
 * - Gemini：`v1beta/models/{model}:generateContent`，2.5 系列用 `thinkingConfig.thinkingBudget = 0` 关思考。
 * - Pollinations：免费匿名接口，每个 IP 45 秒 1 次、每天 100 次，超了返回 402。
 */
export interface AiProviderPreset {
  id: AiProvider;
  label: string;
  /** 协议：openai = /chat/completions；gemini = :generateContent；pollinations = 免费公共接口 */
  protocol: "openai" | "gemini" | "pollinations";
  /** 默认接口根地址；custom 为空，必须自己填 */
  baseUrl: string;
  /** 默认模型；custom 为空，必须自己填 */
  model: string;
  /** 官方文档，后台设置页展示，方便用户查模型名和计费 */
  docsUrl: string;
  /** 密钥所在的环境变量，按优先级排列；后台设置里填了密钥时优先用设置里的 */
  keyEnv: string[];
  /** 历史/别名模型名 → 现在的正式名，读到旧配置时自动纠正 */
  aliases?: Record<string, string>;
  /** 供应商专属请求参数（关闭深度思考等），返回的字段会并入请求体 */
  extraBody?: (model: string) => Record<string, unknown>;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    docsUrl: "https://api-docs.deepseek.com/",
    keyEnv: ["DEEPSEEK_API_KEY", "AI_API_KEY"],
    // deepseek-chat / deepseek-reasoner 是旧名字，现在统一走 deepseek-flash（V4.1-Flash）
    aliases: {
      "deepseek-chat": "deepseek-flash",
      "deepseek-reasoner": "deepseek-flash",
      "deepseek-v4-flash": "deepseek-flash",
      "deepseek-v4-flash-vision-exp": "deepseek-flash",
    },
    extraBody: () => ({ thinking: { type: "disabled" } }),
  },
  {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    docsUrl: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
    keyEnv: ["DASHSCOPE_API_KEY", "QWEN_API_KEY", "AI_API_KEY"],
    extraBody: () => ({ enable_thinking: false }),
  },
  {
    id: "volcengine",
    label: "火山方舟（豆包）",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-1-lite-260915",
    docsUrl: "https://www.volcengine.com/docs/82379/1494384",
    keyEnv: ["ARK_API_KEY", "VOLCENGINE_API_KEY", "AI_API_KEY"],
    extraBody: () => ({ thinking: { type: "disabled" } }),
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    keyEnv: ["OPENAI_API_KEY", "AI_API_KEY"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    docsUrl: "https://ai.google.dev/api/generate-content",
    keyEnv: ["GEMINI_API_KEY", "AI_API_KEY"],
  },
  {
    id: "pollinations",
    label: "Pollinations（免费，无需密钥）",
    protocol: "pollinations",
    baseUrl: "https://text.pollinations.ai/openai",
    model: "openai",
    docsUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
    keyEnv: [],
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容接口）",
    protocol: "openai",
    baseUrl: "",
    model: "",
    docsUrl: "",
    keyEnv: ["AI_API_KEY"],
  },
];

export const AI_PROVIDERS: AiProvider[] = AI_PROVIDER_PRESETS.map((preset) => preset.id);

export function aiProviderPreset(id: AiProvider): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? AI_PROVIDER_PRESETS[0];
}

/** 把旧模型名纠正为当前正式名；空值回退到预设默认模型 */
export function resolveAiModel(provider: AiProvider, raw: string): string {
  const preset = aiProviderPreset(provider);
  const model = String(raw ?? "").trim();
  if (!model) return preset.model;
  return preset.aliases?.[model] ?? model;
}

/**
 * 默认提示词模板。变量用 `{name}` 这种大括号写法，
 * 渲染时空值变量所在整行会被丢弃（见 renderAiPrompt）。
 */
export const DEFAULT_AI_PROMPT = [
  "你是「{siteName}」的编辑。请为下面这个网站写一段中文介绍。",
  "要求：",
  "1. 45-85 个汉字，1-2 句话，信息密度高。",
  "2. 说明它是什么、主要用途、适合谁。",
  "3. 客观克制，不使用营销口吻，不编造功能。",
  "4. 不要以“该网站”“这是一个”开头；不要标题、引号、项目符号或换行。",
  "5. 只输出介绍正文。",
  "",
  "网站名称：{name}",
  "网址：{url}",
  "所属分类：{category}",
  "标签：{tags}",
  "已有描述（仅作参考，不要照抄）：{description}",
].join("\n");

/** 提示词里可用的变量，后台设置页原样展示给用户 */
export const AI_PROMPT_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "siteName", label: "站点名称" },
  { key: "name", label: "书签名称" },
  { key: "url", label: "网址" },
  { key: "category", label: "所属分类" },
  { key: "tags", label: "标签（顿号分隔）" },
  { key: "description", label: "已有描述" },
];

/**
 * 渲染提示词模板：逐行替换 `{key}`。
 * 某一行引用了「值为空」的变量时整行丢弃——例如没标签时 `标签：{tags}` 不会
 * 变成一行空的“标签：”，也不会把空信息喂给模型。
 */
export function renderAiPrompt(template: string, vars: Record<string, string>): string {
  const source = template.trim() ? template : DEFAULT_AI_PROMPT;
  const emptyPlaceholders = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([key]) => `{${key}}`);
  return source
    .split("\n")
    .map((line) => {
      if (emptyPlaceholders.some((placeholder) => line.includes(placeholder))) return "";
      let rendered = line;
      for (const [key, value] of Object.entries(vars)) {
        rendered = rendered.split(`{${key}}`).join(value);
      }
      return rendered;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
