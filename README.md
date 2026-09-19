# Meetscribe

An AI meeting notetaker, rebuilt from Fathom.video in about 22 hours on free-tier services only.

**Live:** https://meetscribe-three.vercel.app. Click **"Explore the demo workspace"** to see the seeded meetings with no account, or **"Sign in with GitHub"** for a private workspace of your own (it starts empty).
**Public share page example:** https://meetscribe-three.vercel.app/s/sFZaL1ZPl2wW (no login)

It is not a clone. I used Fathom first, found three places where it let me down, and built those better:

| What I saw in Fathom | What Meetscribe does |
|---|---|
| I corrected something in the Scratchpad. The regenerated summary ignored it. | **Your notes feed the summary.** Where they disagree with the transcript, your notes win, and the affected bullets are marked "From your notes". |
| Calendar meetings get a branded pre-meeting popup. An instant meeting was recorded with no visible branding at all. | **No silent recording.** Scheduled or instant, capture always shows the same "Meetscribe is recording" indicator on every page, in the tab title and in the favicon, and in a small always-on-top window that floats over your other tabs and apps (so it is still there, with a working Stop, when you switch to the meeting itself). There is no code path that records without it. |
| "Ask Fathom" gave a cited answer with a jump-to-timestamp link. Good, and the feature I most wanted to beat. | **Ask Meetscribe** searches every meeting and your notes, orders the answer across meetings by date, previews the exact quote behind each citation, opens the exact transcript line, removes citations that point nowhere, and says "I couldn't find that in your meetings" without calling a model when nothing relevant exists. |

## Try it in five minutes

The demo workspace holds seven linked meetings of a fictional company (Northwind, launching a product called Dispatch) plus one real recorded meeting from the AMI Corpus.

1. **Ask** (sidebar, or press ⌘K anywhere): *"How did the launch date change, and why?"* The answer walks three meetings in date order (October 6, then 20, then 27) with the reason for each move. Hover a citation chip for the quote, click it to land on that line.
2. Ask *"What is the capital of France?"* It answers in under a second that it couldn't find that, and the footer shows no AI model was called.
3. Open **Remote Control Project Kick Off** → **Scratchpad**. The notes say the price target is 30 euros; the transcript says 25. The **Summary** says 30, marked "From your notes", next to the timestamp where 25 was said.
4. On any summary, switch the **template** (General, Enhanced, Sales Discovery, Standup). Templates already generated switch instantly.
5. **Action items**: tick, reassign, edit, add your own. Yours are never touched by regeneration.
6. **Share** a meeting, open the link in a private window. Same summary, no Scratchpad, no way into the app. "Reset link" kills the old URL.
7. **New meeting → Record now**. Either share the tab a Google Meet is in (tick "Also share tab audio") to capture the whole call, or record your microphone. Press Stop in the indicator. Or upload audio, or paste a transcript in any of five formats.
8. Sidebar → **"Simulate a calendar meeting in 2 min"** to see the pre-meeting prompt.

## What is real and what is stubbed

**Real:** transcript parsing (five formats plus a plain-text fallback), LLM summaries and action items, template switching, notes feeding regeneration, hybrid retrieval and cited answers, line-level citation resolution, audio upload, Whisper transcription, in-browser recording, sharing, persistence. Nothing in the UI is canned.

**Stubbed, on purpose:**
- **The meeting bot.** Nothing joins Zoom, Meet or Teams on its own. The closest real thing is **Record a meeting tab**: you join the call in a browser tab, share that tab's audio with Meetscribe, and it records everyone on the call mixed with your microphone (Chrome or Edge on a computer). Upload and paste cover everything else. Everything downstream treats the result as a captured call.
- **Calendar sync.** "Simulate a calendar meeting" creates the scheduled meeting a calendar would.
- **Speaker names on audio.** Whisper does not tell voices apart, so recordings show one "Speaker". Pasted transcripts keep their speakers. The UI says this where it matters.

**Authentication is real.** Sign in with GitHub (Auth.js, OAuth with PKCE, session in an encrypted cookie, no passwords stored). Each account gets its own workspace, and every route and API checks ownership: a signed-in user asking for someone else's meeting, recording or share settings gets a 404, and Ask only searches their own meetings. The one-click demo workspace is kept next to it on purpose, because that is where the seeded meetings live and a reviewer should not have to create data to see the product.

## Honest limitations

These are disclosed rather than hidden. `SPEC.md` has the measurements behind each.

- **Free-tier model quotas shaped the build.** Every Gemini Flash model allows 20 requests a day. Gemini 3.5 and 3.6 Flash were the only models that met the quality bar on a real, noisy 18-minute transcript, and development testing used the quota up.
- **The demo summaries were generated by Groq `gpt-oss-120b`, not Gemini**, for that reason. Side by side on the real transcript, Groq is fast and faithful in Q&A but weaker at extraction: it missed action items and once turned a garbled spoken figure into a precise number nobody said. Prompt rules now cover the cases found, short meetings get a higher reasoning setting, and I read every seeded summary against its transcript. The model that wrote each summary is shown under it.
- **Two checks were done with a lighter or alternate model and not repeated on a full Gemini model:** regenerating a summary from Scratchpad notes (verified on `gemini-3.5-flash-lite` and Groq) and the fall-through for a transcript too long for Groq (the mechanism is verified; on the day, no provider had quota left to produce the final summary).
- **Real speech through a real microphone was not tested by me.** The recorder, upload, lifecycle and Whisper-on-real-speech were, using a headless browser with a fake microphone and a spoken audio file.
- **Ask has no recency weighting.** An answer is as current as what retrieval returns.
- **Line-level citations match by word overlap**, so a sentence full of dates can open a neighbouring line. It always lands inside the right excerpt.
- **Meetings longer than about 20 minutes** do not fit Groq's 8,000 tokens per minute and need Gemini quota.

## How it works

```
paste / upload / record ──► segments ──► chunks (150-250 words, embedded with the meeting title)
                               │                      │
                               ▼                      ▼
                  summary + action items        Ask: pgvector + full-text, rank fusion,
                  (cited by line index,         ≤4 excerpts per meeting, relevance floor
                   mapped to real offsets)               │
                               │                         ▼
                               ▼              streamed answer, citations validated,
                     one stored summary       each resolved to one transcript line
                     rendered by one component
                     in the app AND on /s/:slug
```

- **Grounding.** The model never writes a timestamp. It cites transcript lines by index; the server maps indices to real segment offsets and drops anything that does not resolve. Across every run recorded in `SPEC.md`, zero citations pointed at a non-existent line.
- **One summary, two views.** The share page and the app read the same database row and render it with the same component, so they cannot drift.
- **Providers** sit behind one interface (`src/lib/llm.ts`) with an order per task, hang detection (Gemini is streamed and abandoned if no first token arrives in 12 s), a size pre-check for Groq, wait-and-retry on its per-minute limit, and a short circuit breaker. Every result records which model produced it.
- **Recordings are private.** The Blob store is private; audio reaches the owner through an authenticated streaming route and is never on the share page.

**Look.** Dark, with a cyan accent and Ask docked beside each meeting, modelled on the product screenshots Fathom publishes on its own site. Every colour is a design token, so the whole re-theme was a change to one block of CSS variables. The name, mark and wording are Meetscribe's own.

**Stack:** Next.js 16 (App Router), TypeScript, Tailwind v4, Radix primitives, Neon Postgres with pgvector, Drizzle, Vercel (functions pinned to `cle1`, next to the database), Vercel Blob. Gemini, Groq (chat and Whisper) and OpenRouter, all free tier.

## Run it

```bash
cp .env.example .env.local     # fill in: Neon (pooled URL), Gemini, Groq, OpenRouter, Blob token, SESSION_SECRET,
                               # and AUTH_SECRET + a GitHub OAuth app (callback: <origin>/api/auth/callback/github)
npm install
npm run db:migrate             # schema, pgvector, templates, demo user
npx tsx scripts/seed-transcripts.ts   # the seven demo meetings (transcripts and embeddings, no model calls)
npm run dev
npm test                       # 58 tests: parser, chunker, rank fusion, citation validation
```

## Where to look

| Path | What |
|---|---|
| `SPEC.md` | The locked spec, then a dated changelog of every measurement, surprise and reversed decision. The most honest document in the repo. |
| `CAPTURE-TEST.md`, `.agent-logs/` | The full prompt-and-response record of building this with an AI agent, including the dead ends. |
| `src/lib/llm.ts` | Provider chain, with the measured limits in its header. |
| `src/lib/generate.ts` | Prompts and the grounding rule. |
| `src/lib/ask/` | Retrieval, rank fusion, citation validation, line matching. |
| `src/lib/transcript/` | The parser and chunker, with the tests written before them. |
| `src/auth.ts`, `src/proxy.ts`, `src/lib/auth.ts` | GitHub sign-in, the route gate, and the one place a request is resolved to a user. |
| `src/components/recording.tsx` | The recorder and the indicator. |
| `src/components/summary-body.tsx` | The single summary renderer shared by app and share page. |
| `fixtures/` | The seed meetings and a real AMI Corpus meeting (CC BY 4.0). |
| `scripts/` | Verification scripts used during the build. They make real calls. |

## Things I would do next

Speaker diarization (AssemblyAI or Deepgram), a real calendar integration, recency weighting and a reranker in Ask, streaming the summary as it is written, and a paid model tier, which would remove most of the limitations above for a few cents a day.
