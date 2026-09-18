import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { MAX_AUDIO_BYTES } from "@/lib/transcribe";

/**
 * Issues a short-lived client token so the browser uploads audio straight to Vercel Blob. Audio never passes
 * through a route handler: Vercel caps request bodies near 4.5 MB (SPEC.md section 3).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      // Explicit, so the SDK does not try OIDC (which `vercel link` configures locally but this project does not use).
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => {
        if (!(await getCurrentUser())) throw new Error("Not signed in");
        return { allowedContentTypes: ["audio/*", "video/webm", "video/mp4"], maximumSizeInBytes: MAX_AUDIO_BYTES, addRandomSuffix: true };
      },
      // Not relied on: the browser tells /api/meetings when the upload is done. (This callback cannot reach localhost.)
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload not allowed" }, { status: 400 });
  }
}
