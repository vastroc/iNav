import type { AiKeyStatus, AiProvider, SiteSettings } from "../shared/types";
import { AI_PROVIDERS, DEFAULT_AI_PROMPT, aiProviderPreset, renderAiPrompt, resolveAiModel } from "../shared/ai";
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

/** 单次 AI 请求超时。后台生成走 waitUntil，响应返回后最多还能跑 30s，这里留出落库余量 */
const AI_TIMEOUT_MS = 22000;
/** 输出上限：一段 85 字的中文介绍远用不到这么多，留足余量即可，给思考模式的模型兜底 */
const MAX_OUTPUT_TOKENS = 600;

export function defaultModel(provider: AiProvider): string {
  return aiProviderPreset(provider).model;
}

/**
 * 取某个供应商要用的密钥。
 * 优先级：后台设置里保存的（settings.aiKeys[provider]） > 环境变量兜底。
 * 这样用户只需要在后台「设置 → AI 简介」里填一次，不必碰 Cloudflare 的 Variables and Secrets。
 */
export function aiApiKey(env: Env, settings: SiteSettings, provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  const saved = settings.aiKeys?.[provider];
  if (saved) return saved;
  // 兼容早期只有「自定义接口密钥」一栏时的存量数据
  if (provider === "custom" && settings.aiApiKey) return settings.aiApiKey;
  for (const name of preset.keyEnv) {
    const value = (env as unknown as Record<string, string | undefined>)[name];
    if (value) return value;
  }
  return "";
}

/** 该供应商是否已经保存过密钥（只用于后台展示，不下发密钥本体） */
export function aiKeysSaved(settings: SiteSettings): Record<AiProvider, boolean> {
  const result = {} as Record<AiProvider, boolean>;
  for (const provider of AI_PROVIDERS) {
    result[provider] = Boolean(settings.aiKeys?.[provider] || (provider === "custom" && settings.aiApiKey));
  }
  return result;
}

/** 该供应商当前是否具备生成条件（有密钥、自定义还要求接口地址和模型） */
export function aiConfigured(env: Env, settings: SiteSettings, provider = settings.aiProvider): boolean {
  const preset = aiProviderPreset(provider);
  if (preset.protocol === "pollinations") return true;
  const base = settings.aiBaseUrl || env.AI_BASE_URL || preset.baseUrl;
  if (!base) return false;
  if (!resolveAiModel(provider, settings.aiModel)) return false;
  return Boolean(aiApiKey(env, settings, provider));
}

export function aiKeysStatus(env: Env, settings: SiteSettings): AiKeyStatus {
  const saved = aiKeysSaved(settings);
  return {
    pollinations: true,
    openai: Boolean(saved.openai || env.OPENAI_API_KEY || env.AI_API_KEY),
    deepseek: Boolean(saved.deepseek || env.DEEPSEEK_API_KEY || env.AI_API_KEY),
    gemini: Boolean(saved.gemini || env.GEMINI_API_KEY || env.AI_API_KEY),
    qwen: Boolean(saved.qwen || env.DASHSCOPE_API_KEY || env.QWEN_API_KEY || env.AI_API_KEY),
    volcengine: Boolean(saved.volcengine || env.ARK_API_KEY || env.VOLCENGINE_API_KEY || env.AI_API_KEY),
    custom: Boolean(saved.custom || env.AI_API_KEY),
  };
}

function buildPrompt(input: DescriptionInput, settings: SiteSettings): string {
  return renderAiPrompt(settings.aiPrompt || DEFAULT_AI_PROMPT, {
    siteName: settings.siteName || "锦囊书签",
    name: input.name,
    url: input.url,
    category: input.categoryName ?? "",
    tags: input.tags?.join("、") ?? "",
    description: input.currentDescription ?? "",
  });
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

async function timedFetch(url: string, init: RequestInit, timeout = AI_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`AI 服务 ${Math.round(timeout / 1000)} 秒内没有响应，请稍后重试或换一个服务`);
    }
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
  }
}

function missingKeyMessage(provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  const names = preset.keyEnv.filter((name) => name !== "AI_API_KEY");
  const hint = names.length ? names.join(" / ") : "AI_API_KEY";
  return `还没有填写 ${preset.label} 的 API Key，请在「设置 → AI 简介」里填入（环境变量 ${hint} 也可作为兜底）`;
}

function resolveBaseUrl(env: Env, settings: SiteSettings, provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  // 后台填的接口地址优先，其次环境变量，最后用预设默认值
  const base = settings.aiBaseUrl || env.AI_BASE_URL || preset.baseUrl;
  if (!base) throw new Error("自定义接口需要先在「设置 → AI 简介」里填写接口地址（例如 https://api.example.com/v1）");
  return base.replace(/\/+$/, "");
}

interface ChatChoice {
  message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
  finish_reason?: string | null;
}

/** 从 OpenAI 兼容响应里取正文；空正文时给出可操作的提示（思考模式吃额度是目前最常见的原因） */
function readChatContent(data: { choices?: ChatChoice[] }, label: string): string {
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (content) return content;
  const reasoning = (choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? "").trim();
  if (reasoning) {
    throw new Error(
      `${label} 只返回了思考过程、没有正文：模型默认开启思考，把输出额度用完了。请改用非思考模型，或把「模型」换成该供应商的普通对话模型`,
    );
  }
  if (choice?.finish_reason === "length") {
    throw new Error(`${label} 的输出被长度上限截断，请重试`);
  }
  throw new Error(`${label} 没有返回介绍内容`);
}

/**
 * OpenAI 兼容协议调用。
 * 不同供应商/模型对参数的容忍度不一样（新 OpenAI 推理模型只认 max_completion_tokens、
 * 部分供应商不认 thinking / enable_thinking），所以准备多套请求体：
 * 参数不被接受（400/422）就换下一套重试，其余错误直接抛出。
 */
async function viaOpenAICompatible(
  provider: AiProvider,
  env: Env,
  settings: SiteSettings,
  prompt: string,
  model: string,
): Promise<string> {
  const preset = aiProviderPreset(provider);
  const apiKey = aiApiKey(env, settings, provider);
  if (!apiKey) throw new Error(missingKeyMessage(provider));
  const base = resolveBaseUrl(env, settings, provider);

  const messages = [
    { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
    { role: "user", content: prompt },
  ];
  const tuned = preset.extraBody?.(model) ?? {};
  const variants: Array<Record<string, unknown>> = [];
  if (Object.keys(tuned).length) {
    variants.push({ model, messages, temperature: 0.6, max_tokens: MAX_OUTPUT_TOKENS, stream: false, ...tuned });
  }
  variants.push({ model, messages, temperature: 0.6, max_tokens: MAX_OUTPUT_TOKENS, stream: false });
  // 新一代 OpenAI 推理模型：只接受 max_completion_tokens，且 temperature 只能用默认值
  variants.push({ model, messages, max_completion_tokens: MAX_OUTPUT_TOKENS, stream: false });

  let lastError = `${preset.label} 调用失败`;
  for (const body of variants) {
    const response = await timedFetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = (await response.json()) as { choices?: ChatChoice[] };
      return readChatContent(data, preset.label);
    }
    const detail = (await response.text()).slice(0, 180);
    lastError = `${preset.label} 返回 ${response.status}${detail ? `：${detail}` : ""}`;
    // 只有「参数不被接受」才换请求体重试；鉴权、余额、限流类错误重试也没用
    if (response.status !== 400 && response.status !== 422) throw new Error(lastError);
  }
  throw new Error(lastError);
}

async function viaPollinations(prompt: string, model: string): Promise<string> {
  const response = await timedFetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "iNav/1.0" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: MAX_OUTPUT_TOKENS,
      referrer: "iNav",
    }),
  });
  if (!response.ok) {
    if (response.status === 402 || response.status === 429) {
      throw new Error("免费 AI 服务已达限额（每个 IP 45 秒 1 次、每天 100 次），请稍后重试，或换成 DeepSeek / 千问等自己的密钥");
    }
    throw new Error(`免费 AI 服务返回 ${response.status}，可稍后重试或换一个服务`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { choices?: ChatChoice[]; error?: { message?: string } | string };
    const choice = data.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (content) return content;
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    if (error) throw new Error(`免费 AI 服务：${error}`);
    return readChatContent(data, "免费 AI 服务");
  }
  return await response.text();
}

async function viaGemini(env: Env, settings: SiteSettings, prompt: string, model: string): Promise<string> {
  const apiKey = aiApiKey(env, settings, "gemini");
  if (!apiKey) throw new Error(missingKeyMessage("gemini"));
  const base = resolveBaseUrl(env, settings, "gemini");
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;

  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  // 2.5 系列默认开启思考，会把 22 秒超时耗光；先尝试关闭，不支持再退回普通参数
  const variants: Array<Record<string, unknown>> = [
    {
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { contents, generationConfig: { temperature: 0.6, maxOutputTokens: MAX_OUTPUT_TOKENS } },
  ];

  let lastError = "Gemini 调用失败";
  for (const body of variants) {
    const response = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
      };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
      if (text) return text;
      const block = data.promptFeedback?.blockReason;
      if (block) throw new Error(`Gemini 拒绝了这次请求（${block}）`);
      throw new Error("Gemini 没有返回介绍内容");
    }
    const detail = (await response.text()).slice(0, 180);
    lastError = `Gemini 返回 ${response.status}${detail ? `：${detail}` : ""}`;
    if (response.status !== 400) throw new Error(lastError);
  }
  throw new Error(lastError);
}

export async function generateDescription(
  env: Env,
  settings: SiteSettings,
  input: DescriptionInput,
  override?: { provider?: AiProvider; model?: string; baseUrl?: string },
): Promise<DescriptionResult> {
  const provider = override?.provider ?? settings.aiProvider;
  const preset = aiProviderPreset(provider);
  const model = resolveAiModel(provider, override?.model || settings.aiModel);
  const effective: SiteSettings = {
    ...settings,
    aiProvider: provider,
    aiModel: model,
    aiBaseUrl: override?.baseUrl ?? settings.aiBaseUrl,
    aiPrompt: settings.aiPrompt || DEFAULT_AI_PROMPT,
  };
  const prompt = buildPrompt(input, effective);

  let raw: string;
  if (preset.protocol === "pollinations") raw = await viaPollinations(prompt, model || preset.model);
  else if (preset.protocol === "gemini") raw = await viaGemini(env, effective, prompt, model);
  else raw = await viaOpenAICompatible(provider, env, effective, prompt, model);

  const description = cleanDescription(raw);
  if (description.length < 12) throw new Error("AI 返回的内容过短，请重试或换一个模型");
  return { description, provider, model };
}
