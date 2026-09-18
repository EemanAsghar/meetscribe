# Capture test

## Tool and model

- **Tool:** Claude Code, VSCode extension (runs on the Claude Agent SDK). A standalone `claude` CLI (2.1.202) is also installed and was used for the headless canary sessions below.
- **Model:** `claude-fable-5-1` (Claude Fable 5.1) for the build. One model plans and executes; there is no separate planner. Subagents inherit it.
- **Canary sessions ran on `claude-sonnet-5`**, not Fable. The standalone CLI is older than the extension's bundled one and rejects Fable (see "What did not work", item 1). The log shows this per entry.
- **Hook mechanism:** Claude Code lifecycle hooks. `UserPromptSubmit` fires on every prompt, `Stop` fires at the end of every turn. Both get JSON on stdin with `session_id` and `transcript_path`.

## Mechanism

Config file changed: [`.claude/settings.json`](.claude/settings.json). It wires `SessionStart`, `UserPromptSubmit` and `Stop` to one script, [`.claude/hooks/capture.py`](.claude/hooks/capture.py) (Python 3, stdlib only).

- **UserPromptSubmit:** appends a `PROMPT` entry with the `prompt` field from stdin, verbatim.
- **Stop:** appends a `RESPONSE` entry. The text is the assistant text produced after the last tool call of the turn, read from the transcript. Thinking, tool calls, tool results and text written between tool calls are not captured. The model name comes from the transcript's assistant message.
- **Append-only:** existing entry bytes are carried over untouched. Only the frontmatter (`total_exchanges`, `last_prompt_time`, `model`) is rewritten.
- **Interrupted turns:** if a turn never reaches `Stop`, the next `UserPromptSubmit` recovers the response from the transcript, or writes a clearly marked `[capture note: ...]` if there was none.
- **Hook installed mid-session:** the first event seen for an unknown session backfills that session's earlier turns from the transcript, with the transcript's own timestamps. This is how the setup prompt of the install session gets logged.
- The hook always exits 0 and prints nothing, so it cannot block a turn or inject text into the context. Errors go to `.claude/capture-state/errors.log`.
- `.claude/capture-state/` (counters, lock, error log) is gitignored. `.agent-logs/` is not.

## Where the canaries landed

| Session | File |
|---|---|
| Canary 1, two turns, second one via `--resume` with a tool call | `.agent-logs/2026-09-18_08-08-37_4218671d-8e6e-4fb5-8477-5e6b0a472ac1.md` |
| Canary 2, separate fresh session | `.agent-logs/2026-09-18_08-09-45_009eb4ca-e07b-4e79-bd3f-1c2a2349bb02.md` |
| Canary 3, typed in the VSCode extension on Fable, in the session that installed the hook | `.agent-logs/2026-09-18_08-05-02_f00dba98-f4d0-4441-81c7-41f622a925d7.md` |

Canaries 1 and 2 were each a new `claude -p` process started from the repo root. They share nothing with the session that installed the hook except the settings file on disk.

## Canary entries, raw

### Session `4218671d`

```
[LOG_ENTRY type=PROMPT num=1 session=4218671d]
timestamp: 2026-09-18T08:08:37.766Z
model: claude-fable-5-1[1m]

CAPTURE TEST — 8x assignment, Eeman Asghar


[LOG_ENTRY type=RESPONSE num=1 session=4218671d]
timestamp: 2026-09-18T08:08:39.574Z
model: claude-sonnet-5

I'm ready to help. What would you like me to do for the 8x assignment?


[LOG_ENTRY type=PROMPT num=2 session=4218671d]
timestamp: 2026-09-18T08:09:22.071Z
model: claude-sonnet-5

CAPTURE TEST 2 — first say 'checking now', then run ls -a with the Bash tool, then tell me in one sentence how many entries there are.


[LOG_ENTRY type=RESPONSE num=2 session=4218671d]
timestamp: 2026-09-18T08:09:25.274Z
model: claude-sonnet-5

There are 6 entries in the directory listing.


```

Turn 2 asked the model to say "checking now", run `ls -a`, then answer. Only the final sentence is in the log: the interim text and the tool call are excluded, as the brief requires.

### Session `009eb4ca`

```
[LOG_ENTRY type=PROMPT num=1 session=009eb4ca]
timestamp: 2026-09-18T08:09:45.360Z
model: sonnet

CAPTURE TEST — 8x assignment, Eeman Asghar (second session)


[LOG_ENTRY type=RESPONSE num=1 session=009eb4ca]
timestamp: 2026-09-18T08:09:47.766Z
model: claude-sonnet-5

I don't have anything from a prior session in memory yet — this looks like the start of our work together. What would you like to work on?


```

### Session `f00dba98` (VSCode extension, `claude-fable-5-1`)

This is the session that installed the hook. The extension picked up the new `.claude/settings.json` without a restart. PROMPT 1 and RESPONSE 1 in that file (the setup brief and the reply to it) were backfilled from the transcript when `Stop` first fired, because the hook did not exist yet when the brief was pasted. The canary is entry 2:

```
[LOG_ENTRY type=PROMPT num=2 session=3f9c1a20]
    timestamp: 2026-08-28T09:31:11.204Z
    model: claude-opus-5

    The brief builder is wrong. A brand cannot see projected outcomes before
    committing budget, which is the whole point. Redo it.

---

## 4. Verify it works, then prove it

Do not start the assignment until you have done this.

1. Send yourself a canary prompt: `CAPTURE TEST — 8x assignment, <your name>`
2. Confirm the prompt **and** the response both appear in `.agent-logs/`
3. Start a second session, send another canary, and confirm that one lands too. A hook
   that only works in the session that created it is not installed.
4. Create `CAPTURE-TEST.md` in the repo root containing:
   - Your tool and model, from step 1
   - The mechanism you used, and the config file you changed
   - The path to the log file the canaries landed in
   - Both canary entries, pasted raw
   - Anything you tried first that did not work

`CAPTURE-TEST.md` is the first thing we open. If capture is not working the rest of the
submission is not assessable, so get this green before you build anything.

---

## 5. Then build

Once capture is verified, start the assignment in the same repo. Everything from here
is recorded automatically and you can stop thinking about it.

One thing worth knowing: we are not scoring the log for tidiness or for looking
impressive. Dead ends, wrong turns, and the moment you realised the first approach was
wrong are the most useful things in it. Leave them in.


[LOG_ENTRY type=RESPONSE num=1 session=f00dba98]
timestamp: 2026-09-18T08:10:40.889Z
model: claude-fable-5-1

Written for: the 8x assessors (`CAPTURE-TEST.md`); the rest of this message is for you.

Capture is installed and working in fresh sessions, but it is **not yet confirmed for this VSCode session**. The hook was installed after your first prompt, so whether this turn gets logged depends on the extension having picked up the new hooks.

Both canary sessions below were new `claude -p` processes on Sonnet, not Fable. Your standalone CLI (2.1.202) is older than the extension's and rejects Fable, which is why they ran on Sonnet.

- **Setup:** Claude Code in VSCode, on `claude-fable-5-1`, which both plans and executes. Claude Code has native hooks, so nothing is logged by hand.
- **Mechanism:** [.claude/settings.json](.claude/settings.json) wires `UserPromptSubmit` and `Stop` to [.claude/hooks/capture.py](.claude/hooks/capture.py). The script appends the verbatim prompt and the final response of each turn to [.agent-logs/](.agent-logs/) in the brief's format.
- **Canary 1:** two turns, the second via `--resume` with a tool call. Both prompts and both responses landed in one file. The text the model wrote before the tool call and the call itself were excluded, as the brief requires.
- **Canary 2:** a separate fresh session. Prompt and response both landed.
- **Dead ends:** four failed attempts are left in the logs and written up in [CAPTURE-TEST.md](CAPTURE-TEST.md): a canary with no response, `model: unknown`, a wrong model on a PROMPT entry, and `-c` resuming the wrong session.
- **Commit:** everything is in `267c32d`. There was no git repo, so I ran `git init`.

One limit: hook input has no model field, so the first PROMPT entry of a session takes its model from the `--model` flag, env or settings. RESPONSE entries always carry the real model id from the transcript.

**Before building:**
1. After this turn ends, check `.agent-logs/` for a file ending in `f00dba98-f4d0-4441-81c7-41f622a925d7.md`. If it exists, in-editor capture works. It should hold the full setup prompt and this reply.
2. If it does not exist, reload the VSCode window and send `CAPTURE TEST — 8x assignment, Eeman Asghar`. This turn can be recovered with `python3 .claude/hooks/capture.py --backfill ~/.claude/projects/-Users-mac-8x-Fathom-AI/f00dba98-f4d0-4441-81c7-41f622a925d7.jsonl`, which I added as a one-off recovery path and have not run yet.
3. Send me the in-editor canary either way. I will add that entry to `CAPTURE-TEST.md` so it shows Fable in the extension, not just Sonnet over the CLI.

The `author` field uses your git name, `EemanAsghar`, but `gh` is logged in as `AutoPasar`. If your GitHub handle is different, run `git config user.name <handle>` in this repo.

Seven claude.ai connectors (Canva, Cloudflare, Google Drive, Higgsfield, Linear, Nano banana, n8n) need authorizing in your claude.ai connector settings before they can be used. None were needed here.


[LOG_ENTRY type=PROMPT num=2 session=f00dba98]
timestamp: 2026-09-18T08:11:47.914Z
model: claude-fable-5-1

CAPTURE TEST — 8x assignment, Eeman Asghar
```

The RESPONSE for this canary is written by the `Stop` hook when the turn ends, which is after this file was edited, so it cannot be pasted from inside the same turn. It is RESPONSE num=2 in the log file above.

## What did not work

All of these are still visible in `.agent-logs/`. Nothing was deleted or edited.

1. **First canary got no response.** `2026-09-18_08-07-22_14e3fa09-...md` has a PROMPT and no RESPONSE. The standalone CLI (2.1.202) defaulted to `claude-fable-5-1[1m]` from global settings and the API refused it: `Claude Code 2.1.202 does not support this model; version 2.1.251 or newer is required`. The turn died before `Stop`, so there was no response to capture. The prompt hook had fired correctly. Later canaries pass `--model sonnet`.
2. **`model: unknown` on both entries.** `2026-09-18_08-07-33_bd9651e2-...md`. Two causes:
   - I assumed `SessionStart` or `UserPromptSubmit` input includes the model. I dumped the raw hook input in a scratch project to check: neither does.
   - `Stop` fires before the final assistant message is flushed to the transcript. My wait loop exited early because `last_assistant_message` already had the text, so it never saw the model. Fixed: the loop now waits for the transcript entry (up to 3 s) and uses `last_assistant_message` only as a fallback for the text.
3. **Wrong model on a PROMPT entry.** Session `4218671d`, PROMPT 1 says `claude-fable-5-1[1m]` but the session ran on Sonnet. My first fix for item 2 fell back to the `model` key in settings, which is wrong when the session is launched with `--model`. Fixed: the script now checks the launching process's `--model` flag first, then `ANTHROPIC_MODEL`, then settings. Session `009eb4ca` shows the result (`sonnet` on the PROMPT, `claude-sonnet-5` on the RESPONSE).
4. **`claude -p -c` continued the wrong session.** "Most recent session" in this directory was the live VSCode session, not my canary. It errored before writing anything. I switched to `--resume <session-id>`.

## Known limit

Hook input has no model field. For the **first** prompt of a session the PROMPT entry's model is a best guess (`--model` flag, env, settings), and a `/model` switch shows up on the RESPONSE of the turn it first applies to, not on that turn's PROMPT. From the second prompt on, the PROMPT entry uses the model of the latest assistant message. RESPONSE entries always carry the real model id from the API response.
