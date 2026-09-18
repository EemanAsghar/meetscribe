import { describe, expect, it } from "vitest";
import { chunkSegments } from "./chunk";
import type { ParsedSegment } from "./parse";

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
const seg = (idx: number, speaker: string, n: number, startMs = idx * 60000): ParsedSegment => ({
  idx, speaker, startMs, endMs: startMs + 60000, text: words(n),
});
const count = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("chunkSegments", () => {
  it("packs whole segments into chunks of 150 to 250 words", () => {
    const segments = Array.from({ length: 12 }, (_, i) => seg(i, i % 2 ? "B" : "A", 60));
    const chunks = chunkSegments(segments);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(0, -1)) {
      expect(c.wordCount).toBeGreaterThanOrEqual(150);
      expect(c.wordCount).toBeLessThanOrEqual(250);
    }
  });

  it("covers every segment exactly once, in order", () => {
    const segments = Array.from({ length: 9 }, (_, i) => seg(i, "A", 70));
    const chunks = chunkSegments(segments);
    expect(chunks[0].segFrom).toBe(0);
    expect(chunks.at(-1)!.segTo).toBe(8);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].segFrom).toBe(chunks[i - 1].segTo + 1);
  });

  it("takes start and end offsets from its first and last segment", () => {
    const segments = [seg(0, "A", 100), seg(1, "B", 100), seg(2, "A", 100)];
    const [c] = chunkSegments(segments);
    expect(c.startMs).toBe(0);
    expect(c.endMs).toBe(segments[c.segTo].endMs);
  });

  it("prefixes each turn with its speaker and lists the speakers", () => {
    const [c] = chunkSegments([seg(0, "Priya", 5), seg(1, "Marcus", 5)]);
    expect(c.text).toBe(`Priya: ${words(5)}\nMarcus: ${words(5)}`);
    expect(c.speakerLabel).toBe("Priya, Marcus");
  });

  it("keeps a short transcript as a single chunk", () => {
    const chunks = chunkSegments([seg(0, "A", 20), seg(1, "B", 20)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].wordCount).toBe(40);
  });

  it("splits one very long monologue into several chunks that share its segment index", () => {
    const long: ParsedSegment = { idx: 0, speaker: "A", startMs: 0, endMs: 600000, text: Array.from({ length: 60 }, () => `${words(11)}.`).join(" ") };
    const chunks = chunkSegments([long]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(count(c.text)).toBeLessThanOrEqual(251); // 250 + the speaker prefix
      expect(c.segFrom).toBe(0);
      expect(c.segTo).toBe(0);
    }
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[1].startMs).toBeGreaterThan(0);
    expect(chunks.at(-1)!.endMs).toBe(600000);
  });

  it("returns nothing for no segments", () => {
    expect(chunkSegments([])).toEqual([]);
  });
});
