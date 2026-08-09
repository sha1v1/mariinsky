import { useState } from "react";

interface MemoryInputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export default function MemoryInput({ onSubmit, disabled }: MemoryInputProps) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe a memory..."
        rows={3}
        className="w-full rounded-lg bg-slate-900 border border-slate-700 p-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !text.trim()}
        className="self-start rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-2 font-medium text-white transition-colors"
      >
        Create Soundscape
      </button>
    </div>
  );
}
