import { describe, expect, it } from "vitest";
import { TranscriptError, parseTranscript } from "./parse";

const MS_PER_WORD = 400; // 150 words per minute, SPEC.md section 4

describe("format: [00:03] Speaker: text", () => {
  const input = `[00:03] Priya Raman: Thanks for joining. Let's start with the launch date.
[00:11] Marcus Oyelaran: We can't hit March 3rd. QA needs two more weeks.
That pushes us to the 17th at the earliest.
[01:02:45] Priya Raman: Okay, the 17th it is.`;

  it("detects the format and keeps real timestamps", () => {
    const t = parseTranscript(input);
    expect(t.format).toBe("bracketed");
    expect(t.timestampsEstimated).toBe(false);
    expect(t.segments.map((s) => s.startMs)).toEqual([3000, 11000, 3765000]);
  });

  it("supports both mm:ss and hh:mm:ss", () => {
    expect(parseTranscript(input).segments[2].startMs).toBe((1 * 3600 + 2 * 60 + 45) * 1000);
  });

  it("appends continuation lines to the previous segment", () => {
    const seg = parseTranscript(input).segments[1];
    expect(seg.speaker).toBe("Marcus Oyelaran");
    expect(seg.text).toBe("We can't hit March 3rd. QA needs two more weeks. That pushes us to the 17th at the earliest.");
  });

  it("ends each segment where the next one starts", () => {
    const [a, b] = parseTranscript(input).segments;
    expect(a.endMs).toBe(b.startMs);
  });

  it("estimates the end of the last segment from its length", () => {
    const last = parseTranscript(input).segments[2];
    expect(last.endMs).toBe(last.startMs + 5 * MS_PER_WORD);
  });

  it("lists speakers in order of first appearance, without duplicates", () => {
    expect(parseTranscript(input).speakers).toEqual(["Priya Raman", "Marcus Oyelaran"]);
  });

  it("accepts a bracketed timestamp with no speaker label", () => {
    const t = parseTranscript("[00:01] Welcome everyone.\n[00:05] Let's begin.");
    expect(t.format).toBe("bracketed");
    expect(t.segments.map((s) => s.speaker)).toEqual(["Speaker", "Speaker"]);
    expect(t.segments[1].text).toBe("Let's begin.");
  });
});

describe("format: Fathom copy (0:03 - Name)", () => {
  const input = `0:03 - Lena Fischer
  Can everyone see my screen?

0:09 - Tomás Ibarra (Northwind)
  Yes. Go ahead.
  We have about thirty minutes.

1:04:10 - Lena Fischer
  Great, that's a wrap.`;

  it("detects the format", () => {
    const t = parseTranscript(input);
    expect(t.format).toBe("fathom");
    expect(t.timestampsEstimated).toBe(false);
    expect(t.segments).toHaveLength(3);
  });

  it("joins indented text lines under their header", () => {
    expect(parseTranscript(input).segments[1].text).toBe("Yes. Go ahead. We have about thirty minutes.");
  });

  it("drops the company suffix from the speaker name", () => {
    expect(parseTranscript(input).segments[1].speaker).toBe("Tomás Ibarra");
  });

  it("parses h:mm:ss", () => {
    expect(parseTranscript(input).segments[2].startMs).toBe((3600 + 4 * 60 + 10) * 1000);
  });

  it("accepts the @ prefix Fathom adds when copying with links", () => {
    const t = parseTranscript("@0:03 - Lena Fischer\nHello.\n@0:07 - Tomás Ibarra\nHi.");
    expect(t.format).toBe("fathom");
    expect(t.segments.map((s) => s.startMs)).toEqual([3000, 7000]);
  });
});

describe("format: WebVTT", () => {
  const input = `WEBVTT

NOTE exported by a meeting tool

1
00:00:03.000 --> 00:00:07.500
<v Priya Raman>Thanks for joining.

2
00:00:07.500 --> 00:00:12.000
Marcus Oyelaran: We can't hit March.
QA needs two more weeks.

00:00:12.000 --> 00:00:14.250
<v Priya Raman>Okay.</v>`;

  it("detects the format and uses cue start and end times", () => {
    const t = parseTranscript(input);
    expect(t.format).toBe("vtt");
    expect(t.timestampsEstimated).toBe(false);
    expect(t.segments[0]).toMatchObject({ startMs: 3000, endMs: 7500 });
    expect(t.segments[2]).toMatchObject({ startMs: 12000, endMs: 14250 });
  });

  it("reads speakers from <v> tags and from 'Name:' prefixes", () => {
    expect(parseTranscript(input).segments.map((s) => s.speaker)).toEqual(["Priya Raman", "Marcus Oyelaran", "Priya Raman"]);
  });

  it("strips tags, joins multi-line cues, and ignores NOTE blocks and cue ids", () => {
    const t = parseTranscript(input);
    expect(t.segments[1].text).toBe("We can't hit March. QA needs two more weeks.");
    expect(t.segments[2].text).toBe("Okay.");
    expect(t.segments.some((s) => /exported/.test(s.text))).toBe(false);
  });
});

describe("format: SRT", () => {
  const input = `1
00:00:03,000 --> 00:00:07,500
Priya Raman: Thanks for joining.

2
00:00:07,500 --> 00:00:12,000
We can't hit March.`;

  it("detects the format and parses comma milliseconds", () => {
    const t = parseTranscript(input);
    expect(t.format).toBe("srt");
    expect(t.segments[0]).toMatchObject({ speaker: "Priya Raman", startMs: 3000, endMs: 7500, text: "Thanks for joining." });
  });

  it("carries no speaker forward: an unlabelled cue is 'Speaker'", () => {
    expect(parseTranscript(input).segments[1].speaker).toBe("Speaker");
  });
});

describe("format: Speaker: text (no timestamps)", () => {
  const input = `Priya Raman: Thanks for joining. Let's start.
Marcus Oyelaran: We can't hit March third.
and I want that on the record.
Priya Raman: Noted.`;

  it("detects the format and marks timestamps as estimated", () => {
    const t = parseTranscript(input);
    expect(t.format).toBe("speaker");
    expect(t.timestampsEstimated).toBe(true);
    expect(t.segments).toHaveLength(3);
  });

  it("estimates offsets at 150 words per minute, back to back", () => {
    const [a, b, c] = parseTranscript(input).segments;
    expect(a.startMs).toBe(0);
    expect(a.endMs).toBe(5 * MS_PER_WORD); // "Thanks for joining. Let's start." is 5 words
    expect(b.startMs).toBe(a.endMs);
    expect(b.endMs).toBe(b.startMs + 12 * MS_PER_WORD);
    expect(c.startMs).toBe(b.endMs);
  });

  it("does not treat a URL or a time of day as a speaker label", () => {
    const t = parseTranscript("Priya: See https://example.com/a: it has the plan.\nMarcus: Let's meet at 10:30 tomorrow.\nPriya: Fine.");
    expect(t.speakers).toEqual(["Priya", "Marcus"]);
    expect(t.segments).toHaveLength(3);
  });
});

describe("fallback: plain text", () => {
  it("turns paragraphs into segments with estimated timestamps", () => {
    const t = parseTranscript("We talked about the launch. It is moving to the 17th.\n\nThen pricing came up.\nNobody agreed.");
    expect(t.format).toBe("plain");
    expect(t.timestampsEstimated).toBe(true);
    expect(t.segments.map((s) => s.text)).toEqual([
      "We talked about the launch. It is moving to the 17th.",
      "Then pricing came up. Nobody agreed.",
    ]);
    expect(t.segments.every((s) => s.speaker === "Speaker")).toBe(true);
    expect(t.speakers).toEqual(["Speaker"]);
  });

  it("does not mistake one 'Label: text' line in prose for a speaker transcript", () => {
    const t = parseTranscript("Agenda: launch date and pricing.\n\nWe talked for an hour and mostly agreed on the date.");
    expect(t.format).toBe("plain");
  });
});

describe("edge cases", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(() => parseTranscript("")).toThrow(TranscriptError);
    expect(() => parseTranscript("  \n\t\n ")).toThrow(TranscriptError);
  });

  it("rejects input that has structure but no words", () => {
    expect(() => parseTranscript("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\n")).toThrow(TranscriptError);
  });

  it("treats a malformed timestamp as text, not as a new segment", () => {
    const t = parseTranscript("[00:03] Priya: Hello.\n[0:99] this is not a time\n[ab:cd] neither is this\n[00:09] Marcus: Hi.");
    expect(t.format).toBe("bracketed");
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0].text).toBe("Hello. [0:99] this is not a time [ab:cd] neither is this");
  });

  it("never produces a segment that ends before it starts, even when timestamps go backwards", () => {
    const t = parseTranscript("[00:30] A: one two three\n[00:10] B: four five\n[00:40] A: six");
    for (const s of t.segments) expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
  });

  it("handles a single speaker", () => {
    const t = parseTranscript("[00:00] Eeman: First thought.\n[00:20] Eeman: Second thought.");
    expect(t.speakers).toEqual(["Eeman"]);
  });

  it("handles Windows line endings and a byte order mark", () => {
    const t = parseTranscript("﻿[00:03] Priya: Hello.\r\n[00:09] Marcus: Hi.\r\n");
    expect(t.segments.map((s) => s.text)).toEqual(["Hello.", "Hi."]);
  });

  it("reports a duration equal to the end of the last segment", () => {
    const t = parseTranscript("[00:03] Priya: Hello.\n[00:09] Marcus: Hi there friend.");
    expect(t.durationMs).toBe(9000 + 3 * MS_PER_WORD);
  });

  it("numbers segments from zero in order", () => {
    const t = parseTranscript("[00:03] Priya: Hello.\n[00:09] Marcus: Hi.");
    expect(t.segments.map((s) => s.idx)).toEqual([0, 1]);
  });
});
