// Step 3.1 — Submit UI. A textarea + submit button that POSTs to
// /api/submit. Deliberately dumb about what comes back: it hands the raw
// inserted row straight to World.tsx's onSubmitted callback and lets the
// parent decide how to fold it into local state / fly the camera there —
// this component only owns the form's own text/loading/error state.

import { useState, type FormEvent } from "react";

const MAX_LEN = 500;

export interface SubmitPanelProps {
  onSubmitted: (row: Record<string, unknown>) => void;
}

export default function SubmitPanel({ onSubmitted }: SubmitPanelProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setFlagged(false);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input_type: "text", raw_text: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong.");
        return;
      }
      if (data?.flagged) {
        setFlagged(true);
        return;
      }

      setText("");
      onSubmitted(data);
    } catch (err) {
      console.error("[SubmitPanel] submit failed:", err);
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const remaining = MAX_LEN - text.length;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        width: "min(560px, calc(100vw - 32px))",
        background: "rgba(20, 20, 20, 0.85)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: 12,
        backdropFilter: "blur(6px)",
        fontFamily: "sans-serif",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
        placeholder="Share a memory — it becomes an object in the world..."
        disabled={loading}
        rows={2}
        style={{
          width: "100%",
          resize: "none",
          background: "transparent",
          color: "#eee",
          border: "none",
          outline: "none",
          fontSize: 14,
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 11, color: remaining < 40 ? "#e88" : "#888" }}>{remaining}</span>
        <button
          type="submit"
          disabled={loading || !text.trim()}
          style={{
            background: loading || !text.trim() ? "#3a3a3a" : "#4a7dff",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 16px",
            fontSize: 13,
            cursor: loading || !text.trim() ? "default" : "pointer",
          }}
        >
          {loading ? "Placing…" : "Add to the world"}
        </button>
      </div>
      {error && <div style={{ color: "#e88", fontSize: 12, marginTop: 6 }}>{error}</div>}
      {flagged && (
        <div style={{ color: "#cc8", fontSize: 12, marginTop: 6 }}>
          That couldn't be placed — try rephrasing it.
        </div>
      )}
    </form>
  );
}
