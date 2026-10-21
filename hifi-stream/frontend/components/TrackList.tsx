"use client";

import Link from "next/link";
import { formatQuality, formatTime, type Track } from "@/core/api";
import { PauseIcon, PlayIcon } from "./Icons";
import { usePlayer } from "./PlayerProvider";

export function TrackList({ tracks, showArtist = true }: { tracks: Track[]; showArtist?: boolean }) {
  const p = usePlayer();
  if (tracks.length === 0) return <p className="muted">No tracks yet.</p>;

  return (
    <ol className="tracks">
      {tracks.map((t) => {
        const active = p.current?.id === t.id;
        return (
          <li key={t.id} className={active ? "track active" : "track"}>
            <button
              className="icon play"
              onClick={() => p.play(t, tracks)}
              aria-label={active && p.playing ? `Pause ${t.title}` : `Play ${t.title}`}
            >
              {active && p.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="track-meta">
              <div className="track-title">
                {t.title}
                {t.subscriberOnly && <span className="badge sub">Subscribers</span>}
              </div>
              {showArtist && (
                <Link href={`/artists/${t.artistId}`} className="muted">
                  {t.artistName}
                </Link>
              )}
            </div>
            <span className="badge hires">
              {t.codec.toUpperCase()} · {formatQuality(t)}
            </span>
            <span className="muted time">{formatTime(t.durationMs / 1000)}</span>
          </li>
        );
      })}
    </ol>
  );
}
