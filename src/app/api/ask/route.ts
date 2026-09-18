import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ASK_SYSTEM, buildAskPrompt, finalizeAnswer } from "@/lib/ask/answer";
import { NOT_FOUND } from "@/lib/ask/citations";
import { retrieve } from "@/lib/ask/retrieve";
import { isUuid } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { streamText } from "@/lib/llm";

export const maxDuration = 120;

const body = z.object({
  question: z.string().trim().min(2, "Ask a question.").max(500, "Questions are limited to 500 characters."),
  threadId: z.string().refine(isUuid).optional(),
  scope: z.object({ meeting_ids: z.array(z.string().refine(isUuid)).max(20).optional(), person: z.string().max(80).optional() }).optional(),
});

/**
 * Streams newline-delimited JSON events:
 *   {type:"sources", threadId, sources, keywordOnly}   before any text, so the UI can resolve [n] as it streams
 *   {type:"token", text}
 *   {type:"done", text, citations, model, removed}     text is the validated answer and replaces the streamed one
 *   {type:"error", message}
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { question, scope = {} } = parsed.data;

  // Thread: follow-up questions see the previous two exchanges.
  let threadId = parsed.data.threadId;
  let history: { question: string; answer: string }[] = [];
  if (threadId) {
    const [thread] = await db.select().from(schema.askThreads).where(eq(schema.askThreads.id, threadId)).limit(1);
    if (!thread || thread.ownerId !== user.id) return Response.json({ error: "Conversation not found" }, { status: 404 });
    const messages = await db.select().from(schema.askMessages).where(eq(schema.askMessages.threadId, threadId)).orderBy(asc(schema.askMessages.createdAt));
    for (let i = 0; i + 1 < messages.length; i += 2) history.push({ question: messages[i].content, answer: messages[i + 1].content });
    history = history.slice(-2);
  } else {
    [{ id: threadId }] = await db.insert(schema.askThreads).values({ ownerId: user.id, scope }).returning({ id: schema.askThreads.id });
  }

  // A short follow-up ("and who owns it?") retrieves badly on its own, so the previous question rides along.
  const retrievalQuery = history.length ? `${history[history.length - 1].question} ${question}` : question;
  const { sources, keywordOnly } = await retrieve({ ownerId: user.id, question: retrievalQuery, scope });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const save = async (text: string, citations: unknown[], model: string | null) => {
        await db.insert(schema.askMessages).values({ threadId: threadId!, role: "user", content: question });
        await db.insert(schema.askMessages).values({ threadId: threadId!, role: "assistant", content: text, citations: citations as never, model });
      };
      try {
        send({ type: "sources", threadId, keywordOnly, sources });

        // Nothing relevant retrieved: answer without spending a model call (SPEC.md section 5, step 4).
        if (sources.length === 0) {
          send({ type: "token", text: NOT_FOUND });
          send({ type: "done", text: NOT_FOUND, citations: [], model: null, removed: 0 });
          await save(NOT_FOUND, [], null);
          return;
        }

        const tokens = streamText({ system: ASK_SYSTEM, prompt: buildAskPrompt(question, sources, history), effort: "low", order: "speed", maxOutputTokens: 700 });
        let raw = "";
        for await (const token of tokens) {
          raw += token;
          send({ type: "token", text: token });
        }
        const model = await tokens.model;
        const final = await finalizeAnswer(raw, sources);
        // Claims with no surviving citation are not shown as an answer.
        const text = final.grounded ? final.text : NOT_FOUND;
        send({ type: "done", text, citations: final.grounded ? final.citations : [], model, removed: final.removed });
        await save(text, final.grounded ? final.citations : [], model);
        console.log("ask", JSON.stringify({ model, sources: sources.length, cited: final.citations.length, removed: final.removed, grounded: final.grounded, keywordOnly }));
      } catch (error) {
        console.error("POST /api/ask", error);
        send({ type: "error", message: "The AI models are busy or out of free quota right now. Try again in a minute." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
