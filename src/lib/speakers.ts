// Stable per-speaker colours. No red: red means "recording" and nothing else (SPEC.md section 3).
// Light tints: they are used as text on a dark surface and as avatar fills with dark initials.
const PALETTE = ["#5eead4", "#c4b5fd", "#fcd34d", "#7dd3fc", "#f9a8d4", "#bef264", "#a5b4fc", "#fdba74"];

export function speakerColor(name: string, speakers: string[]): string {
  const i = speakers.indexOf(name);
  return PALETTE[(i === -1 ? 0 : i) % PALETTE.length];
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
