"""Fetches AMI Corpus meetings from the Hugging Face dataset viewer API and writes transcript fixtures.
Usage: python3 scripts/fetch-ami.py ES2011b ES2011c ...   (CC BY 4.0; see fixtures/README.md)"""
import json, re, sys, time, urllib.parse, urllib.request

BASE = "https://datasets-server.huggingface.co/filter"

def page(meeting, split, offset):
    q = urllib.parse.urlencode({"dataset": "edinburghcstr/ami", "config": "ihm", "split": split, "where": f"\"meeting_id\"='{meeting}'", "offset": offset, "length": 100})
    for attempt in range(60):
        try:
            with urllib.request.urlopen(f"{BASE}?{q}", timeout=90) as r:
                d = json.load(r)
            if "rows" in d:
                return d
        except Exception:
            pass
        time.sleep(10)
    raise SystemExit(f"{meeting}: gave up at offset {offset}")

def sentence(t):
    t = t.lower().strip()
    t = re.sub(r"\bi\b", "I", t)
    t = re.sub(r"\bi'(m|ll|ve|d)\b", lambda m: "I'" + m.group(1), t)
    return t[:1].upper() + t[1:]

for meeting in sys.argv[1:]:
    rows, split = [], None
    for candidate in ("validation", "train", "test"):
        first = page(meeting, candidate, 0)
        if first.get("num_rows_total", 0) > 0:
            split, total = candidate, first["num_rows_total"]
            rows = [r["row"] for r in first["rows"]]
            break
    if not split:
        print(f"{meeting}: not found"); continue
    for offset in range(100, total, 100):
        rows += [r["row"] for r in page(meeting, split, offset)["rows"]]
    rows.sort(key=lambda r: float(r["begin_time"]))
    order = []
    for r in rows:
        if r["speaker_id"] not in order: order.append(r["speaker_id"])
    turns = []
    for r in rows:
        b, e, sp = float(r["begin_time"]), float(r["end_time"]), r["speaker_id"]
        if turns and turns[-1]["sp"] == sp and b - turns[-1]["e"] < 2.0:
            turns[-1]["t"] += " " + r["text"].lower(); turns[-1]["e"] = e
        else:
            turns.append({"sp": sp, "b": b, "e": e, "t": r["text"].lower()})
    clock = lambda s: f"{int(s)//60:02d}:{int(s)%60:02d}"
    out = {"meeting": meeting, "split": split, "speaker_ids": order, "turns": [[clock(t["b"]), t["sp"], sentence(t["t"])] for t in turns]}
    json.dump(out, open(f"fixtures/.{meeting}.raw.json", "w"))
    print(f"{meeting}: {len(rows)} utterances, {len(turns)} turns, {sum(len(t['t'].split()) for t in turns)} words, ends {clock(turns[-1]['e'])}, speakers {order}", flush=True)
