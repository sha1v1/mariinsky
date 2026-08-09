import { supabase } from "../../lib/supabase.ts";

const BUCKET = "contributions";
const MAX_BYTES: Record<string, number> = {
  image: 12 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};
const TYPE_TO_DIRECTORY: Record<string, string> = {
  image: "photo",
  audio: "voice",
  video: "video",
};

function validMedia(mimeType: string, size: number, storagePath: string): boolean {
  const family = mimeType.split("/")[0];
  const directory = TYPE_TO_DIRECTORY[family];
  const maximum = MAX_BYTES[family];
  if (!directory || !maximum || !Number.isFinite(size) || size <= 0 || size > maximum) return false;
  return new RegExp(`^${directory}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}\\.[a-z0-9]{1,5}$`).test(storagePath);
}

async function discard(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) console.warn("[media/analyze] failed to discard unusable upload:", error.message);
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const storagePath = typeof body?.storagePath === "string" ? body.storagePath : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType.toLowerCase() : "";
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 180) : "media contribution";
  const declaredSize = Number(body?.size);
  if (!validMedia(mimeType, declaredSize, storagePath)) {
    return Response.json({ error: "invalid media analysis request" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  // The browser has already sent the original directly to Supabase. Pull it
  // from the server and forward it to Gemini here: the browser never calls
  // Google's upload origin, and the function request remains a tiny JSON
  // body even for a large video.
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const sourceResponse = await fetch(publicUrl);
  if (!sourceResponse.ok) {
    console.error("[media/analyze] could not read stored original:", sourceResponse.status);
    return Response.json({ error: "The uploaded media could not be read." }, { status: 502 });
  }
  const bytes = await sourceResponse.arrayBuffer();
  const family = mimeType.split("/")[0];
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES[family]) {
    await discard(storagePath);
    return Response.json({ error: "The uploaded media has an invalid size." }, { status: 400 });
  }

  const startResponse = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: fileName } }),
  });
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!startResponse.ok || !uploadUrl) {
    console.error("[media/analyze] Gemini upload initiation failed:", startResponse.status, await startResponse.text());
    await discard(storagePath);
    return Response.json({ error: "Could not prepare the media for interpretation." }, { status: 502 });
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  const result = await uploadResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!uploadResponse.ok || !result?.file) {
    console.error("[media/analyze] Gemini upload failed:", uploadResponse.status, result);
    await discard(storagePath);
    return Response.json({ error: "The media could not be interpreted." }, { status: 502 });
  }

  return Response.json(result);
}
