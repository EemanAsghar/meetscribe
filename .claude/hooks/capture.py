#!/usr/bin/env python3
"""Agent capture hook for Claude Code.

Wired in .claude/settings.json to SessionStart, UserPromptSubmit and Stop.
Appends the verbatim prompt and the final response of every turn to
.agent-logs/YYYY-MM-DD_HH-MM-SS_<session-id>.md. Nothing in between is
captured: no thinking, no tool calls, no intermediate text.

Entries are append-only. The only part of a log file that is ever rewritten
is the frontmatter (total_exchanges, last_prompt_time, model).

The hook must never break the session: every failure is swallowed, written
to .claude/capture-state/errors.log, and the process exits 0 with no stdout
(stdout of a UserPromptSubmit hook would be injected into the context).
"""
import fcntl
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
LOG_DIR = os.path.join(PROJECT_DIR, ".agent-logs")
STATE_DIR = os.path.join(PROJECT_DIR, ".claude", "capture-state")
TOOL = "claude-code"
HEADER_LINES = 18  # frontmatter (11) + title block (7); see render_header()
INTERRUPTED_NOTE = "[capture note: no final response was produced for this prompt (turn interrupted or ended without text)]"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (
        datetime.now(timezone.utc).microsecond // 1000
    )


def author():
    if os.environ.get("AGENT_LOG_AUTHOR"):
        return os.environ["AGENT_LOG_AUTHOR"]
    try:
        out = subprocess.run(
            ["git", "config", "user.name"], capture_output=True, text=True, timeout=3, cwd=PROJECT_DIR
        ).stdout.strip()
        return out or "unknown"
    except Exception:
        return "unknown"


def configured_model():
    """Model for the first PROMPT of a session. Hook input carries no model
    field, so until an assistant message exists in the transcript this is the
    best available: --model flag of the launching process, env override, then
    settings files by precedence. A /model switch is not visible here; the RESPONSE entry
    always carries the real one."""
    pid = os.getppid()
    for _ in range(5):  # hook <- shell <- claude: look for an explicit --model flag
        try:
            out = subprocess.run(["ps", "-o", "ppid=,args=", "-p", str(pid)],
                                 capture_output=True, text=True, timeout=3).stdout.split()
        except Exception:
            break
        if not out:
            break
        for i, tok in enumerate(out[1:-1], 1):
            if tok == "--model":
                return out[i + 1]
            if tok.startswith("--model="):
                return tok.split("=", 1)[1]
        pid = int(out[0])
        if pid <= 1:
            break
    if os.environ.get("ANTHROPIC_MODEL"):
        return os.environ["ANTHROPIC_MODEL"]
    for path in (os.path.join(PROJECT_DIR, ".claude", "settings.local.json"),
                 os.path.join(PROJECT_DIR, ".claude", "settings.json"),
                 os.path.expanduser("~/.claude/settings.json")):
        try:
            with open(path, encoding="utf-8") as fh:
                model = json.load(fh).get("model")
            if model:
                return model
        except Exception:
            continue
    return None


# ---------------------------------------------------------------- transcript


def read_turns(transcript_path):
    """Parse the session transcript into turns.

    A turn starts at a human prompt (a user entry that is not a tool result,
    not meta, not a sidechain/subagent entry). Its final response is the text
    the assistant produced after the last tool call of that turn.
    """
    turns = []
    if not transcript_path or not os.path.exists(transcript_path):
        return turns
    with open(transcript_path, encoding="utf-8") as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("isSidechain") or e.get("isMeta") or e.get("isCompactSummary"):
                continue
            msg = e.get("message") or {}
            content = msg.get("content")
            if e.get("type") == "user":
                if isinstance(content, str):
                    text, is_prompt = content, True
                else:
                    blocks = content or []
                    is_prompt = bool(blocks) and all(b.get("type") == "text" for b in blocks)
                    text = "\n".join(b.get("text", "") for b in blocks) if is_prompt else ""
                if is_prompt:
                    turns.append(
                        {"uuid": e.get("uuid"), "prompt": text, "prompt_time": e.get("timestamp"),
                         "final": [], "final_time": None, "model": None}
                    )
                elif turns:
                    # tool result: whatever text came before it was intermediate
                    turns[-1]["final"] = []
            elif e.get("type") == "assistant" and turns:
                t = turns[-1]
                if msg.get("model") and not str(msg["model"]).startswith("<"):
                    t["model"] = msg["model"]
                for b in content or []:
                    if b.get("type") == "tool_use":
                        t["final"] = []
                    elif b.get("type") == "text" and b.get("text", "").strip():
                        t["final"].append(b["text"])
                        t["final_time"] = e.get("timestamp")
    return turns


# --------------------------------------------------------------------- state


def state_path(session_id):
    return os.path.join(STATE_DIR, session_id + ".json")


def load_state(session_id):
    try:
        with open(state_path(session_id), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def save_state(session_id, state):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = state_path(session_id) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    os.replace(tmp, state_path(session_id))


# ------------------------------------------------------------------ log file


def render_header(state, session_id):
    short = session_id[:8]
    project = os.path.basename(PROJECT_DIR)
    date = state["first_prompt_time"][:10]
    lines = [
        "---",
        "session_id: " + session_id,
        "date: " + date,
        "author: " + state["author"],
        "model: " + state["model"],
        "tool: " + TOOL,
        "project: " + project,
        "total_exchanges: %d" % state["prompts"],
        "first_prompt_time: " + state["first_prompt_time"],
        "last_prompt_time: " + state["last_prompt_time"],
        "---",
        "",
        "# Session Log - " + date,
        "",
        "Session: `%s` | Project: `%s` | Author: `%s`" % (short, project, state["author"]),
        "",
        "---",
        "",
    ]
    assert len(lines) == HEADER_LINES
    return "\n".join(lines) + "\n"


def append_entry(state, session_id, kind, num, timestamp, model, text):
    """Append one entry and refresh the frontmatter. Entry bodies already in
    the file are carried over byte for byte."""
    os.makedirs(LOG_DIR, exist_ok=True)
    path = os.path.join(LOG_DIR, state["file"])
    body = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            body = "".join(fh.readlines()[HEADER_LINES:])
    entry = "[LOG_ENTRY type=%s num=%d session=%s]\ntimestamp: %s\nmodel: %s\n\n%s\n\n\n" % (
        kind, num, session_id[:8], timestamp, model, text,
    )
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(render_header(state, session_id) + body + entry)
    os.replace(tmp, path)


def log_prompt(state, session_id, text, timestamp, model, uuid=None):
    if state["prompts"] == 0:
        state["first_prompt_time"] = timestamp
        stamp = timestamp[:19].replace("T", "_").replace(":", "-")
        state["file"] = "%s_%s.md" % (stamp, session_id)
    state["prompts"] += 1
    state["last_prompt_time"] = timestamp
    state["model"] = model
    state["pending"] = True
    if uuid:
        state["uuids"].append(uuid)
    append_entry(state, session_id, "PROMPT", state["prompts"], timestamp, model, text)


def log_response(state, session_id, text, timestamp, model):
    state["model"] = model
    state["pending"] = False
    append_entry(state, session_id, "RESPONSE", state["prompts"], timestamp, model, text)


# -------------------------------------------------------------------- events


def new_state(model):
    return {"file": None, "prompts": 0, "pending": False, "uuids": [], "author": author(),
            "model": model or "unknown", "first_prompt_time": None, "last_prompt_time": None}


def backfill(state, session_id, turns):
    """Log complete turns that are in the transcript but not in the log yet.
    Covers a hook installed mid-session. Timestamps come from the transcript."""
    for t in turns:
        if t["uuid"] in state["uuids"]:
            continue
        model = t["model"] or state["model"]
        log_prompt(state, session_id, t["prompt"], t["prompt_time"] or now_iso(), model, t["uuid"])
        log_response(state, session_id, "\n\n".join(t["final"]) or INTERRUPTED_NOTE,
                     t["final_time"] or now_iso(), model)


def on_session_start(data, session_id):
    state = load_state(session_id) or new_state(None)
    if data.get("model"):
        state["session_model"] = data["model"]
        if state["prompts"] == 0:
            state["model"] = data["model"]
    save_state(session_id, state)


def on_prompt(data, session_id):
    prompt = data.get("prompt", "")
    turns = read_turns(data.get("transcript_path"))
    # the transcript may or may not already hold the prompt being submitted
    if turns and not turns[-1]["final"] and turns[-1]["prompt"] == prompt:
        turns.pop()
    state = load_state(session_id)
    fresh = state is None or state["prompts"] == 0
    if state is None:
        state = new_state(None)
    if fresh:
        backfill(state, session_id, turns)
    elif state["pending"]:
        # previous turn never reached Stop (interrupt, crash): heal from transcript
        last = turns[-1] if turns else None
        if last and last["final"]:
            log_response(state, session_id, "\n\n".join(last["final"]), last["final_time"] or now_iso(),
                         last["model"] or state["model"])
        else:
            log_response(state, session_id, INTERRUPTED_NOTE, now_iso(), state["model"])
    model = configured_model() or "unknown"
    if any(t["model"] for t in turns):
        model = [t["model"] for t in turns if t["model"]][-1]
    log_prompt(state, session_id, prompt, now_iso(), model)
    save_state(session_id, state)


def on_stop(data, session_id):
    state = load_state(session_id)
    path = data.get("transcript_path")
    if state is None or state["prompts"] == 0:
        # hook was installed mid-session: no PROMPT entry exists for this turn
        state = state or new_state(None)
        time.sleep(1.0)  # let the final message flush
        backfill(state, session_id, read_turns(path))
        save_state(session_id, state)
        return
    if not state["pending"]:
        return
    text, model, stamp = data.get("last_assistant_message") or "", None, now_iso()
    # the final message can land in the transcript slightly after Stop fires
    for _ in range(10):
        turns = read_turns(path)
        if turns and turns[-1]["final"]:
            model = turns[-1]["model"]
            if not text:
                text = "\n\n".join(turns[-1]["final"])
            break
        time.sleep(0.3)  # keep waiting even if text is known: the model name is only in the transcript
    if turns and turns[-1]["uuid"] and turns[-1]["uuid"] not in state["uuids"]:
        state["uuids"].append(turns[-1]["uuid"])
    log_response(state, session_id, text or INTERRUPTED_NOTE, stamp, model or state["model"])
    save_state(session_id, state)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--backfill":
        # recovery only: log turns of a session whose hooks were not active yet
        path = sys.argv[2]
        data = {"hook_event_name": "Backfill", "transcript_path": path,
                "session_id": os.path.basename(path).rsplit(".", 1)[0]}
    else:
        data = json.load(sys.stdin)
    session_id = data.get("session_id") or "unknown-session"
    event = data.get("hook_event_name")
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if event == "SessionStart":
            on_session_start(data, session_id)
        elif event == "UserPromptSubmit":
            on_prompt(data, session_id)
        elif event == "Stop":
            on_stop(data, session_id)
        elif event == "Backfill":
            state = load_state(session_id) or new_state(None)
            backfill(state, session_id, [t for t in read_turns(data["transcript_path"]) if t["final"]])
            save_state(session_id, state)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            with open(os.path.join(STATE_DIR, "errors.log"), "a", encoding="utf-8") as fh:
                fh.write(now_iso() + "\n" + traceback.format_exc() + "\n")
        except Exception:
            pass
    sys.exit(0)
