"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, formatMoney, formatQuality, uploadTrack, type StudioData } from "@/core/api";
import { useAuth } from "@/core/auth";

export default function StudioPage() {
  const { me, ready, refresh } = useAuth();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!me)
    return (
      <div className="panel narrow">
        <h1>Artist studio</h1>
        <p className="muted">Sign in to upload your masters and see what you&apos;ve earned.</p>
        <Link href="/login" className="button">
          Sign in
        </Link>
      </div>
    );
  if (!me.artist) return <CreateArtist onCreated={refresh} />;
  return <Studio />;
}

function CreateArtist({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [price, setPrice] = useState("5.00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/artists", { body: { name, bio, monthlyPriceCents: Math.round(parseFloat(price) * 100) } });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create profile");
      setBusy(false);
    }
  }

  return (
    <form className="panel form narrow" onSubmit={submit}>
      <h1>Become an artist</h1>
      <p className="muted">Fans can subscribe to you directly, on top of the membership share you earn from plays.</p>
      <label>
        Artist name
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Bio
        <textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <label>
        Monthly subscription price (USD)
        <input type="number" min="1" max="1000" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="button" disabled={busy}>
        Create artist profile
      </button>
    </form>
  );
}

function Studio() {
  const [data, setData] = useState<StudioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [subscriberOnly, setSubscriberOnly] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const load = useCallback(() => api<StudioData>("/api/studio").then(setData, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("subscriberOnly", String(subscriberOnly));
    setError(null);
    setProgress(0);
    const formEl = e.currentTarget;
    try {
      await uploadTrack(form, setProgress);
      formEl.reset();
      setFile(null);
      setTitle("");
      setSubscriberOnly(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setProgress(null);
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const plays = data.tracks.reduce((n, t) => n + t.plays, 0);
  const hours = data.tracks.reduce((n, t) => n + t.msPlayed, 0) / 3_600_000;
  const earned = data.payouts.reduce((n, p) => n + p.totalCents, 0);

  return (
    <>
      <div className="toolbar">
        <h1>{data.artist.name}</h1>
        <Link href={`/artists/${data.artist.id}`} className="button secondary small">
          View public page
        </Link>
      </div>

      <div className="stats">
        <Stat label="Qualified plays" value={plays.toLocaleString()} />
        <Stat label="Hours listened" value={hours.toFixed(1)} />
        <Stat label="Direct subscribers" value={data.artist.subscribers.toLocaleString()} />
        <Stat label="Earned to date" value={formatMoney(earned)} />
      </div>

      <form className="panel form" onSubmit={upload}>
        <h2>Upload a master</h2>
        <p className="muted small">
          FLAC (recommended) or PCM WAV, up to 24-bit / 192 kHz. Files are stored and streamed byte for byte as
          uploaded.
        </p>
        <label>
          Audio file
          <input
            type="file"
            required
            accept=".flac,.wav,audio/flac,audio/wav,audio/x-wav"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Title
          <input placeholder="Defaults to the file name" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={subscriberOnly} onChange={(e) => setSubscriberOnly(e.target.checked)} />
          Only for my direct subscribers
        </label>
        {progress !== null && (
          <div className="progress" aria-label="Upload progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="button" disabled={!file || progress !== null}>
          {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : "Upload"}
        </button>
      </form>

      <h2>Your tracks</h2>
      {data.tracks.length === 0 ? (
        <p className="muted">Nothing uploaded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Format</th>
                <th className="num">Plays</th>
                <th className="num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {data.tracks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.title} {t.subscriberOnly && <span className="badge sub">Subscribers</span>}
                  </td>
                  <td>
                    {t.codec.toUpperCase()} · {formatQuality(t)}
                  </td>
                  <td className="num">{t.plays}</td>
                  <td className="num">{(t.msPlayed / 3_600_000).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Payouts</h2>
      {data.payouts.length === 0 ? (
        <p className="muted">Payouts appear here after each billing period closes.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">From plays</th>
                <th className="num">Direct</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.periodStart}>
                  <td>
                    {p.periodStart.slice(0, 10)} → {p.periodEnd.slice(0, 10)}
                  </td>
                  <td className="num">{formatMoney(p.membershipCents)}</td>
                  <td className="num">{formatMoney(p.directCents)}</td>
                  <td className="num">{formatMoney(p.totalCents)}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
