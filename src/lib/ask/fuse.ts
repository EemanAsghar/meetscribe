// Reciprocal rank fusion of the vector and keyword result lists (SPEC.md section 5).
// RRF needs no score calibration between the two searches: only positions matter.

const K = 60;

export function fuse<T extends { id: string; meetingId: string }>(vector: T[], keyword: T[], opts: { limit: number; perMeeting: number }): T[] {
  const score = new Map<string, number>();
  const byId = new Map<string, T>();
  for (const list of [vector, keyword]) {
    list.forEach((item, rank) => {
      score.set(item.id, (score.get(item.id) ?? 0) + 1 / (K + rank + 1));
      if (!byId.has(item.id)) byId.set(item.id, item);
    });
  }
  const ranked = [...byId.values()].sort((a, b) => score.get(b.id)! - score.get(a.id)!);

  // Without the cap, a single long meeting fills every slot and "across meetings" is true in name only.
  const perMeeting = new Map<string, number>();
  const out: T[] = [];
  for (const item of ranked) {
    const used = perMeeting.get(item.meetingId) ?? 0;
    if (used >= opts.perMeeting) continue;
    perMeeting.set(item.meetingId, used + 1);
    out.push(item);
    if (out.length === opts.limit) break;
  }
  return out;
}
