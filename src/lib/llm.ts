import { z } from "zod";

// One interface over every model call (SPEC.md section 2 and its changelog).
//
// Three providers, all free tier. Every result names the model that produced it, so a fallback is visible.
// Measured on 2026-09-18 (details in the SPEC.md changelog):
//   Gemini      Best output on real transcripts and a 1M-token context, but 20 requests/DAY per Flash model,
//               and the newest model can hang. Called through its streaming endpoint and abandoned if no
//               first token arrives in time. Each sibling model has its own daily bucket, so the chain is long.
//   Groq        1,000 requests/day and answers in 1 to 3 s, but 8,000 tokens per MINUTE, which forces low
//               reasoning effort on anything transcript-sized. At that setting gpt-oss-120b missed action
//               items and invented a figure, so it does not lead for summaries.
//   OpenRouter  50 free requests/day in total and slow on long prompts. Last resort.
//
// Order is chosen per task: "quality" = Gemini, Groq, OpenRouter. "speed" = Groq, Gemini, OpenRouter.
// A provider that just failed goes to the back of the order for a few minutes.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const EMBEDDING_MODEL = "gemini-embedding-001";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODELS = "openai/gpt-oss-120b";
/** Groq's free tier counts prompt plus requested completion tokens against 8,000 per minute. */
const GROQ_TOKENS_PER_MINUTE = 8_000;
const GROQ_MAX_COMPLETION_TOKENS = 2_000;
/** How long a call will wait for room in the per-minute budget before falling through. Scripts raise it. */
const GROQ_MAX_WAIT_MS = Number(process.env.GROQ_MAX_WAIT_MS ?? 20_000);
// Each Flash model has its own 20-a-day bucket, so more siblings means more daily headroom.
const DEFAULT_GEMINI_FALLBACKS = "gemini-3.6-flash,gemini-3.5-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite";
const FIRST_TOKEN_TIMEOUT_MS = 12_000;
const BREAKER_MS = 3 * 60_000;
const OPENROUTER_TIMEOUT_MS = 100_000;
export const EMBEDDING_DIMENSIONS = 768;

/**
 * "low" is for extraction-style calls (summaries, action items): in step 0 the model spent 217
 * thinking tokens on a one-line extraction. "minimal" is rejected by gemini-3.8-flash, so low is the floor.
 */
export type Effort = "low" | "high";

export type Attempt = { model: string; ok: boolean; ms: number; error?: string };

export class LLMError extends Error {
  constructor(message: string, public attempts: Attempt[]) {
    super(message);
  }
}

type Provider = {
  name: string;
  call: (req: CallRequest) => Promise<string>;
  /** A reason this provider cannot take the request at all. It is then skipped without a call or a breaker trip. */
  cannotTake?: (req: CallRequest) => string | null;
};

/**
 * Rough on purpose. Only used to avoid sending Groq a request it must reject. Calibrated against Groq's own
 * count on the real fixture: indexed transcript lines ("[12] Speaker A: ...") run at about 3.7 characters
 * per token, well below the 4 usually quoted for prose. Erring low on the ratio errs towards skipping.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
type CallRequest = {
  system: string;
  /** The system prompt with the JSON Schema written out, for providers or modes that do not enforce response_format. */
  systemWithSchema?: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  effort: Effort;
  timeoutMs: number;
  maxOutputTokens?: number;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message ?? detail;
    } catch {}
    throw new Error(`HTTP ${res.status}: ${String(detail).slice(0, 300)}`);
  }
  return JSON.parse(text);
}

// ------------------------------------------------------------------- providers

/** Streams a Gemini response. Aborts if the first token is late: a hung model must not cost the whole budget. */
async function* geminiStream(model: string, body: unknown, totalTimeoutMs: number): AsyncGenerator<string> {
  const controller = new AbortController();
  let reason = "";
  const abort = (why: string) => { reason = why; controller.abort(); };
  const firstToken = setTimeout(() => abort(`no first token within ${FIRST_TOKEN_TIMEOUT_MS / 1000} s`), FIRST_TOKEN_TIMEOUT_MS);
  const total = setTimeout(() => abort(`not finished within ${totalTimeoutMs / 1000} s`), totalTimeoutMs);
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      let detail = text.slice(0, 300);
      try { detail = JSON.parse(text)?.error?.message ?? detail; } catch {}
      throw new Error(`HTTP ${res.status}: ${String(detail).slice(0, 300)}`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json.error) throw new Error(json.error.message ?? "Gemini stream error");
        const parts: { text?: string; thought?: boolean }[] = json.candidates?.[0]?.content?.parts ?? [];
        const token = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
        if (token) {
          clearTimeout(firstToken);
          yield token;
        }
      }
    }
  } catch (error) {
    if (reason) throw new Error(`Timed out: ${reason}`);
    throw error;
  } finally {
    clearTimeout(firstToken);
    clearTimeout(total);
  }
}

function geminiBody(system: string, prompt: string, effort: Effort, jsonSchema?: Record<string, unknown>) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: effort },
      ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
    },
  };
}

function gemini(model: string): Provider {
  return {
    name: model,
    async call({ system, prompt, jsonSchema, effort, timeoutMs }) {
      let text = "";
      for await (const token of geminiStream(model, geminiBody(system, prompt, effort, jsonSchema), timeoutMs)) text += token;
      if (!text) throw new Error("Empty response");
      return text;
    },
  };
}

function groq(model: string): Provider {
  const request = (req: CallRequest, structured: boolean) =>
    postJSON(
      GROQ_URL,
      { Authorization: `Bearer ${env("GROQ_API_KEY")}` },
      {
        model,
        temperature: 0.2,
        max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
        // "medium" does not fit: on an 18-minute transcript the reasoning alone used the whole completion budget.
        ...(model.includes("gpt-oss") ? { reasoning_effort: req.effort } : {}),
        messages: [
          // Strict response_format enforces the schema, so it is not repeated in the prompt (about 500 tokens saved).
          { role: "system", content: structured ? req.system : (req.systemWithSchema ?? req.system) },
          { role: "user", content: req.prompt },
        ],
        ...(req.jsonSchema
          ? { response_format: structured ? { type: "json_schema", json_schema: { name: "result", strict: true, schema: req.jsonSchema } } : { type: "json_object" } }
          : {}),
      },
      req.timeoutMs,
    ) as Promise<{ choices?: { message?: { content?: string }; finish_reason?: string }[] }>;

  return {
    name: model,
    cannotTake({ system, prompt, jsonSchema, maxOutputTokens }) {
      const needed = estimateTokens(system) + estimateTokens(prompt) + estimateTokens(JSON.stringify(jsonSchema ?? "")) + (maxOutputTokens ?? GROQ_MAX_COMPLETION_TOKENS);
      return needed > GROQ_TOKENS_PER_MINUTE ? `needs about ${needed} tokens, over Groq's ${GROQ_TOKENS_PER_MINUTE} per minute` : null;
    },
    async call(req) {
      let data;
      try {
        data = await request(req, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // The per-minute token budget is shared by every call. Groq says how long until there is room; when
        // that is short, waiting once is far cheaper than spending one of Gemini's 20 daily requests.
        const wait = /^HTTP 429/.test(message) ? /try again in ([\d.]+)(ms|s)\b/.exec(message) : null;
        const waitMs = wait ? Math.ceil(Number(wait[1]) * (wait[2] === "s" ? 1000 : 1)) : null;
        if (waitMs !== null && waitMs <= GROQ_MAX_WAIT_MS) {
          await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
          data = await request(req, true);
        } else if (/^HTTP 400/.test(message) && req.jsonSchema) {
          // Strict schemas are not accepted for every schema shape or model. JSON mode plus our own validation covers it.
          data = await request(req, false);
        } else {
          throw error;
        }
      }
      const choice = data.choices?.[0];
      const text = choice?.message?.content;
      if (!text) throw new Error(`Empty response (finish_reason: ${choice?.finish_reason ?? "none"})`);
      return text;
    },
  };
}

function openRouter(model: string): Provider {
  return {
    name: model,
    async call({ system, systemWithSchema, prompt, jsonSchema, timeoutMs }) {
      const data = (await postJSON(
        OPENROUTER_URL,
        { Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`, "X-Title": "Meetscribe" },
        {
          model,
          temperature: 0.2,
          // Measured: with no reasoning setting, deepseek-v4-flash streamed 28,000 characters of hidden reasoning
          // over four minutes on an 18-minute transcript and never reached the answer. Low effort finishes in
          // under a minute. Models without a reasoning mode ignore this field.
          reasoning: { effort: "low" },
          messages: [
            // Free OpenRouter models do not all honour response_format, so the schema is spelled out too.
            { role: "system", content: systemWithSchema ?? system },
            { role: "user", content: prompt },
          ],
          ...(jsonSchema
            ? { response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } } }
            : {}),
        },
        // Free OpenRouter models are slow on transcript-sized prompts: 50 s was not enough on 2026-09-18.
        Math.max(timeoutMs, OPENROUTER_TIMEOUT_MS),
      )) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? "OpenRouter error");
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Empty response");
      return text;
    },
  };
}

function groqModels(): string[] {
  return (process.env.GROQ_MODELS ?? DEFAULT_GROQ_MODELS).split(",").map((m) => m.trim()).filter(Boolean);
}

function geminiModels(): string[] {
  const list = [process.env.GEMINI_MODEL ?? "", ...(process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS).split(",")];
  return [...new Set(list.map((m) => m.trim()).filter(Boolean))];
}

// Circuit breaker, per warm function instance. Best effort by design: a cold start simply tries everything again.
const failedAt = new Map<string, number>();
const markFailed = (model: string) => failedAt.set(model, Date.now());
const markOk = (model: string) => failedAt.delete(model);

export type Order = "quality" | "speed" | "openrouter";
const ORDERS: Order[] = ["quality", "speed", "openrouter"];

/**
 * LLM_ORDER overrides the order every caller asked for. It exists for days when Gemini's daily quota is
 * spent: "openrouter" puts the 50-a-day OpenRouter models first so work can continue.
 */
function providers(requested: Order): Provider[] {
  const override = process.env.LLM_ORDER as Order | undefined;
  const order = override && ORDERS.includes(override) ? override : requested;
  const groqList = process.env.GROQ_API_KEY ? groqModels().map(groq) : [];
  const geminiList = process.env.GEMINI_API_KEY ? geminiModels().map(gemini) : [];
  const openRouterList = process.env.OPENROUTER_API_KEY
    ? (process.env.OPENROUTER_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(openRouter)
    : [];
  const list: Provider[] =
    order === "openrouter" ? [...openRouterList, ...geminiList, ...groqList]
    : order === "speed" ? [...groqList, ...geminiList, ...openRouterList]
    : [...geminiList, ...groqList, ...openRouterList];
  if (list.length === 0) throw new Error("No LLM provider is configured");
  // Recently failed providers go to the back instead of being dropped, so there is always something to try.
  const tripped = (p: Provider) => Date.now() - (failedAt.get(p.name) ?? 0) < BREAKER_MS;
  return [...list.filter((p) => !tripped(p)), ...list.filter(tripped)];
}

// ---------------------------------------------------------------- generateJSON

/** Models sometimes wrap JSON in a code fence or add a sentence before it. */
function extractJSON(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Response is not JSON");
    return JSON.parse(body.slice(start, end + 1));
  }
}

export async function generateJSON<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
  order?: Order;
  timeoutMs?: number;
}): Promise<{ data: T; model: string; attempts: Attempt[] }> {
  const jsonSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const system = `${opts.system}\n\nRespond with a single JSON object and nothing else.`;
  const systemWithSchema = `${system} It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const attempts: Attempt[] = [];

  for (const provider of providers(opts.order ?? "quality")) {
    let prompt = opts.prompt;
    const refusal = provider.cannotTake?.({ system, systemWithSchema, prompt, jsonSchema, effort: opts.effort ?? "low", timeoutMs: opts.timeoutMs ?? 45_000 });
    if (refusal) {
      attempts.push({ model: provider.name, ok: false, ms: 0, error: `Skipped: ${refusal}` });
      continue;
    }
    // Two tries per provider: the second is a repair pass that shows the model its own validation errors.
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const raw = await provider.call({ system, systemWithSchema, prompt, jsonSchema, effort: opts.effort ?? "low", timeoutMs: opts.timeoutMs ?? 45_000 });
        const parsed = opts.schema.safeParse(extractJSON(raw));
        if (parsed.success) {
          markOk(provider.name);
          attempts.push({ model: provider.name, ok: true, ms: Date.now() - started });
          return { data: parsed.data, model: provider.name, attempts };
        }
        const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        attempts.push({ model: provider.name, ok: false, ms: Date.now() - started, error: `Schema validation failed: ${issues}` });
        prompt = `${opts.prompt}\n\nYour previous answer failed validation: ${issues}\nReturn the corrected JSON object only.`;
      } catch (error) {
        // Transport and API errors (429, 5xx, timeout, retired model) are not worth a same-provider retry: move on.
        markFailed(provider.name);
        attempts.push({ model: provider.name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
  }
  throw new LLMError(`All providers failed: ${attempts.map((a) => `${a.model} (${a.error})`).join(" | ")}`, attempts);
}

// ------------------------------------------------------------------ streamText

/**
 * Streams text for Ask Meetscribe (step 4). Falls through to the next provider only if a provider
 * fails before its first token, because a half-streamed answer cannot be restarted invisibly.
 */
export type StreamOptions = { system: string; prompt: string; effort?: Effort; order?: Order; /** Answer length budget. Groq counts it against its per-minute cap up front. */ maxOutputTokens?: number };

export function streamText(opts: StreamOptions): AsyncIterable<string> & { model: Promise<string> } {
  let resolveModel!: (m: string) => void;
  let rejectModel!: (e: unknown) => void;
  const model = new Promise<string>((res, rej) => ((resolveModel = res), (rejectModel = rej)));
  model.catch(() => {});

  async function* run(): AsyncGenerator<string> {
    const errors: string[] = [];
    for (const provider of providers(opts.order ?? "quality")) {
      const refusal = provider.cannotTake?.({ system: opts.system, prompt: opts.prompt, effort: opts.effort ?? "low", timeoutMs: 60_000, maxOutputTokens: opts.maxOutputTokens });
      if (refusal) {
        errors.push(`${provider.name}: skipped, ${refusal}`);
        continue;
      }
      let yielded = false;
      try {
        for await (const token of streamProvider(provider.name, opts)) {
          if (!yielded) {
            yielded = true;
            resolveModel(provider.name);
          }
          yield token;
        }
        if (yielded) return;
        errors.push(`${provider.name}: empty stream`);
      } catch (error) {
        if (yielded) throw error;
        markFailed(provider.name);
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const failure = new Error(`All providers failed: ${errors.join(" | ")}`);
    rejectModel(failure);
    throw failure;
  }

  return Object.assign(run(), { model });
}

async function* streamProvider(name: string, opts: StreamOptions): AsyncGenerator<string> {
  if (geminiModels().includes(name)) {
    yield* geminiStream(name, geminiBody(opts.system, opts.prompt, opts.effort ?? "low"), 60_000);
    return;
  }
  // Groq and OpenRouter both speak the OpenAI streaming format.
  const onGroq = groqModels().includes(name);
  const open = () => fetch(onGroq ? GROQ_URL : OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env(onGroq ? "GROQ_API_KEY" : "OPENROUTER_API_KEY")}`,
      ...(onGroq ? {} : { "X-Title": "Meetscribe" }),
    },
    body: JSON.stringify({
      model: name,
      stream: true,
      temperature: 0.2,
      ...(onGroq ? {} : { reasoning: { effort: "low" } }),
      ...(onGroq ? { max_completion_tokens: opts.maxOutputTokens ?? GROQ_MAX_COMPLETION_TOKENS, ...(name.includes("gpt-oss") ? { reasoning_effort: opts.effort ?? "low" } : {}) } : {}),
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  let res = await open();
  if (res.status === 429 && onGroq) {
    // Same rule as the JSON path: if Groq says room frees up shortly, wait once instead of falling through.
    const wait = /try again in ([\d.]+)(ms|s)\b/.exec(await res.text());
    const waitMs = wait ? Math.ceil(Number(wait[1]) * (wait[2] === "s" ? 1000 : 1)) : null;
    if (waitMs === null || waitMs > GROQ_MAX_WAIT_MS) throw new Error("HTTP 429: Groq per-minute token budget is used up");
    await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
    res = await open();
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const token: string = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
        if (token) yield token;
      } catch {}
    }
  }
}

// ----------------------------------------------------------------------- embed

export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/** No fallback exists for embeddings. Callers catch the error and degrade to full-text search. */
export async function embed(texts: string[], task: EmbedTask = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const data = (await postJSON(
      `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
      { "x-goog-api-key": env("GEMINI_API_KEY") },
      {
        requests: texts.slice(i, i + 100).map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: task,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      },
      30_000,
    )) as { embeddings: { values: number[] }[] };
    out.push(...data.embeddings.map((e) => normalize(e.values)));
  }
  return out;
}

/** gemini-embedding-001 only returns unit vectors at its native 3072 dimensions; truncated outputs need normalizing. */
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
