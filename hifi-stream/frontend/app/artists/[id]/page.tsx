"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TrackList } from "@/components/TrackList";
import { api, formatMoney, type ArtistPageData } from "@/core/api";
import { useAuth } from "@/core/auth";

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const { me, config, refresh } = useAuth();
  const [data, setData] = useState<ArtistPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => api<ArtistPageData>(`/api/artists/${id}`).then(setData, (e: Error) => setError(e.message)),
    [id],
  );
  const signedInAs = me?.id;
  useEffect(() => {
    load();
  }, [load, signedInAs]);

  async function subscribe() {
    setBusy(true);
    try {
      await api(`/api/billing/dev/artists/${id}/subscribe`, { method: "POST" });
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not subscribe");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const { artist, tracks, subscribed } = data;
  const isOwner = me?.artist?.id === artist.id;

  return (
    <>
      <section className="artist-header">
        <div className="avatar" aria-hidden>
          {artist.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="artist-info">
          <h1>{artist.name}</h1>
          {artist.bio && <p className="muted">{artist.bio}</p>}
          <p className="muted small">
            {artist.subscribers} direct {artist.subscribers === 1 ? "subscriber" : "subscribers"}
          </p>
        </div>
        <div className="artist-cta">
          {isOwner ? (
            <Link href="/studio" className="button secondary">
              Open studio
            </Link>
          ) : subscribed ? (
            <span className="badge hires">Subscribed</span>
          ) : me ? (
            <button className="button" disabled={busy || !config?.devBilling} onClick={subscribe}>
              Subscribe · {formatMoney(artist.monthlyPriceCents)}/mo
            </button>
          ) : (
            <Link href="/login" className="button">
              Sign in to subscribe
            </Link>
          )}
          {config && !isOwner && (
            <span className="muted small">{100 - config.directFeeBps / 100}% goes straight to the artist</span>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      <TrackList tracks={tracks} showArtist={false} />
    </>
  );
}
