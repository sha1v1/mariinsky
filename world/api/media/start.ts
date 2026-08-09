import { supabase } from "../../lib/supabase.ts";

const BUCKET = "contributions";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_AUDIO = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac"]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/3gpp"]);

function classify(mimeType: string): { inputType: "photo" | "voice" | "video"; maxBytes: number } | null {
  if (ALLOWED_IMAGE.has(mimeType)) return { inputType: "photo", maxBytes: MAX_IMAGE_BYTES };
  if (ALLOWED_AUDIO.has(mimeType)) return { inputType: "voice", maxBytes: MAX_AUDIO_BYTES };
  if (ALLOWED_VIDEO.has(mimeType)) return { inputType: "video", maxBytes: MAX_VIDEO_BYTES };
  return null;
}

function safeExtension(fileName: string, mimeType: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const subtype = mimeType.split("/")[1]?.replace(/^x-/, "").replace("quicktime", "mov").replace(/[^a-z0-9]/g, "");
  return subtype || "bin";
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 180) : "contribution";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType.toLowerCase() : "";
  const size = Number(body?.size);
  const media = classify(mimeType);
  if (!media || !Number.isFinite(size) || size <= 0 || size > media.maxBytes) {
    return Response.json({ error: "unsupported media type or file too large" }, { status: 400 });
  }

  const path = `${media.inputType}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${safeExtension(fileName, mimeType)}`;
  const { data: storageUpload, error: storageError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (storageError || !storageUpload) {
    console.error("[media/start] storage upload URL failed:", storageError);
    return Response.json({ error: "Media storage is not ready. Apply Supabase migration 006." }, { status: 503 });
  }
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return Response.json({
    inputType: media.inputType,
    storage: { signedUrl: storageUpload.signedUrl, path, publicUrl: publicData.publicUrl },
  });
}
