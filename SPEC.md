# Meetscribe — build spec

Status: **LOCKED 2026-09-18.** Changes after this point are recorded in a changelog section at the bottom, not edited in silently.

A rebuild of Fathom.video (AI meeting notetaker) in a ~22 hour window, including deployment and the walkthrough video. The goal is not a free-tier clone. Three things must be visibly better than paid Fathom:

1. **Scratchpad notes feed the summary.** In Fathom, a correction typed in the Scratchpad did not reach the regenerated summary. Here it does, and the affected bullets are marked.
2. **No silent recording.** Fathom shows a branded pre-meeting popup for calendar meetings but joins instant meetings with no visible branding. Here every capture, scheduled or instant, shows the same persistent "Meetscribe is recording" indicator.
3. **Ask Meetscribe is better grounded.** Inline citations with quote previews and jump-to-timestamp links, synthesis across meetings, and a refusal when the meetings do not contain the answer.

## 1. Scope

### Built for real

| Feature | Notes |
|---|---|
| Transcript ingestion | Paste or upload text, upload audio, or record in the browser. All three end in the same `transcript_segments` rows. |
| LLM summary | Generated from the transcript by a real model call. Structured JSON, not canned text. |
| Template switching | Four templates. Switching regenerates from the same transcript with a different structure. Results are cached per template. |
| Scratchpad → summary | Notes are an input to regeneration. Notes win over the transcript when they conflict. |
| Action items | Extracted by LLM as person + task + source timestamp. Assignable, checkable, manually addable. |
| Meeting detail page | Tabs: Summary, Action Items, Transcript, Scratchpad. Audio player synced to the transcript when audio exists. |
| Ask Meetscribe | RAG over all stored meetings. Section 5. |
| Public share page | `/s/:slug`, no session needed, reads the same summary row as the app. |
| Meetings list | Seeded with 6 to 8 interrelated meetings, generated through the real pipeline. |
| Recording indicator | Real `MediaRecorder` mic capture with a persistent global indicator. Section 6. |
| Demo auth | One-click "Continue as demo user" cookie session. App routes protected, share pages public. |

### Stubbed, and stated as such in the walkthrough

- **The meeting bot.** Nothing joins Zoom, Meet or Teams. Upload, paste and in-browser recording stand in for it, and everything downstream treats the result as a captured call.
- **Calendar integration.** The "scheduled meeting" with its pre-meeting popup is a seeded row, not a calendar sync.
- **Speaker labels on audio.** Whisper does not diarize. Audio-sourced transcripts show a single "Speaker" label. Pasted transcripts keep their speaker names.
- **Multi-user.** One demo user. Teammates exist as seeded rows for assignees and speakers.

### Stretch, only after step 9

- Highlights (mark a moment, timestamp-linked).
- Live partial summary during recording.

## 2. Providers (free tier only)

| Job | Primary | Fallback |
|---|---|---|
| Summaries, action items, Ask answers | Google Gemini `gemini-3.8-flash` | OpenRouter `deepseek/deepseek-v4-flash-0731:free`, then `nvidia/nemotron-3-super-120b-a12b:free` |
| Embeddings | Gemini `gemini-embedding-001`, 768 dimensions | None. Ask degrades to full-text search only. |
| Audio transcription | Groq `whisper-large-v3-turbo` | None. Upload fails with a clear error and paste remains available. |

Facts checked on 2026-09-18, and their limits:

- Neither Google nor Groq publishes exact free-tier numbers in their docs any more. Both defer to the account dashboard. **Step 0 includes reading the real limits off both dashboards and recording them here.**
- Groq's docs list Whisper at 20 requests per minute and 7,200 audio seconds per hour, which is ample. Groq chat models are capped near 8K tokens per minute, which a single long transcript exceeds. That is why Groq is not the summarizer.
- Groq Whisper rejects files over 25 MB. The upload UI enforces this.
- The OpenRouter models were chosen from the live model list for long context (1M and 262K) and structured-output support. **Their output quality is untested by me.** Step 2 runs one real summary through the fallback to confirm it returns valid JSON. If it does not, it is swapped before moving on.
- OpenRouter's free tier has a low daily request cap. It is a safety net for a Gemini outage or daily cap during the demo, not a second engine.
- Gemini's free tier may use prompts for training. All seed data is fictional.

The Gemini model id is an env var (`GEMINI_MODEL`), set to `gemini-3.8-flash` in step 0.

### Measured in step 0 (2026-09-18, with the real keys)

| Provider | Source | Result |
|---|---|---|
| Groq chat (`openai/gpt-oss-20b`) | `x-ratelimit-*` response headers | 1,000 requests per day, **8,000 tokens per minute**. Confirms Groq cannot summarize a long transcript in one call. |
| Groq `whisper-large-v3-turbo` | Response headers on a 1 second test file | 2,000 requests per day. `verbose_json` returns segments with timestamps. Audio-seconds limits are not exposed in headers. The documented figure is 7,200 per hour. |
| OpenRouter | `GET /api/v1/key` | Free tier. **50 free-model requests per day.** The key expires on 2026-10-18. After that the fallback stops working and Gemini carries on alone. |
| Gemini model list | `GET /v1beta/models` | Stable Flash models offered: 3.5, 3.6, 3.7, 3.8. `gemini-2.5-flash` is closed to new users. |
| Gemini `gemini-3.8-flash` | Real `generateContent` call with a JSON response schema | Works on the free tier and returned valid schema-conformant JSON. It spent 217 thinking tokens on a one-line extraction, so `llm.ts` sets a low thinking budget for extraction calls. |
| Gemini `gemini-embedding-001` | Real `embedContent` call, `outputDimensionality: 768` | Returns 768 dimensions. `gemini-embedding-2` also works and is held in reserve. |
| Gemini rate limits | Not exposed by the API | **Pending.** To be read from aistudio.google.com/rate-limit by the account owner. |
| Neon | `psql` over the pooled endpoint | Postgres 18.6, region `aws-us-east-2`, pgvector 0.8.6 installed by migration `0000_enable_pgvector`. |

During this check `gemini-3.5-flash` returned a 503 for high demand. That is the failure the OpenRouter fallback exists for.

### `lib/llm.ts` contract

```ts
generateJSON<T>(opts: { system: string; prompt: string; schema: ZodSchema<T> }): Promise<{ data: T; model: string }>
streamText(opts: { system: string; prompt: string }): AsyncIterable<string> & { model: Promise<string> }
embed(texts: string[]): Promise<number[][]>
```

- Provider order: Gemini, then each OpenRouter model in `OPENROUTER_MODELS`.
- Fall through on HTTP 429, 5xx, timeout, or output that fails schema validation after one repair retry.
- Every result carries the model that produced it. `summaries.model` stores it and the UI shows it in a tooltip, so a fallback is visible, not silent.
- `embed` has no fallback. On failure the caller gets a typed error and Ask switches to full-text retrieval.

## 3. Stack

- **App:** Next.js (App Router), TypeScript, deployed on Vercel. Route handlers for the API. LLM responses stream.
- **UI:** Tailwind, shadcn/ui, `cmdk` for the ⌘K Ask palette, Framer Motion used sparingly.
- **Database:** Neon Postgres with the `vector` extension. Drizzle ORM and drizzle-kit migrations.
- **Audio storage:** Vercel Blob, uploaded directly from the browser with a client token. Vercel caps request bodies near 4.5 MB, so audio never passes through a route handler on upload. The server fetches the blob and forwards it to Groq.
- **Validation:** Zod schemas shared between the LLM contract and the API.

### Environment variables

| Name | Used by |
|---|---|
| `DATABASE_URL` | Drizzle config and runtime. Neon **pooled** connection string. |
| `GEMINI_API_KEY` | `llm.ts` |
| `GEMINI_MODEL` | `llm.ts`. Set in step 0. |
| `GROQ_API_KEY` | Transcription |
| `OPENROUTER_API_KEY` | `llm.ts` fallback |
| `OPENROUTER_MODELS` | Comma-separated fallback order. Default is the two models above. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob. Created by Vercel when the store is attached. |
| `SESSION_SECRET` | Signs the demo session cookie. |

`.env.local` is gitignored. `.env.example` is committed with names only.

### Design direction

Light, dense, Linear-like. One accent: deep teal (`#0F766E` family), explicitly not Fathom's purple. Red is reserved for the recording state and nothing else. Inter for UI, a mono face for timestamps. Design tokens and the app shell are set in step 1 so nothing is built unstyled and redone.

## 4. Data model

All ids are UUIDs. All times are `timestamptz`. Offsets into a meeting are integer milliseconds.

**`users`**: `id`, `name`, `email`, `avatar_color`, `is_demo`.

**`meetings`**: `id`, `owner_id`, `title`, `started_at`, `duration_ms`, `source` (`scheduled` | `instant` | `upload` | `paste`), `status` (`scheduled` | `recording` | `processing` | `ready` | `failed`), `error`, `audio_url`, `timestamps_estimated` (bool), `active_template_id`, `share_slug` (unique), `share_enabled`, `created_at`.

**`participants`**: `meeting_id`, `name`, `user_id` (nullable).

**`transcript_segments`**: `id`, `meeting_id`, `idx`, `speaker`, `start_ms`, `end_ms`, `text`. The source of truth every timestamp link resolves to.

**`transcript_chunks`**: `id`, `meeting_id`, `kind` (`transcript` | `note`), `seg_from`, `seg_to`, `start_ms`, `end_ms`, `speaker_label`, `text`, `embedding vector(768)`, `tsv tsvector`. About 150 to 250 words per chunk, split on speaker turns. HNSW index on `embedding`, GIN index on `tsv`. Scratchpad notes are chunked here too so Ask can cite them.

**`templates`**: `id`, `slug`, `name`, `description`, `sections` (JSON: ordered list of `{key, title, instruction}`). Seeded: General, Enhanced, Sales Discovery, Standup.

**`summaries`**: `id`, `meeting_id`, `template_id`, `content` (JSON), `notes_version_used`, `model`, `is_current`, `created_at`. One current row per (meeting, template). Old versions are kept.

```jsonc
// summaries.content
{
  "overview": "string",
  "sections": [
    { "key": "decisions", "title": "Decisions",
      "bullets": [ { "text": "string", "source_ms": [754000], "from_notes": false } ] }
  ]
}
```

Bullets carry `source_ms` so they link into the transcript, and `from_notes` so the UI can badge what came from the Scratchpad.

**`scratchpads`**: `meeting_id` (PK), `content`, `version` (incremented on save), `updated_at`. When `version > summaries.notes_version_used` the Summary tab shows "Notes changed since this summary" with a Regenerate button.

**`action_items`**: `id`, `meeting_id`, `text`, `assignee_name`, `assignee_user_id` (nullable), `due_date` (nullable), `done`, `source_ms` (nullable), `origin` (`ai` | `manual`), `created_at`. Regeneration replaces `ai` rows that are not done and never touches `manual` rows or completed ones.

**`ask_threads`**: `id`, `owner_id`, `scope` (JSON: `{meeting_ids?, person?, from?, to?}`), `created_at`.

**`ask_messages`**: `id`, `thread_id`, `role`, `content`, `citations` (JSON: `[{n, meeting_id, chunk_id, start_ms, speaker, quote}]`), `model`, `created_at`.

**`highlights`** (stretch): `id`, `meeting_id`, `start_ms`, `label`.

### Rules that matter

- **One summary, two views.** The share page and the app both read the `is_current` summary for the meeting's `active_template_id`. There is no copy, so they cannot drift.
- **Notes beat the transcript.** The summary prompt receives the notes in a separate block with the instruction that they are the owner's corrections and take precedence. Any bullet changed or added because of them is returned with `from_notes: true`.
- **Estimated timestamps are labelled.** A pasted transcript with no timestamps gets offsets synthesized from word count at 150 words per minute, `timestamps_estimated = true`, and the UI prefixes them with "~".

## 5. Ask Meetscribe

Pipeline for one question:

1. **Scope.** All meetings by default. Can be narrowed to the current meeting, a person, or a date range.
2. **Retrieve.** Embed the question. Take the top 20 by vector distance and the top 20 by `ts_rank` full-text match. Fuse with reciprocal rank fusion. Keep the top 8 to 10, capped at 4 per meeting so one long call cannot crowd out the others.
3. **Answer.** Stream a response from the numbered sources. The prompt requires a `[n]` marker on every factual sentence and an explicit "not in your meetings" reply when the sources do not contain the answer.
4. **Validate.** Server-side, strip any `[n]` that does not map to a retrieved chunk. If retrieval returned nothing above the relevance floor, skip the LLM call and return the not-found reply.
5. **Render.** Each `[n]` becomes a chip showing meeting title, speaker and timestamp. Hover shows the quoted source text. Click opens `/meetings/:id?t=<ms>`, which scrolls to the segment, highlights it, and seeks the audio if present. Below the answer, a "Sources" row groups citations by meeting.

Where this exceeds what was observed in Fathom: hybrid retrieval (names and numbers are where pure embeddings miss), quote-on-hover so a citation can be checked without leaving the answer, notes as citable sources, a per-meeting cap that forces real cross-meeting synthesis, and validated citations.

Seed data is designed to prove it: one fictional company, 6 to 8 meetings, with a launch date and a pricing decision that change across three of them. "How did the launch date change, and why?" has a real multi-meeting answer.

Degraded mode: if embeddings fail, retrieval runs on full-text only and the UI shows a small "keyword search only" note.

## 6. Recording indicator

- **Instant:** "Start instant meeting" asks for mic permission, creates a `meetings` row with `status = recording`, and starts `MediaRecorder`.
- **Scheduled:** a seeded upcoming meeting shows a branded pre-meeting popup ("Starting in 2m", "Join & capture audio"). Accepting it enters the same recording state.
- **Indicator:** while any meeting is `recording`, a fixed pill is visible on every route: Meetscribe mark, pulsing red dot, "Meetscribe is recording", elapsed time, Stop. The tab title is prefixed with "● REC" and the favicon swaps to a red-dot variant, so the state is visible when the tab is in the background. It lives in the root layout, so navigating does not interrupt capture.
- **Stop:** upload to Blob, `status = processing`, Whisper, then the same pipeline as any other ingest.
- **Guards:** `beforeunload` warning while recording. If the recording approaches 25 MB the UI warns, then stops and processes what it has.

## 7. Routes

Pages: `/login`, `/meetings`, `/meetings/new`, `/meetings/:id` (tab and `t` in the query string), `/ask`, `/s/:slug` (public).

API: `POST /api/meetings` (paste or audio), `POST /api/meetings/:id/summary` (body: `templateId`, regenerates), `PUT /api/meetings/:id/scratchpad`, `GET|POST|PATCH /api/meetings/:id/action-items`, `POST /api/meetings/:id/share`, `POST /api/ask` (streams), `POST /api/blob/token`, `POST /api/session`.

Middleware protects everything except `/login`, `/s/*` and `/api/session`.

## 8. Transcript parsing

Accepted: `Speaker: text`, `[00:03] Speaker: text` (also `[00:03:12]`), Fathom-style `0:03 - Name` followed by text lines, `.vtt`, `.srt`. Detection is by pattern in that order of specificity. Anything unmatched falls through to plain text: paragraphs become segments, speaker is "Speaker", timestamps are estimated per section 4. The parser is a pure function with unit tests against a fixture per format. It is the one place tests are written before the code.

## 9. Build order and budget

| # | Hours | Work | Done when |
|---|---|---|---|
| 0 | 0.5 | Lock spec. Keys for Gemini, Groq, OpenRouter. Neon project. Read real rate limits off dashboards. Set `GEMINI_MODEL`. | This file is committed as locked with limits filled in |
| 1 | 1.5 | Scaffold, Drizzle schema, design tokens, app shell, **deploy skeleton to Vercel** | A public URL renders a page that reads from Neon |
| 2 | 3.0 | Parser, paste ingest, `llm.ts` with fallback, summary and action item generation | A pasted transcript produces a real structured summary. Fallback model verified once. |
| 3 | 1.5 | Template switching, scratchpad feeding regeneration, stale-notes banner | A note correction visibly changes the summary and is badged |
| 4 | 4.0 | Chunking, embeddings, hybrid retrieval, streamed cited answers, citation validation, jump-to-timestamp | A cross-meeting question returns an answer whose every citation opens the right moment |
| 5 | 2.0 | Meeting detail page: four tabs, transcript seek and highlight, audio sync, assignable action items | |
| 6 | 1.0 | Meetings list, share page, demo login, middleware | Share link works in a private window |
| 7 | 1.5 | Audio upload, Whisper, in-browser recording, global indicator, scheduled-meeting popup | Record 30 seconds, stop, get a summary |
| 8 | 1.0 | Seed script: 6 to 8 interrelated meetings through the real pipeline | |
| 9 | 3.0 | Polish: empty, loading and error states, skeletons, motion, responsive, ⌘K | |
| 10 | 2.0 | README, walkthrough script, video | |
| | 1.0 | Buffer | |

Checkpoints:

- **Hour 6:** summaries and scratchpad work on the public URL.
- **Hour 10.5:** Ask works end to end.
- **Hour 13:** if more than 1.5 hours behind, cut in-browser recording. Keep audio upload and show the indicator during processing only.
- Stretch items are not started before step 9 is done.

Working rules: deploy after every step, not at the end. Commit code and `.agent-logs/` together as each step lands. Seed transcripts are written once and committed as fixtures, so re-seeding does not depend on an LLM call succeeding.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Gemini daily cap hit during seeding or the demo | OpenRouter fallback. Seed once, early. Summaries cached per template. |
| Fallback model returns malformed JSON | Schema validation with one repair retry, verified in step 2 |
| Vercel function timeout on long audio | Whisper turbo is fast. Audio capped at 25 MB. Processing state is polled, not held open. |
| Neon cold start after idle | Free compute suspends when idle and wakes in about a second. Acceptable. No cron needed, unlike Supabase's week-long pause. |
| Mic permission denied or unsupported browser | Clear inline error and a link to upload instead |
| Polish squeezed out | Tokens and shell in step 1. The hour 13 cut exists to protect step 9. |

## Changelog (after lock)

- **2026-09-18, step 0.** Filled in measured provider limits and set `GEMINI_MODEL=gemini-3.8-flash`. Added: low thinking budget on extraction calls. Added: Vercel function region should be pinned to `cle1` (Cleveland) in step 1, because the Neon project is in `aws-us-east-2` (Ohio), not `us-east-1` as the plan assumed. Noted: the OpenRouter key expires 2026-10-18.
- **2026-09-18, step 1.** Live at https://meetscribe-three.vercel.app. Two deployment failures on the way, both configuration: (1) the Neon integration did not expose a variable named `DATABASE_URL` to the production build, so `src/db/url.ts` now resolves the connection string from any of the Neon/Vercel names; production currently uses `DATABASE_URL_UNPOOLED`, which is fine for the HTTP driver. (2) The project was imported before Next.js existed in the repo, so the framework preset was "Other" and only `public/` was published; `vercel.json` now sets `"framework": "nextjs"`. UI primitives are hand-written in the shadcn pattern (Radix + cva) rather than generated by the shadcn CLI. Reference data (demo user, teammates, templates) ships as migration `0002` so a fresh deploy needs no seed step. Measured: functions run in `cle1`, warm database round trip 11 ms.
- **2026-09-18, step 2.** Paste to summary works locally and on the live site with a real transcript (`fixtures/ami-es2011a.txt`: AMI Corpus meeting ES2011a, CC BY 4.0, 18.5 minutes, 4 speakers, 244 turns, 3,205 words of unedited speech).
  - **Measured.** `POST /api/meetings` stores 244 segments and 11 chunks and responds in 1.5 s live (2.3 s locally). Summary visible after 12 to 14 s live and 25 to 36 s locally; the difference is how long the hung primary model cost on that run. Embedding 11 chunks: about 3.2 s. A healthy summary or action item call takes 5 to 11 s. Output on the final live run: 10 bullets, 3 action items, 35 citations, all 35 resolving to the exact start of a real segment.
  - **Surprise 1: the primary model was unusable all afternoon.** `gemini-3.8-flash`, fast in step 0, hung past 40 s on every request, including a bare text prompt. `gemini-3.7-flash` returned 503. `gemini-3.6-flash` and `gemini-3.5-flash` worked (3 to 11 s), with occasional 503s of their own. Changes to the section 2 contract: Gemini is called through its streaming endpoint and abandoned if no first token arrives within 12 s; sibling Flash models (`GEMINI_FALLBACK_MODELS`, default `gemini-3.6-flash,gemini-3.5-flash`) are tried before OpenRouter, because OpenRouter allows only 50 free requests a day; a model that just failed goes to the back of the order for 3 minutes; and the chain falls through on any provider error, not only 429, 5xx and timeouts, since a retired model returns 404.
  - **Which fallback fired.** All of them, with real calls. Unplanned: 3.8 timed out and 3.6 or 3.5 answered on every run of the day. Forced: with every Gemini model name made invalid, `deepseek/deepseek-v4-flash-0731:free` on OpenRouter returned schema-valid JSON in about 7 s. On a 5,000-token transcript prompt the same OpenRouter model once timed out at 50 s, so it is a safety net for short calls more than for long ones. One test run with the chain cut to a single Gemini model failed on every provider; the meeting is then marked failed with the reason and keeps its transcript. Regenerate (step 3) doubles as retry.
  - **Thinking budget.** This model takes `thinkingConfig.thinkingLevel`. `minimal` is rejected, so extraction calls use `low`.
  - **Grounding.** The model never writes a timestamp. It cites transcript lines by index; the server maps indices to segment offsets, discards any index that does not exist, prefers lines of more than two words over fillers such as "So", and drops a bullet left with no source. Counts of dropped bullets and invalid indices are logged per run (0 and 0 on every run so far).
  - **Surprise 2: offsets were not unique.** 67 of the 244 real segments shared a start second with a neighbour, so a citation link could land on the wrong line. Found by reading the output, not by a test. The parser now breaks ties by 1 ms, which is invisible at mm:ss and makes an offset identify exactly one segment. Test added.
  - **Surprise 3: action items were model-dependent.** With the first definition ("committed to, or asked and accepted") one model returned three items and another returned none for the same meeting, where a chair hands out tasks and people only say "okay". The definition now covers assigned work. Checked directly: 3 of 3 successful runs across two models found the same three items with the same owners.
  - **Not as planned.** The Vercel CLI could not deploy the working directory (`fetch failed` after upload, in both upload modes, probably Node 26), so the live check ran after a push instead of before it. Generation runs in `after()` inside the POST invocation with `maxDuration = 120`, and the meeting page polls every 2 s while the status is `processing`. Chunk word counts (150 to 250) exclude the `Speaker:` prefixes that are stored in the chunk text. Embeddings are created at ingest, ahead of step 4.
  - **Tests.** 38 passing (31 parser, 7 chunker), written before the implementation. One test expectation was wrong (a miscounted sentence) and was corrected; the parser was right.
- **2026-09-18, after step 2.** Primary model changed to `gemini-3.6-flash`; chain is now 3.6, 3.5, 3.8, then OpenRouter (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, set locally and on Vercel). Cause found: the free tier allows `gemini-3.8-flash` only **20 requests per day per project** (quota id `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, read from the 429 response once the hanging stopped). That is below what seeding alone needs, so 3.8 cannot lead regardless of its latency. It stays in the chain because a 429 fails in under a second and costs nothing. The daily limits for 3.6 and 3.5 are still unknown: more than 20, since both served more than that today. They must be read from aistudio.google.com/rate-limit before step 8.
- **2026-09-18, the real Gemini limit.** Correction to the entry above: the 20 requests per day limit is not specific to 3.8. `gemini-3.6-flash` and `gemini-3.5-flash` returned the same quota id with the same value (`GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20`) once today's testing reached it. **Every Gemini Flash model is limited to 20 free requests per day per project.** The 429s seen earlier that cleared within a minute were per-minute limits. Consequence: an ingest costs 2 generation calls and each regenerate or Ask question costs 1, so one model covers about 10 ingests a day and the three-model chain about 60 calls in total. That is enough for a demo and not enough for development plus seeding plus a demo on the same day. Embeddings (`gemini-embedding-001`) are on a separate quota and were unaffected. Measured alternative on a key already held: Groq serves `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` and `openai/gpt-oss-20b` at 1,000 requests per day each, in 0.2 to 0.8 s, with valid JSON, but at 8,000 tokens per minute. The 18-minute fixture is about 4,200 tokens, so one summary fits and two parallel calls do not. Provider order is an open decision for the owner.
- **2026-09-18, Groq evaluated as primary and rejected for summaries.** The owner chose Groq `openai/gpt-oss-120b` first, conditional on a quality check against the validated Gemini output on the real fixture. It did not pass. Provider order is now per task (`order` in `llm.ts`): **quality** = Gemini, Groq, OpenRouter, used for summaries and action items; **speed** = Groq, Gemini, OpenRouter, reserved for Ask in step 4, where prompts are a few thousand tokens, and to be judged there on its own output.
  - **Side by side, same 18.5 minute transcript, same prompt.** Gemini 3.5 and 3.6 Flash (two separate calls): all four names inferred from the introductions, price and profit figures exact, nothing invented, 3 of 3 assigned tasks found on every run. Groq gpt-oss-120b at low reasoning effort, five runs: names inferred, 100% of citations resolved, 2.5 to 3.3 s. But action items found were 2, 0 and 2 of 3 in the merged call and 1 and 0 of 3 as a separate call, one of them speculative; a misspoken "twelve point twelve fifty" became "€12.125" and once "€12.125 million" in every run that mentioned the budget; and one run added "implying sales of around four million units", its own arithmetic.
  - **Why it cannot be fixed by configuration.** Medium reasoning effort was tried: the reasoning consumed the whole 2,000-token completion budget and the response was cut off, and the budget cannot grow because prompt plus completion must stay under 8,000 tokens per minute. `qwen/qwen3.8-27b` on Groq is limited to 1,000 output tokens per minute, less than one summary. So on the free tier Groq can only run this task at the setting where it is not good enough.
  - **The merged call was also rejected.** Summary and action items in one call was built to fit Groq's cap. `gemini-3.5-flash-lite` returned no action items in two merged runs and Groq returned 2, 0, 2, against 3 of 3 for separate calls on Gemini. Moving `action_items` first in the schema helped Groq slightly and lite not at all. Ingest is back to two parallel calls. `generateMeetingNotes` stays for `scripts/compare-providers.ts`. Untested: the merged call on Gemini 3.5 or 3.6, whose quota was spent by then.
  - **Kept from the Groq work.** Groq sits behind Gemini as a fast fallback. A prompt that cannot fit is skipped without a request (estimator calibrated on Groq's own count: 3.74 characters per token for indexed transcript lines, 3.5 used). A 429 that says room frees up within 20 s is waited out once instead of spending a Gemini request. Transcript lines no longer carry timestamps in the prompt (about 1,200 tokens saved on the fixture; the model cites by index) and the JSON Schema is no longer sent twice to providers that enforce it (about 500 tokens).
  - **Long transcript.** A 37 minute transcript (the fixture twice, about 9,300 tokens) was skipped by Groq with no request, as designed, and the chain then tried every Gemini model and OpenRouter in order. **None could serve it today**: 3.6, 3.5 and 3.8 were out of daily quota, 3.7 and 3.5-flash-lite returned 503 or hung, and both OpenRouter models timed out at 50 s. The mechanism is verified; a correct summary of a long transcript from Gemini is not, and needs re-running after the quota resets (midnight Pacific).
  - **Where this leaves the build.** On the free tier the only provider that meets the quality bar has 20 requests a day per model. Gemini chain: 3.6, 3.5, 3.8, 3.7, 3.5-flash-lite, each with its own bucket, so roughly 100 requests a day when all are healthy, fewer in practice. An ingest costs 2. Development testing has to be rationed, and seeding (step 8) should run once, early in a quota day. A free key from a provider with a larger allowance would remove the constraint; that is the owner's call.
- **2026-09-18, step 3.** Template switching, Scratchpad editor with autosave, regenerate endpoint, "notes changed" banner, "From your notes" badges. Verified locally on the real fixture and smoke-tested live. Model calls were rationed: 3 in total for this step.
  - **The differentiator works.** Notes said the price target is 30 euros (transcript: 25), that Krista owns the user requirements research (transcript: Chiara), and added a finance sign-off due Friday. The regenerated summary states 30 euros, names Krista, includes the sign-off, flags those three bullets `from_notes`, and the banner clears. The notes-only bullet has no transcript citation, as designed; the corrected ones keep theirs.
  - **Rules implemented.** `POST /api/meetings/:id/summary` serves a template from the database when its current summary already used this version of the notes (0.5 s on the server, no model call), and otherwise generates. Action items are re-extracted only when no summary has yet seen the current notes, or on a forced retry, because they do not depend on the template. The same endpoint with `force` is the retry for a failed generation. A failed regeneration leaves the previous summary in place and returns a plain-language 503. Superseded summaries are kept with `is_current = false`.
  - **Found by testing, fixed.** A regeneration whose model returned no action items replaced three good ones with nothing. An empty extraction now keeps the existing list. The cached path loaded the whole transcript before checking the cache (1.8 s); it now checks first.
  - **Scratchpad.** Autosaves 800 ms after the last keystroke, on blur, and on page hide. The version moves only when the text changes. Notes are chunked into `transcript_chunks` with `kind = 'note'` and embedded after the response, so Ask can cite them in step 4.
  - **Caveat on quality.** Gemini 3.6, 3.5 and 3.8 were out of daily quota, so all three calls were served by `gemini-3.5-flash-lite`. It followed the notes correctly but produced one garbled attribution ("Chiara and Chiara's notes highlighted") and no action items. The notes path needs one confirming run on a full Flash model after the quota resets.
  - **Known limitation.** Staleness is by version, not content: editing the notes and then undoing the edit still shows the banner.
- **2026-09-18, OpenRouter tried as primary for validation: not viable for transcript-sized prompts.** Asked to stop waiting for Gemini's reset and validate through OpenRouter instead. 9 OpenRouter requests spent on this (18 of 50 used today). None of the three validations could be completed.
  - **Served by.** Notes-regeneration confirming run: nobody. Two live attempts through OpenRouter `deepseek/deepseek-v4-flash-0731:free` both ended in Vercel `FUNCTION_INVOCATION_TIMEOUT` at 120 s; nothing was saved and the existing summary (from `gemini-3.5-flash-lite`) stayed in place, as designed. Restoring the kept meeting's action items: not done, same two attempts. Long-transcript (37 minute) re-test: **not run**, on purpose, because the 18-minute transcript already exceeds what OpenRouter can finish in time and the owner asked not to burn the 50-a-day allowance on retries.
  - **Cause of the OpenRouter "timeouts", found by streaming one request.** The model is not stuck. With no reasoning setting it answered the first token in 2.4 s and then streamed 28,500 characters of hidden reasoning for four minutes without reaching the answer. With `reasoning: {enabled: false}` it finishes in 3.4 s; with `{effort: "low"}` in 53 s. Both returned an empty action item list for a meeting that has three (with a bare diagnostic prompt, not the app's prompt). `llm.ts` now sends `reasoning: {effort: "low"}` to OpenRouter. That was still not enough for the app's full prompt with a strict schema, twice in parallel, inside 120 s.
  - **Added.** `LLM_ORDER` environment override and an `openrouter` provider order, for putting OpenRouter first without a code change. It was set on Vercel Production for these attempts and **removed afterwards**, so the live site is back to Gemini, Groq, OpenRouter. OpenRouter's request timeout is 100 s.
  - **Standing conclusion for the free tier.** Gemini Flash (3.5, 3.6) is the only provider measured that reads a noisy 18-minute transcript well enough: Groq `gpt-oss-120b` misses action items and invents a figure at the only effort that fits its per-minute cap; `gemini-3.5-flash-lite` and OpenRouter's DeepSeek return no action items; and OpenRouter cannot finish in time. The three pending validations wait for Gemini's reset at midnight Pacific.
- **2026-09-18, step 4 (Ask Meetscribe).** Built and live. Verified on the one real meeting in the workspace. **Cross-meeting synthesis is built but not yet verified**, because the workspace has a single meeting; see the last point.
  - **Retrieval, no text model involved.** Top 20 by pgvector cosine distance and top 20 by `ts_rank`, fused by reciprocal rank (k = 60), top 10 kept, at most 4 per meeting. The cap is lifted when every candidate comes from one meeting, since it then protects nothing. The keyword leg ORs the question's terms (`plainto_tsquery` ANDs them, which almost never matches a question). Scope filters: meeting ids, person, date range. Scratchpad notes are retrieved and cited like transcript chunks. Embedding failure degrades to keyword search and the UI says so.
  - **Relevance floor, from data.** `gemini-embedding-001` at 768 dimensions: on-topic questions scored a best similarity of 0.646 to 0.766, off-topic ones ("capital of France", "router password") 0.498 to 0.512. The floor is 0.60. Below it, with no keyword hit, the reply is "I couldn't find that in your meetings." and **no model is called** (0.7 s live). A plausible but absent question ("what did legal say about the reseller contract", 0.618) passes the floor and reaches the model, which correctly said it could not find it.
  - **Citations.** Answers stream as NDJSON (`sources`, `token`, `done`, `error`). On completion the server removes every `[n]` that does not map to a retrieved source, collapses repeats, and replaces the streamed text with the validated text; an answer with claims and no surviving citation is replaced by the not-found reply. Each surviving citation is resolved from its 150 to 250 word chunk to the single transcript line that best matches the cited sentence, by word overlap, with digits matched to spoken numbers ("25 euros" finds "twenty five euro") and plurals to singulars. That line is what the chip previews on hover and opens on click. Found by testing: a citation first resolved to the wrong line for exactly that digits-versus-words reason.
  - **Which provider served the answer tests.** Groq `openai/gpt-oss-120b`, 6 questions, 1.8 to 4.2 s each, all citations valid, judged on faithfulness to the retrieved excerpts: the corrected price from the notes (right), ways to find a lost remote (every claim traced to the excerpt, including a figure that first looked invented and was not), an absent topic (declined), the garbled budget figure (quoted as spoken instead of tidied into "12.125" as it had done in summaries), who owns what (right, with one embellishment that inferred duties from a job title; a prompt rule now forbids that). OpenRouter `deepseek/deepseek-v4-flash-0731:free`, 2 questions as a comparison: slightly better written and no embellishment, but 9 s and 32 s. **Decision: Groq leads Ask** (`order: "speed"`), then Gemini, then OpenRouter. Ask prompts are about 4,000 tokens with a 700-token answer budget, which fits Groq's 8,000 per minute; a second question inside the same minute waits for room (up to 20 s) instead of falling through. OpenRouter requests used today: 20 of 50.
  - **UI.** `/ask` chat with streamed answers, numbered citation chips with a quote preview, sources grouped by meeting in date order, scope pill ("Only: this meeting"), suggested questions, follow-up questions that carry the previous two exchanges. "Ask about this meeting" on the meeting page. Cmd-K palette from anywhere: type a question and press Enter, or jump to a meeting. Threads and messages are stored with their citations and model.
  - **Tests.** 58 passing (20 new: rank fusion, citation validation, line matching), written before the code. One expectation of mine was wrong again and was corrected, not the code.
  - **Not verified.** Multi-meeting answers: time ordering across meetings, the 4-per-meeting cap doing its job, the sources row grouping several meetings. The plan was to load the same team's next three AMI meetings (ES2011b to d), a real project whose decisions evolve; the dataset API returned "index is loading" for over half an hour. The fetch script is `scripts/fetch-ami.py`.
- **2026-09-18, cross-meeting Ask verified; seed transcripts pulled forward from step 8.** Seven fictional interrelated meetings (`fixtures/seed/`, 4,385 words, 2026-08-25 to 2026-09-17) loaded with `scripts/seed-transcripts.ts` as transcript, chunks and embeddings only: **no text-model calls**. Summaries for them are generated after the three reserved Gemini checks. Nothing was deleted.
  - **Retrieval across meetings (no model).** "How did the launch date change, and why?" drew 10 excerpts from 6 meetings, led by the three where the date was set or moved. "What has been said about price?" is where the per-meeting cap is binding: the 11-chunk AMI meeting was held to exactly 4 excerpts, leaving room for the pricing review, kickoff and Harbor call. The cap held in all five test questions.
  - **Answers, served by Groq `openai/gpt-oss-120b`** (3 requests, 4.8 to 7.6 s). Time ordering correct: October 6 at the Aug 25 kickoff, to October 20 at the Sep 3 engineering sync (offline sync rebuild), to October 27 at the Sep 15 readiness check (Paywell certificate on October 23). Starter $29 to $39 with beta customers grandfathered for 12 months: correct, two meetings cited. Sources row grouped by meeting in date order, three meetings and two meetings respectively. All citations valid, none removed.
  - **One faithfulness flaw, fixed in the prompt.** The first run said the move to October 20 "was also driven by the need for Paywell's certification"; in that meeting Paywell is named as a risk to the new date, not a cause. A rule now says a risk raised in the same meeting is not a cause unless someone says so. Re-run: each move is attributed to its stated reason only.
  - **Known weakness.** Line-level resolution picks by word overlap, so a citation for a sentence full of dates can land on a neighbouring line that also mentions dates (one citation for "landing on Tuesday October 27" opened the webinar-date line). It always lands inside the right excerpt.
  - **AMI follow-up meetings.** The dataset API was still returning "index is loading"; `scripts/fetch-ami.py` keeps retrying in the background and is not blocking anything.
