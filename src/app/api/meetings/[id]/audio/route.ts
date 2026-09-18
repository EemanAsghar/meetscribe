import { ownedMeeting } from "@/lib/api";
import { blobAuth, isOurBlobUrl } from "@/lib/transcribe";

/**
 * Streams a meeting's recording to its owner. The Blob store is private, so the browser cannot load the audio
 * directly; this route adds the store token server-side and passes Range through, which is what makes seeking work.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedMeeting((await params).id);
  if ("error" in found) return found.error;
  const { audioUrl } = found.meeting;
  if (!audioUrl || !isOurBlobUrl(audioUrl)) return Response.json({ error: "This meeting has no recording." }, { status: 404 });

  const range = request.headers.get("range");
  const upstream = await fetch(audioUrl, { headers: { ...blobAuth(), ...(range ? { Range: range } : {}) } });
  if (!upstream.ok && upstream.status !== 206) return Response.json({ error: "The recording could not be read." }, { status: 502 });

  const headers = new Headers({ "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" });
  for (const name of ["content-type", "content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
