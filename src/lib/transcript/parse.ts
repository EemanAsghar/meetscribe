// Pure transcript parser. No I/O, no dependencies: it runs on the server at ingest and in the
// browser for the live "detected format" preview on the New meeting page.
//
// Formats, in order of specificity (SPEC.md section 8):
//   vtt        WEBVTT cues
//   srt        numbered cues with comma milliseconds
//   fathom     "0:03 - Name" header lines followed by text lines
//   bracketed  "[00:03] Speaker: text"
//   speaker    "Speaker: text", no timestamps  -> estimated offsets
//   plain      paragraphs                      -> estimated offsets

export type TranscriptFormat = "vtt" | "srt" | "fathom" | "bracketed" | "speaker" | "plain";

export type ParsedSegment = {
  idx: number;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type ParsedTranscript = {
  format: TranscriptFormat;
  segments: ParsedSegment[];
  speakers: string[];
  durationMs: number;
  /** True when the source had no timestamps and offsets were synthesized from word count. */
  timestampsEstimated: boolean;
};

export class TranscriptError extends Error {}

export const UNKNOWN_SPEAKER = "Speaker";
/** 150 words per minute. */
export const MS_PER_WORD = 400;

type Draft = { speaker: string; startMs: number | null; endMs: number | null; lines: string[] };

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ------------------------------------------------------------------ timestamps

/** "1:02:45" | "02:45" | "2:45.500" | "00:00:03,000" -> ms. Null when it is not a valid clock time. */
function parseClock(raw: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] !== undefined && min > 59)) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

// -------------------------------------------------------------- speaker labels

/**
 * Splits "Name: text". Conservative on purpose, because prose is full of colons:
 * a label is short, starts with a letter, has no sentence punctuation or slashes (URLs),
 * and the colon must be followed by whitespace (so "10:30" and "https://" never match).
 */
function splitSpeaker(line: string): { speaker: string; text: string } | null {
  const m = /^([^:]{1,40}):\s+(.*)$/.exec(line) ?? /^([^:]{1,40}):$/.exec(line);
  if (!m) return null;
  const label = m[1].trim();
  if (!/^\p{L}/u.test(label)) return null;
  if (/[.!?,;/\\[\]"]/.test(label)) return null;
  if (label.split(/\s+/).length > 4) return null;
  return { speaker: cleanSpeaker(label), text: (m[2] ?? "").trim() };
}

/** "Tomás Ibarra (Northwind)" -> "Tomás Ibarra" */
function cleanSpeaker(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || UNKNOWN_SPEAKER;
}

// --------------------------------------------------------------------- formats

const CUE_TIMING = /^(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s+-->\s+(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/;
const FATHOM_HEADER = /^@?(\d{1,2}:\d{2}(?::\d{2})?)\s+[-–—]\s+(\S.*)$/;
const BRACKETED = /^[[(](\d{1,2}:\d{2}(?::\d{2})?)[\])]\s*(.*)$/;

function parseCues(lines: string[]): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let skippingNote = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      current = null;
      skippingNote = false;
      continue;
    }
    if (skippingNote) continue;
    const timing = CUE_TIMING.exec(trimmed);
    if (timing) {
      current = { speaker: UNKNOWN_SPEAKER, startMs: parseClock(timing[1]), endMs: parseClock(timing[2]), lines: [] };
      drafts.push(current);
      continue;
    }
    if (!current) {
      // Between cues: header, NOTE/STYLE blocks, or a cue identifier. None of it is speech.
      if (/^(NOTE|STYLE|REGION)\b/.test(trimmed)) skippingNote = true;
      continue;
    }
    let text = trimmed;
    const voice = /^<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(text);
    if (voice) {
      current.speaker = cleanSpeaker(voice[1]);
    } else if (current.lines.length === 0) {
      const labelled = splitSpeaker(text);
      if (labelled) {
        current.speaker = labelled.speaker;
        text = labelled.text;
      }
    }
    text = text.replace(/<[^>]+>/g, "").trim();
    if (text) current.lines.push(text);
  }
  return drafts;
}

function parseFathom(lines: string[]): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = FATHOM_HEADER.exec(trimmed);
    const startMs = header ? parseClock(header[1]) : null;
    if (header && startMs !== null) {
      current = { speaker: cleanSpeaker(header[2]), startMs, endMs: null, lines: [] };
      drafts.push(current);
    } else if (current) {
      current.lines.push(trimmed);
    }
  }
  return drafts;
}

function parseBracketed(lines: string[]): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = BRACKETED.exec(trimmed);
    const startMs = m ? parseClock(m[1]) : null;
    if (m && startMs !== null) {
      const labelled = splitSpeaker(m[2]);
      current = {
        speaker: labelled?.speaker ?? UNKNOWN_SPEAKER,
        startMs,
        endMs: null,
        lines: [labelled ? labelled.text : m[2].trim()].filter(Boolean),
      };
      drafts.push(current);
    } else if (current) {
      // Includes lines with a malformed timestamp: they stay as text instead of starting a bogus segment.
      current.lines.push(trimmed);
    }
  }
  return drafts;
}

function parseSpeakerLines(lines: string[]): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const labelled = splitSpeaker(trimmed);
    if (labelled) {
      current = { speaker: labelled.speaker, startMs: null, endMs: null, lines: [labelled.text].filter(Boolean) };
      drafts.push(current);
    } else if (current) {
      current.lines.push(trimmed);
    } else {
      current = { speaker: UNKNOWN_SPEAKER, startMs: null, endMs: null, lines: [trimmed] };
      drafts.push(current);
    }
  }
  return drafts;
}

function parsePlain(text: string): Draft[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length > 0)
    .map((lines) => ({ speaker: UNKNOWN_SPEAKER, startMs: null, endMs: null, lines }));
}

// ------------------------------------------------------------------- detection

function detect(lines: string[]): TranscriptFormat {
  const nonBlank = lines.map((l) => l.trim()).filter(Boolean);
  if (nonBlank.length === 0) return "plain";

  if (/^WEBVTT\b/.test(nonBlank[0])) return "vtt";
  const timingLines = nonBlank.filter((l) => CUE_TIMING.test(l));
  if (timingLines.length > 0) return timingLines.some((l) => /\d,\d{1,3}\s+-->/.test(l)) ? "srt" : "vtt";

  const valid = (re: RegExp) => nonBlank.filter((l) => { const m = re.exec(l); return m !== null && parseClock(m[1]) !== null; }).length;
  const fathom = valid(FATHOM_HEADER);
  const bracketed = valid(BRACKETED);
  if (fathom > 0 && fathom >= bracketed) return "fathom";
  if (bracketed > 0) return "bracketed";

  // One "Agenda: ..." line in a page of prose is not a speaker transcript.
  const labelled = nonBlank.filter((l) => splitSpeaker(l) !== null).length;
  if (labelled >= 2 && labelled / nonBlank.length >= 0.3) return "speaker";
  return "plain";
}

// ------------------------------------------------------------------------ main

export function parseTranscript(input: string): ParsedTranscript {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new TranscriptError("The transcript is empty.");

  const lines = text.split("\n");
  const format = detect(lines);
  const drafts =
    format === "vtt" || format === "srt" ? parseCues(lines)
    : format === "fathom" ? parseFathom(lines)
    : format === "bracketed" ? parseBracketed(lines)
    : format === "speaker" ? parseSpeakerLines(lines)
    : parsePlain(text);

  const spoken = drafts
    .map((d) => ({ ...d, text: d.lines.join(" ").replace(/\s+/g, " ").trim() }))
    .filter((d) => d.text.length > 0);
  if (spoken.length === 0) throw new TranscriptError("No spoken text was found in the transcript.");

  const timestampsEstimated = format === "speaker" || format === "plain";
  const segments: ParsedSegment[] = [];
  let cursor = 0;

  spoken.forEach((d, idx) => {
    const estimated = countWords(d.text) * MS_PER_WORD;
    const startMs = timestampsEstimated ? cursor : (d.startMs ?? cursor);
    let endMs: number;
    if (timestampsEstimated) {
      endMs = startMs + estimated;
    } else if (d.endMs !== null) {
      endMs = d.endMs;
    } else {
      const next = spoken[idx + 1]?.startMs ?? null;
      endMs = next !== null && next >= startMs ? next : startMs + estimated;
    }
    endMs = Math.max(endMs, startMs);
    cursor = endMs;
    segments.push({ idx, speaker: d.speaker, startMs, endMs, text: d.text });
  });

  return {
    format,
    segments,
    speakers: [...new Set(segments.map((s) => s.speaker))],
    durationMs: Math.max(...segments.map((s) => s.endMs)),
    timestampsEstimated,
  };
}

export const FORMAT_LABELS: Record<TranscriptFormat, string> = {
  vtt: "WebVTT captions",
  srt: "SRT captions",
  fathom: "Fathom transcript",
  bracketed: "Timestamped transcript",
  speaker: "Speaker-labelled text",
  plain: "Plain text",
};
