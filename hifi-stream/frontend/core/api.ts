export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

export type Track = {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  codec: "flac" | "wav";
  sampleRate: number;
  bitDepth: number;
  channels: number;
  durationMs: number;
  subscriberOnly: boolean;
};

export type Me = {
  id: string;
  email: string;
  displayName: string;
  artist: { id: string; name: string } | null;
  membershipActive: boolean;
  membershipRenewsAt: string | null;
  subscribedArtistIds: string[];
};

export type PublicConfig = {
  membershipPriceCents: number;
  membershipFeeBps: number;
  directFeeBps: number;
  devBilling: boolean;
};

export type Artist = {
  id: string;
  name: string;
  bio: string;
  monthlyPriceCents: number;
  subscribers: number;
};

export type ArtistPageData = { artist: Artist; tracks: Track[]; subscribed: boolean };

export type Payout = {
  periodStart: string;
  periodEnd: string;
  membershipCents: number;
  directCents: number;
  totalCents: number;
  status: "pending" | "paid" | "failed";
};

export type StudioData = {
  artist: Artist;
  tracks: Array<Track & { plays: number; msPlayed: number }>;
  payouts: Payout[];
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "hifi.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the session lasts until reload.
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T = void>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = authHeaders();
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(API_URL + path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.reason);
  return data as T;
}

/** Uploads a master with progress reporting, which fetch() can't provide. */
export function uploadTrack(form: FormData, onProgress: (fraction: number) => void): Promise<Track> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_URL + "/api/studio/tracks");
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 300) resolve(data as Track);
      else reject(new ApiError(xhr.status, data.error ?? "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.send(form);
  });
}

/** Reports listening time; keepalive lets it finish while the page unloads. */
export function reportPlay(trackId: string, msPlayed: number) {
  fetch(API_URL + "/api/plays", {
    method: "POST",
    keepalive: true,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, msPlayed: Math.round(msPlayed) }),
  }).catch(() => {});
}

export const formatRate = (hz: number) => (hz / 1000).toFixed(1).replace(/\.0$/, "");
export const formatQuality = (t: Track) => `${t.bitDepth}-bit / ${formatRate(t.sampleRate)} kHz`;
export const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
