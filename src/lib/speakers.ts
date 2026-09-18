// Stable per-speaker colours. No red: red means "recording" and nothing else (SPEC.md section 3).
const PALETTE = ["#0F766E", "#7C3AED", "#B45309", "#0369A1", "#BE185D", "#4D7C0F", "#4338CA", "#0E7490"];

export function speakerColor(name: string, speakers: string[]): string {
  const i = speakers.indexOf(name);
  return PALETTE[(i === -1 ? 0 : i) % PALETTE.length];
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
