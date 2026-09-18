import { MS_PER_WORD, UNKNOWN_SPEAKER, countWords, type ParsedTranscript } from "@/lib/transcript/parse";

// Speech to text with Groq Whisper (SPEC.md section 2). Whisper does not diarize, so every segment is
// "Speaker": that limitation is stated in the UI and in the spec. There is no fallback provider; a failure
// leaves the meeting in "failed" with its audio kept, and paste remains available.

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Only our own Blob store. The URL comes from the browser, so without this check it would be an open fetch proxy. */
export function isOurBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function blobAuth(): Record<string, string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  return { Authorization: `Bearer ${token}` };
}

type WhisperResponse = { duration?: number; language?: string; text?: string; segments?: { start: number; end: number; text: string; no_speech_prob?: number }[]; error?: { message?: string } };

/**
 * On silence Whisper invents a polite phrase ("Thank you.") instead of returning nothing. Measured: a 30 second
 * silent recording came back as one segment, "Thank you.", and was then summarised as a meeting. Whisper also
 * reports how likely each segment is to contain no speech, so segments above this are dropped.
 */
const MAX_NO_SPEECH_PROB = 0.6;
// Checked against Groq: for that silent file it reported no_speech_prob = 0, so the probability alone does not
// catch it. The second test is density: a handful of words across a long recording is silence plus a guess.
const SILENCE_MAX_WORDS = 4;
const SILENCE_MIN_SECONDS = 15;

async function callWhisper(form: FormData): Promise<WhisperResponse> {
  form.set("model", MODEL);
  form.set("response_format", "verbose_json");
  const res = await fetch(GROQ_TRANSCRIBE, { method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form, signal: AbortSignal.timeout(110_000) });
  const data = (await res.json().catch(() => ({}))) as WhisperResponse;
  if (!res.ok) throw new Error(data.error?.message ?? `Transcription failed (HTTP ${res.status})`);
  return data;
}

export async function transcribeAudio(audioUrl: string): Promise<ParsedTranscript & { language: string | null }> {
  if (!isOurBlobUrl(audioUrl)) throw new Error("Audio must be uploaded through Meetscribe.");

  // The Blob store is private: a recording is never publicly readable, so Groq cannot be handed the URL.
  // The server reads it with the store token and sends Whisper the bytes (25 MB at most).
  const audio = await fetch(audioUrl, { headers: blobAuth(), signal: AbortSignal.timeout(60_000) });
  if (!audio.ok) throw new Error("The uploaded audio could not be read.");
  const blob = await audio.blob();
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Audio files are limited to 25 MB.");
  const form = new FormData();
  form.set("file", blob, decodeURIComponent(audioUrl.split("/").pop() ?? "audio.webm"));
  const data = await callWhisper(form);

  const used = new Set<number>();
  const segments = (data.segments ?? [])
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0 && (s.no_speech_prob ?? 0) <= MAX_NO_SPEECH_PROB)
    .map((s, idx) => {
      let startMs = Math.max(0, Math.round(s.start * 1000));
      while (used.has(startMs)) startMs += 1; // offsets identify a segment, same rule as the text parser
      used.add(startMs);
      return { idx, speaker: UNKNOWN_SPEAKER, startMs, endMs: Math.max(startMs, Math.round(s.end * 1000)), text: s.text };
    });
  const words = segments.reduce((n, seg) => n + countWords(seg.text), 0);
  const seconds = data.duration ?? (segments.length ? segments[segments.length - 1].endMs / 1000 : 0);
  if (segments.length === 0 || (words <= SILENCE_MAX_WORDS && seconds >= SILENCE_MIN_SECONDS)) {
    throw new Error("No speech was found in this recording. Check that the right microphone was selected.");
  }

  const last = segments[segments.length - 1];
  return {
    format: "plain",
    segments,
    speakers: [UNKNOWN_SPEAKER],
    durationMs: Math.max(Math.round((data.duration ?? 0) * 1000), last.endMs, last.startMs + countWords(last.text) * MS_PER_WORD),
    timestampsEstimated: false,
    language: data.language ?? null,
  };
}
