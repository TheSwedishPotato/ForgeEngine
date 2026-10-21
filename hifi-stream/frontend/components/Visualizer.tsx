"use client";

import { useEffect, useRef } from "react";

const BARS = 40;

/** Log-spaced spectrum bars drawn from the Web Audio analyser. */
export function Visualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!analyser || !canvas || !g) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const color = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#7cf2c4";
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const { width, height } = canvas;
      g.clearRect(0, 0, width, height);
      g.fillStyle = color;
      const w = width / BARS;
      for (let i = 0; i < BARS; i++) {
        const from = Math.floor(Math.pow(data.length, i / BARS));
        const to = Math.max(from + 1, Math.floor(Math.pow(data.length, (i + 1) / BARS)));
        let peak = 0;
        for (let j = from; j < to && j < data.length; j++) peak = Math.max(peak, data[j]);
        const h = Math.max(1, (peak / 255) * height);
        g.fillRect(i * w + 1, height - h, w - 2, h);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return <canvas ref={ref} className="viz" width={200} height={40} aria-hidden />;
}
