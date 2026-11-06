import type { AiProvider, SiteSettings, AiKeyStatus } from "../shared/types";
import type { Env } from "./env";

export interface DescriptionInput {
  name: string;
  url: string;
  categoryName?: string;
  tags?: string[];
  currentDescription?: string;
}

export interface DescriptionResult {
  description: string;
  provider: AiProvider;
  model: string;
}

export function defaultModel(provider: AiProvider): string {
  switch (provider) {
    case "deepseek":
      return "deepseek-chat";
    case "gemini":
      return "gemini-2.5-flash";
    case "openai":
      return "gpt-4o-mini";
    default:
      return "openai";
  }
}

export function aiKeysStatus(env: Env): AiKeyStatus {
  return {
    pollinations: true,
    openai: Boolean(env.AI_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY || env.AI_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY || env.AI_API_KEY),
  };
}

function buildPrompt(input: DescriptionInput): string {
  const lines = [
    "你是「锦囊书签」的编辑。请为下面这个网站写一段中文介绍。",
    "要求：",
    "1. 45-85 个汉字，1-2 句话，信息密度高。",
    "2. 说明它是什么、主要用途、适合谁。",
    "3. 客观克制，不使用营销口吻，不编造功能。",
    "4. 不要以“该网站”“这是一个”开头；不要标题、引号、项目符号或换行。",
    "5. 只输出介绍正文。",
    "",
    `网站名称：${input.name}`,
    `网址：${input.url}`,
    input.categoryName ? `所属分类：${input.categoryName}` : "",
    input.tags?.length ? `标签：${input.tags.join("、")}` : "",
    input.currentDescription ? `已有描述（仅作为参考，不要照抄）：${input.currentDescription}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function cleanDescription(raw: string): string {
  let text = raw
    .replace(/^\s*[#*>-]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  const firstSentence = text.split(/(?<=[。！？!?])\s*/)[0];
  if (firstSentence && firstSentence.length >= 18) text = firstSentence;
  if (text.length > 180) text = `${text.slice(0, 176).replace(/[，、,；;：:]$/, "")}……`;
  return text;
}

async function timedFetch(url: string, init: RequestInit, timeout = 25000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}

async function viaOpenAICompatible(
  provider: "openai" | "deepseek",
  env: Env,
  settings: SiteSettings,
  prompt: string,
): Promise<string> {
  const isDeepSeek = provider === "deepseek";
  const apiKey = isDeepSeek ? env.DEEPSEEK_API_KEY || env.AI_API_KEY : env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(isDeepSeek ? "未配置 DEEPSEEK_API_KEY" : "未配置 AI_API_KEY");
  }
  const base = (settings.aiBaseUrl || env.AI_BASE_URL || (isDeepSeek ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const model = settings.aiModel || defaultModel(provider);
  const response = await timedFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 240,
      stream: false,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`AI 服务返回 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 服务没有返回介绍内容");
  return content;
}

async function viaPollinations(env: Env, settings: SiteSettings, prompt: string): Promise<string> {
  const model = settings.aiModel || "openai";
  const response = await timedFetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "iNav/1.0",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 240,
      referrer: "iNav",
    }),
  });
  if (!response.ok) {
    throw new Error(`免费 AI 服务返回 ${response.status}，可稍后重试或在后台切换模型`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const content = data.choices?.[0]?.message?.content;
    if (content) return content;
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    if (error) throw new Error(`免费 AI 服务：${error}`);
    throw new Error("免费 AI 服务没有返回介绍内容");
  }
  return await response.text();
}

async function viaGemini(env: Env, settings: SiteSettings, prompt: string): Promise<string> {
  const apiKey = env.GEMINI_API_KEY || env.AI_API_KEY;
  if (!apiKey) throw new Error("未配置 GEMINI_API_KEY");
  const model = settings.aiModel || defaultModel("gemini");
  const base = settings.aiBaseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const response = await timedFetch(
    `${base.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 300 },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`Gemini 返回 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!content) throw new Error("Gemini 没有返回介绍内容");
  return content;
}

export async function generateDescription(
  env: Env,
  settings: SiteSettings,
  input: DescriptionInput,
  override?: { provider?: AiProvider; model?: string; baseUrl?: string },
): Promise<DescriptionResult> {
  const provider = override?.provider ?? settings.aiProvider;
  const effective: SiteSettings = {
    ...settings,
    aiProvider: provider,
    aiModel: override?.model || settings.aiModel || defaultModel(provider),
    aiBaseUrl: override?.baseUrl ?? settings.aiBaseUrl,
  };
  const prompt = buildPrompt(input);
  let raw: string;
  if (provider === "pollinations") raw = await viaPollinations(env, effective, prompt);
  else if (provider === "gemini") raw = await viaGemini(env, effective, prompt);
  else raw = await viaOpenAICompatible(provider, env, effective, prompt);

  const description = cleanDescription(raw);
  if (description.length < 12) throw new Error("AI 返回的内容过短，请重试");
  return { description, provider, model: effective.aiModel };
}
