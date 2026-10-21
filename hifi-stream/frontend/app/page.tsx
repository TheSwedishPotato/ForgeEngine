"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrackList } from "@/components/TrackList";
import { api, formatMoney, type Track } from "@/core/api";
import { useAuth } from "@/core/auth";

export default function Discover() {
  const { me, config, refresh } = useAuth();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(
      () =>
        api<{ tracks: Track[] }>(`/api/tracks?q=${encodeURIComponent(query)}`).then(
          (r) => !stale && (setTracks(r.tracks), setError(null)),
          (e: Error) => !stale && setError(e.message),
        ),
      query ? 250 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function startMembership() {
    setBusy(true);
    try {
      await api("/api/billing/dev/membership", { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start membership");
    } finally {
      setBusy(false);
    }
  }

  const artistShare = config ? 100 - config.membershipFeeBps / 100 : null;

  return (
    <>
      <section className="hero">
        <h1>Studio masters, streamed.</h1>
        <p>
          Lossless FLAC at up to 24-bit / 192 kHz, streamed in byte ranges so playback starts instantly and seeks
          land immediately. {artistShare !== null && `${artistShare}% of`} your membership is split only between the
          artists you actually play.
        </p>
        {!me ? (
          <Link className="button" href="/register">
            Create an account
          </Link>
        ) : (
          !me.membershipActive &&
          config && (
            <div className="cta">
              <button className="button" disabled={busy || !config.devBilling} onClick={startMembership}>
                Start membership · {formatMoney(config.membershipPriceCents)}/mo
              </button>
              <span className="muted small">
                {config.devBilling ? "Dev billing: no card is charged." : "Payments are not connected yet."}
              </span>
            </div>
          )
        )}
      </section>

      <div className="toolbar">
        <h2>New releases</h2>
        <input
          className="search"
          type="search"
          placeholder="Search tracks or artists"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {tracks ? <TrackList tracks={tracks} /> : !error && <p className="muted">Loading…</p>}
    </>
  );
}
