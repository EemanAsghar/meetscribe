// Citation handling for Ask Meetscribe. Pure functions, shared by the server (validation) and tested directly.

export const NOT_FOUND = "I couldn't find that in your meetings.";

/** [1], [1, 2], [12] ... but not [laughs]. */
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Drops every citation that does not point at a retrieved source, so a number in the answer can never
 * lead nowhere. `grounded` is false when the text makes claims and no citation survived.
 */
export function validateAnswer(text: string, sourceCount: number): { text: string; cited: number[]; removed: number; grounded: boolean } {
  const cited = new Set<number>();
  let removed = 0;
  const cleaned = text
    .replace(CITATION, (_match, group: string) => {
      const numbers = group.split(",").map((n) => Number(n.trim()));
      const valid = numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount);
      removed += numbers.length - valid.length;
      valid.forEach((n) => cited.add(n));
      return valid.map((n) => `[${n}]`).join("");
    })
    // Models repeat themselves: "[3][3]" or "[3][9][3]" within one run of markers becomes "[3][9]".
    .replace(/(?:\[\d+\]){2,}/g, (run) => [...new Set(run.match(/\[\d+\]/g))].join(""))
    // A removed citation leaves "word ." or "word ,": close the gap.
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");

  const isNotFound = cleaned.trim().startsWith(NOT_FOUND.slice(0, 24));
  return { text: cleaned, cited: [...cited].sort((a, b) => a - b), removed, grounded: cited.size > 0 || isNotFound };
}

const STOP = new Set("the a an and or but so of to in on at for with by from is are was were be been it its this that these those they them their we our you your i he she his her as not no do does did have has had will would can could should about into than then there here just like yeah okay um uh".split(" "));

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** An answer says "25 euros"; the speaker said "twenty five euro". Digits become the words a person would say. */
function spoken(word: string): string[] {
  if (!/^\d{1,2}$/.test(word)) return [word];
  const n = Number(word);
  return n < 20 ? [ONES[n]] : n % 10 === 0 ? [TENS[n / 10]] : [TENS[Math.floor(n / 10)], ONES[n % 10]];
}

/** Crude on purpose: enough to make "euros" meet "euro" and "buttons" meet "button". */
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

const tokens = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
    .flatMap(spoken)
    .map(singular)
    .filter((w) => w.length > 1 && !STOP.has(w));

export type CitedSegment = { idx: number; speaker: string; startMs: number; text: string };

/**
 * A source is a 150 to 250 word chunk, but a citation should open the exact line. Picks the segment of the
 * chunk that shares the most meaningful words with the sentence being cited. No model call.
 */
export function bestSegment<T extends CitedSegment>(sentence: string, segments: T[]): T | null {
  if (segments.length === 0) return null;
  const wanted = new Set(tokens(sentence));
  const substantive = segments.filter((s) => tokens(s.text).length >= 2);
  const pool = substantive.length ? substantive : segments;
  let best = pool[0];
  let bestScore = 0;
  for (const segment of pool) {
    const words = new Set(tokens(segment.text));
    let overlap = 0;
    for (const w of words) if (wanted.has(w)) overlap++;
    // Normalised a little so a long rambling line does not win on length alone.
    const score = overlap / Math.sqrt(words.size || 1);
    if (score > bestScore) {
      best = segment;
      bestScore = score;
    }
  }
  return best;
}

/** The sentence (or bullet line) that contains a citation marker, for bestSegment(). */
export function sentenceAround(text: string, markerIndex: number): string {
  const before = text.slice(0, markerIndex);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("? "), before.lastIndexOf("! ")) + 1;
  return text.slice(start, markerIndex).replace(CITATION, "").trim();
}
