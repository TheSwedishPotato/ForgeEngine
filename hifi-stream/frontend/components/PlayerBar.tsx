"use client";

import Link from "next/link";
import { formatQuality, formatRate, formatTime } from "@/core/api";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./Icons";
import { usePlayer } from "./PlayerProvider";
import { Visualizer } from "./Visualizer";

export function PlayerBar() {
  const p = usePlayer();
  const t = p.current;
  if (!t) return null;
  const pct = (seconds: number) => (p.duration > 0 ? `${Math.min(100, (seconds / p.duration) * 100)}%` : "0%");
  const resampled = p.outputRate !== null && p.outputRate !== t.sampleRate;

  return (
    <div className="player" role="region" aria-label="Player">
      <div className="player-track">
        <div className="player-title">{t.title}</div>
        <Link href={`/artists/${t.artistId}`} className="muted">
          {t.artistName}
        </Link>
        <div className="badges">
          <span className="badge hires">
            {t.codec.toUpperCase()} · {formatQuality(t)}
          </span>
          {p.outputRate !== null && (
            <span
              className="badge"
              title={
                resampled
                  ? "Browsers mix all audio at the output device's rate, so the master is resampled. Match your device's rate in OS settings for a bit-transparent path."
                  : "Output rate matches the master."
              }
            >
              out {formatRate(p.outputRate)} kHz
            </span>
          )}
        </div>
      </div>

      <div className="player-main">
        <div className="controls">
          <button className="icon" onClick={p.prev} aria-label="Previous track">
            <PrevIcon />
          </button>
          <button className="icon play" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"}>
            {p.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="icon" onClick={p.next} aria-label="Next track">
            <NextIcon />
          </button>
          {p.loading && <span className="muted small">buffering…</span>}
        </div>
        <div className="seek">
          <span className="time">{formatTime(p.position)}</span>
          <div className="seek-track">
            {p.buffered.map(([start, end], i) => (
              <div key={i} className="seek-buffered" style={{ left: pct(start), width: pct(end - start) }} />
            ))}
            <div className="seek-played" style={{ width: pct(p.position) }} />
            <input
              type="range"
              min={0}
              max={p.duration || 0}
              step={0.1}
              value={Math.min(p.position, p.duration || 0)}
              onChange={(e) => p.seek(Number(e.target.value))}
              aria-label="Seek"
            />
          </div>
          <span className="time">{formatTime(p.duration)}</span>
        </div>
        {p.error && <div className="error small">{p.error}</div>}
      </div>

      <Visualizer analyser={p.analyser} />
    </div>
  );
}
