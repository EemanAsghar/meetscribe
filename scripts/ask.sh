#!/bin/sh
# Asks one question through the local /api/ask and prints the validated answer with each citation's resolved line.
# Usage: scripts/ask.sh <base-url> <cookie> <question> [meetingId]
B="$1"; C="$2"; Q="$3"; M="$4"
BODY=$(python3 -c "import json,sys; d={'question':sys.argv[1]}; (len(sys.argv)>2 and sys.argv[2]) and d.update(scope={'meeting_ids':[sys.argv[2]]}); print(json.dumps(d))" "$Q" "$M")
curl -s -m 150 -N -H "Cookie: $C" -H "Content-Type: application/json" -X POST "$B/api/ask" -d "$BODY" | python3 -c "
import sys, json, time
t0=time.time(); first=None; src=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    e=json.loads(line)
    if e['type']=='sources': src=e['sources']; print(f\"   retrieved {len(src)} excerpts from {len({s['meetingId'] for s in src})} meeting(s){' (keyword only)' if e['keywordOnly'] else ''}\")
    elif e['type']=='token' and first is None: first=time.time()-t0
    elif e['type']=='error': print('   ERROR:', e['message'])
    elif e['type']=='done':
        print(f\"   model {e['model']} | first token {first:.1f}s | done {time.time()-t0:.1f}s | citations removed as invalid: {e['removed']}\n\")
        print('   ' + e['text'].replace('\n','\n   ') + '\n')
        for c in e['citations']:
            s=next(x for x in src if x['n']==c['n'])
            when='notes' if c['start_ms']<0 else f\"{c['start_ms']//60000}:{c['start_ms']//1000%60:02d}\"
            print(f\"   [{c['n']}] {s['meetingTitle'][:34]} @ {when} | {c['speaker']}: {c['quote'][:150]}\")
"
