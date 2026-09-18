import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AskScope } from "@/db/schema";
import { embed } from "@/lib/llm";
import { fuse } from "./fuse";

// Hybrid retrieval (SPEC.md section 5): top 20 by vector distance, top 20 by full-text rank, fused by
// reciprocal rank, at most 4 chunks per meeting, top 10 kept. Names and numbers are where embeddings
// alone miss, which is why the keyword leg exists.

export const PER_LEG = 20;
export const KEEP = 10;
export const PER_MEETING = 4;
/**
 * Relevance floor. Cosine similarity of gemini-embedding-001 (768 dims, normalised) on meeting chunks:
 * calibrated in scripts/verify-ask-retrieval.ts. Below this, with no keyword hit either, nothing is relevant
 * and the model is not called at all.
 */
export const MIN_SIMILARITY = 0.6;

export type Source = {
  n: number;
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  kind: "transcript" | "note";
  segFrom: number | null;
  segTo: number | null;
  startMs: number | null;
  speakerLabel: string | null;
  text: string;
  similarity: number | null;
  keywordRank: number | null;
};

type Row = Omit<Source, "n" | "similarity" | "keywordRank"> & { similarity?: number | null; rank?: number | null };

function scopeFilter(ownerId: string, scope: AskScope) {
  const parts = [sql`m.owner_id = ${ownerId}`, sql`m.status not in ('scheduled', 'recording')`];
  if (scope.meeting_ids?.length) parts.push(sql`m.id in (${sql.join(scope.meeting_ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  if (scope.person) parts.push(sql`exists (select 1 from participants p where p.meeting_id = m.id and p.name ilike ${"%" + scope.person + "%"})`);
  if (scope.from) parts.push(sql`m.started_at >= ${scope.from}::timestamptz`);
  if (scope.to) parts.push(sql`m.started_at <= ${scope.to}::timestamptz`);
  return sql.join(parts, sql` and `);
}

const COLUMNS = sql`c.id, c.meeting_id as "meetingId", m.title as "meetingTitle", m.started_at as "meetingDate", c.kind,
  c.seg_from as "segFrom", c.seg_to as "segTo", c.start_ms as "startMs", c.speaker_label as "speakerLabel", c.text`;

export async function retrieve(input: { ownerId: string; question: string; scope?: AskScope }): Promise<{ sources: Source[]; keywordOnly: boolean; bestSimilarity: number | null }> {
  const where = scopeFilter(input.ownerId, input.scope ?? {});

  // Keyword leg. plainto_tsquery ANDs every word, which almost never matches a natural question, so the
  // terms are OR-ed instead; ts_rank still puts chunks matching more of them first.
  const keyword = db.execute(sql`
    with q as (select nullif(replace(plainto_tsquery('english', ${input.question})::text, '&', '|'), '')::tsquery as tsq)
    select ${COLUMNS}, ts_rank(c.tsv, q.tsq) as rank
    from transcript_chunks c join meetings m on m.id = c.meeting_id, q
    where ${where} and q.tsq is not null and c.tsv @@ q.tsq
    order by rank desc limit ${PER_LEG}`);

  let keywordOnly = false;
  const vector = embed([input.question], "RETRIEVAL_QUERY")
    .then(([v]) =>
      db.execute(sql`
        select ${COLUMNS}, 1 - (c.embedding <=> ${JSON.stringify(v)}::vector) as similarity
        from transcript_chunks c join meetings m on m.id = c.meeting_id
        where ${where} and c.embedding is not null
        order by c.embedding <=> ${JSON.stringify(v)}::vector limit ${PER_LEG}`),
    )
    .catch((error) => {
      // No fallback exists for embeddings. Ask still works on keywords and says so in the UI.
      console.error("ask: embedding failed, keyword search only", error instanceof Error ? error.message : error);
      keywordOnly = true;
      return { rows: [] as unknown[] };
    });

  const [k, v] = await Promise.all([keyword, vector]);
  const keywordRows = k.rows as Row[];
  const vectorRows = (v.rows as Row[]).filter((r) => Number(r.similarity) >= MIN_SIMILARITY);
  const bestSimilarity = v.rows.length ? Number((v.rows as Row[])[0].similarity) : null;

  const similarity = new Map(vectorRows.map((r) => [r.id, Number(r.similarity)]));
  const keywordRank = new Map(keywordRows.map((r, i) => [r.id, i + 1]));
  // The per-meeting cap exists to force breadth across meetings. When every candidate comes from one
  // meeting there is no breadth to protect, and the cap would only starve the answer.
  const meetingsFound = new Set([...vectorRows, ...keywordRows].map((r) => r.meetingId)).size;
  const fused = fuse(vectorRows, keywordRows, { limit: KEEP, perMeeting: meetingsFound <= 1 ? KEEP : PER_MEETING });

  return {
    keywordOnly,
    bestSimilarity,
    sources: fused.map((r, i) => ({
      n: i + 1,
      id: r.id,
      meetingId: r.meetingId,
      meetingTitle: r.meetingTitle,
      meetingDate: new Date(r.meetingDate).toISOString(),
      kind: r.kind,
      segFrom: r.segFrom,
      segTo: r.segTo,
      startMs: r.startMs,
      speakerLabel: r.speakerLabel,
      text: r.text,
      similarity: similarity.get(r.id) ?? null,
      keywordRank: keywordRank.get(r.id) ?? null,
    })),
  };
}
