import { z } from "zod";

// One interface over every model call (SPEC.md section 2).
// Provider order: GEMINI_MODEL, its sibling Flash models, then each OpenRouter model in OPENROUTER_MODELS.
// Every result names the model that produced it, so a fallback is visible, never silent.
//
// Measured in step 2: the newest free-tier Flash model can hang for 40+ seconds or return 503 while
// older siblings answer in 3 to 9 s. So (a) Gemini is always called through its streaming endpoint
// and abandoned if no first token arrives in time, (b) sibling models are tried before OpenRouter,
// which only allows 50 free requests a day, and (c) a model that just failed is skipped for a while.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_FALLBACKS = "gemini-3.6-flash,gemini-3.5-flash,gemini-3.8-flash";
const FIRST_TOKEN_TIMEOUT_MS = 12_000;
const BREAKER_MS = 3 * 60_000;
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

type Provider = { name: string; call: (req: CallRequest) => Promise<string> };
type CallRequest = { system: string; prompt: string; jsonSchema?: Record<string, unknown>; effort: Effort; timeoutMs: number };

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

function openRouter(model: string): Provider {
  return {
    name: model,
    async call({ system, prompt, jsonSchema, timeoutMs }) {
      const data = (await postJSON(
        OPENROUTER_URL,
        { Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`, "X-Title": "Meetscribe" },
        {
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          ...(jsonSchema
            ? { response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } } }
            : {}),
        },
        timeoutMs,
      )) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? "OpenRouter error");
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Empty response");
      return text;
    },
  };
}

function geminiModels(): string[] {
  const list = [process.env.GEMINI_MODEL ?? "", ...(process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS).split(",")];
  return [...new Set(list.map((m) => m.trim()).filter(Boolean))];
}

// Circuit breaker, per warm function instance. Best effort by design: a cold start simply tries everything again.
const failedAt = new Map<string, number>();
const markFailed = (model: string) => failedAt.set(model, Date.now());
const markOk = (model: string) => failedAt.delete(model);

function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.GEMINI_API_KEY) for (const m of geminiModels()) list.push(gemini(m));
  if (process.env.OPENROUTER_API_KEY) {
    for (const m of (process.env.OPENROUTER_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) list.push(openRouter(m));
  }
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
  timeoutMs?: number;
}): Promise<{ data: T; model: string; attempts: Attempt[] }> {
  const jsonSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  // The schema also goes in the prompt: not every fallback model enforces response_format.
  const system = `${opts.system}\n\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const attempts: Attempt[] = [];

  for (const provider of providers()) {
    let prompt = opts.prompt;
    // Two tries per provider: the second is a repair pass that shows the model its own validation errors.
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const raw = await provider.call({ system, prompt, jsonSchema, effort: opts.effort ?? "low", timeoutMs: opts.timeoutMs ?? 45_000 });
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
export function streamText(opts: { system: string; prompt: string; effort?: Effort }): AsyncIterable<string> & { model: Promise<string> } {
  let resolveModel!: (m: string) => void;
  let rejectModel!: (e: unknown) => void;
  const model = new Promise<string>((res, rej) => ((resolveModel = res), (rejectModel = rej)));
  model.catch(() => {});

  async function* run(): AsyncGenerator<string> {
    const errors: string[] = [];
    for (const provider of providers()) {
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

async function* streamProvider(name: string, opts: { system: string; prompt: string; effort?: Effort }): AsyncGenerator<string> {
  if (geminiModels().includes(name)) {
    yield* geminiStream(name, geminiBody(opts.system, opts.prompt, opts.effort ?? "low"), 60_000);
    return;
  }
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("OPENROUTER_API_KEY")}`, "X-Title": "Meetscribe" },
    body: JSON.stringify({ model: name, stream: true, temperature: 0.2, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
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
