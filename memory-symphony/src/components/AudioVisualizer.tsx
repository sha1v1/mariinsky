import { useEffect, useRef } from "react";
import type { AudioEngine } from "../audio/AudioEngine";

interface AudioVisualizerProps {
  engine: AudioEngine;
  isActive: boolean;
}

/** Draws a simple frequency-bar visualization from the engine's Tone.Analyser("fft") data. */
export default function AudioVisualizer({ engine, isActive }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const data = engine.getFrequencyData();
      const barCount = data.length;
      const barWidth = width / barCount;

      for (let i = 0; i < barCount; i++) {
        const db = data[i] as number;
        const normalized = Math.max(0, Math.min(1, (db + 100) / 100));
        const barHeight = normalized * height;
        const hue = 260 - normalized * 140;
        ctx.fillStyle = `hsl(${hue}, 80%, ${isActive ? 60 : 30}%)`;
        ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 2), barHeight);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [engine, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={160}
      className="w-full h-40 rounded-lg bg-slate-900/60 border border-slate-800"
    />
  );
}
