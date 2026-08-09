import { useEffect, useRef, useState, type FormEvent } from "react";

const MAX_LEN = 500;
const POLL_INTERVAL_MS = 1800;
const POLL_ATTEMPTS = 50;

type InputMode = "text" | "photo" | "video" | "voice";

const MODE_CONFIG: Record<Exclude<InputMode, "text">, {
  label: string;
  accept: string;
  hint: string;
  maxBytes: number;
}> = {
  photo: {
    label: "Image",
    accept: "image/jpeg,image/png,image/webp,image/heic,image/heif",
    hint: "JPG, PNG, WebP, HEIC · up to 12 MB",
    maxBytes: 12 * 1024 * 1024,
  },
  video: {
    label: "Video",
    accept: "video/mp4,video/mpeg,video/quicktime,video/webm,video/3gpp",
    hint: "MP4, MOV, WebM · up to 100 MB",
    maxBytes: 100 * 1024 * 1024,
  },
  voice: {
    label: "Audio",
    accept: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/flac",
    hint: "MP3, WAV, M4A, OGG · up to 50 MB",
    maxBytes: 50 * 1024 * 1024,
  },
};

interface UploadStart {
  inputType: Exclude<InputMode, "text">;
  storage: { signedUrl: string; path: string; publicUrl: string };
}

interface GeminiFile {
  name: string;
  uri: string;
  mimeType?: string;
  state?: string;
}

export interface SubmitPanelProps {
  onSubmitted: (row: Record<string, unknown>) => void;
}

async function responseData(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

async function waitForGeminiFile(file: GeminiFile): Promise<GeminiFile> {
  if (file.state === "ACTIVE" || !file.state) return file;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    if (file.state === "FAILED") throw new Error("This media file could not be processed.");
    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    const response = await fetch(`/api/media/status?name=${encodeURIComponent(file.name)}`);
    const data = await responseData(response);
    if (!response.ok) throw new Error(errorMessage(data, "Could not check the media file."));
    file = data as unknown as GeminiFile;
    if (file.state === "ACTIVE") return file;
  }
  throw new Error("The media is taking too long to process. Please try again.");
}

export default function SubmitPanel({ onSubmitted }: SubmitPanelProps) {
  const [mode, setMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectMode(nextMode: InputMode) {
    if (loading) return;
    setMode(nextMode);
    setFile(null);
    setText("");
    setError(null);
    setFlagged(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function selectFile(nextFile: File | null) {
    setError(null);
    setFlagged(false);
    if (!nextFile || mode === "text") {
      setFile(null);
      return;
    }
    const config = MODE_CONFIG[mode];
    if (!config.accept.split(",").includes(nextFile.type.toLowerCase())) {
      setFile(null);
      setError(`Choose a supported ${config.label.toLowerCase()} file.`);
      return;
    }
    if (nextFile.size > config.maxBytes) {
      setFile(null);
      setError(`${config.label} must be smaller than ${Math.round(config.maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    setFile(nextFile);
  }

  async function submitText(trimmed: string): Promise<Response> {
    setStatus("Finding its form…");
    return fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input_type: "text", raw_text: trimmed }),
    });
  }

  async function submitMedia(trimmed: string, selectedFile: File): Promise<Response> {
    setStatus("Preparing upload…");
    const startResponse = await fetch("/api/media/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        size: selectedFile.size,
      }),
    });
    const startData = await responseData(startResponse);
    if (!startResponse.ok) throw new Error(errorMessage(startData, "Could not prepare the media upload."));
    const upload = startData as unknown as UploadStart;

    setStatus("Uploading media…");
    const storageBody = new FormData();
    storageBody.append("cacheControl", "3600");
    storageBody.append("", selectedFile);
    let storageResponse: Response;
    try {
      storageResponse = await fetch(upload.storage.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: storageBody,
      });
    } catch {
      throw new Error("Could not upload to media storage. Check the Supabase contributions bucket.");
    }
    if (!storageResponse.ok) throw new Error("The original media could not be saved.");

    setStatus("Preparing interpretation…");
    const analysisResponse = await fetch("/api/media/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storagePath: upload.storage.path,
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        size: selectedFile.size,
      }),
    });
    const geminiData = await responseData(analysisResponse);
    if (!analysisResponse.ok) throw new Error(errorMessage(geminiData, "The media could not be read."));
    let geminiFile = geminiData.file as GeminiFile | undefined;
    if (!geminiFile?.name || !geminiFile.uri) throw new Error("The media upload did not finish correctly.");

    if (geminiFile.state && geminiFile.state !== "ACTIVE") {
      setStatus(mode === "video" ? "Processing video…" : "Processing media…");
      geminiFile = await waitForGeminiFile(geminiFile);
    }

    setStatus("Finding its form…");
    return fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input_type: upload.inputType,
        raw_text: trimmed,
        media: {
          file_uri: geminiFile.uri,
          gemini_file_name: geminiFile.name,
          mime_type: selectedFile.type,
          original_name: selectedFile.name,
          storage_path: upload.storage.path,
          size: selectedFile.size,
        },
      }),
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (loading || (mode === "text" ? !trimmed : !file)) return;

    setLoading(true);
    setError(null);
    setFlagged(false);

    try {
      const response = mode === "text" ? await submitText(trimmed) : await submitMedia(trimmed, file!);
      const data = await responseData(response);
      if (!response.ok) {
        setError(errorMessage(data, "Something went wrong."));
        return;
      }
      if (data.flagged) {
        setFlagged(true);
        return;
      }

      setText("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      onSubmitted(data);
    } catch (err) {
      console.error("[SubmitPanel] submit failed:", err);
      setError(err instanceof Error ? err.message : "Couldn't reach the server.");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  const remaining = MAX_LEN - text.length;
  const canSubmit = !loading && (mode === "text" ? Boolean(text.trim()) : Boolean(file));

  return (
    <form onSubmit={handleSubmit} className={`submit-panel submit-panel-${mode}`}>
      <div className="submit-panel-topline">
        <div className="submit-panel-heading">Leave something here</div>
        <div className="submit-modes" role="tablist" aria-label="Contribution type">
          {(["text", "photo", "video", "voice"] as InputMode[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={mode === item ? "active" : ""}
              disabled={loading}
              onClick={() => selectMode(item)}
            >
              {item === "text" ? "Write" : MODE_CONFIG[item].label}
            </button>
          ))}
        </div>
      </div>

      {mode !== "text" && (
        <div className="media-input">
          <input
            ref={fileInput}
            id="memory-media-file"
            type="file"
            accept={MODE_CONFIG[mode].accept}
            disabled={loading}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
          {!file ? (
            <label htmlFor="memory-media-file" className="media-picker">
              <span>Choose {MODE_CONFIG[mode].label.toLowerCase()}</span>
              <small>{MODE_CONFIG[mode].hint}</small>
            </label>
          ) : (
            <div className="media-preview">
              {mode === "photo" && previewUrl && <img src={previewUrl} alt="Selected contribution" />}
              {mode === "video" && previewUrl && <video src={previewUrl} muted playsInline />}
              {mode === "voice" && previewUrl && <audio src={previewUrl} controls />}
              <div className="media-preview-copy">
                <strong>{file.name}</strong>
                <span>{(file.size / 1024 / 1024).toFixed(file.size < 1024 * 1024 ? 2 : 1)} MB</span>
              </div>
              <label htmlFor="memory-media-file" className="media-change">Change</label>
            </div>
          )}
        </div>
      )}

      <div className="submit-copy-row">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_LEN))}
          placeholder={mode === "text"
            ? "A sound from the kitchen, a toy by the window, the long walk home…"
            : "Add a caption or context (optional)…"}
          disabled={loading}
          rows={mode === "text" ? 2 : 1}
        />
        <span className="submit-remaining">{remaining}</span>
      </div>
      <div className="submit-actions">
        <span className="submit-note">{status ?? (mode === "text"
          ? "AI interprets it · the world gives it form"
          : "The media is interpreted as evidence, not as a souvenir")}</span>
        <button type="submit" disabled={!canSubmit}>
          {status ?? "Place contribution"}
        </button>
      </div>
      {error && <div className="submit-message error">{error}</div>}
      {flagged && <div className="submit-message">That couldn't be placed — try another contribution.</div>}
    </form>
  );
}
