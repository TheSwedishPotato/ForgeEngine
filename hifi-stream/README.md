# HiFi Stream

A lossless music streaming platform: 24-bit FLAC masters, byte-range streaming,
and artist payouts based on what each listener actually plays.

```
 Next.js player ──POST /api/tracks/:id/play──► Go API ── checks membership / subscription
      │                                            │
      │   ◄── short-lived signed URL ──────────────┘
      │
      └── <audio> GET with Range: bytes=… ──► R2 (presigned, zero egress)
                                             or Go /stream/:id (local disk / proxy)
```

- **frontend/**: Next.js 16 app with a discover page, artist pages, an artist studio (upload, stats, payouts) and a persistent player.
- **backend/**: Go API covering auth, the catalog, uploads with FLAC/WAV header inspection, entitlement checks, signed range streaming, play logging and payout runs.
- **Postgres** stores users, artists, tracks, memberships, direct subscriptions, payments, plays and payouts (`backend/internal/db/migrations`).
- **Storage** is either a local directory (dev) or Cloudflare R2 (prod).

## How streaming works

1. The player asks `POST /api/tracks/{id}/play`. The API checks that the listener is
   the artist, a direct subscriber, or (for non-exclusive tracks) a member.
2. The API returns a URL that is valid for 4 hours: an R2 presigned URL, or a
   `/stream/{id}?u=…&exp=…&sig=…` link signed with HMAC-SHA256. An `<audio>`
   element can't send an `Authorization` header, so the authorization lives in the URL.
3. The browser streams that URL with ordinary HTTP Range requests. Playback starts
   after the first few hundred KB, seeking jumps straight to the right byte offset,
   and nothing beyond what is played gets downloaded. If a link expires mid-session,
   the player fetches a new one and resumes at the same position.
4. A Web Audio `AnalyserNode` taps the decoded signal for the spectrum display.
   The player reports listening time (seeks excluded) when the track changes or the page closes.

## How artists get paid

`POST /api/admin/payouts/run` with `{"periodStart":"2026-10-01","periodEnd":"2026-11-01"}`
and the `X-Admin-Token` header:

- **Memberships are split per listener.** Each member's fee, minus `MEMBERSHIP_FEE_BPS`,
  goes only to the artists *that member* played, in proportion to listening time.
  Plays under 30 s and artists playing their own tracks don't count. Fake streams
  can only redirect the faker's own fee, so play farming doesn't pay.
- **Direct subscriptions** go to the artist minus `DIRECT_FEE_BPS`.
- Splits use the largest-remainder method, so every cent is accounted for.
  Re-running a period updates rows that are still `pending`.

## Run it locally

With Docker:

```sh
docker compose up --build
open http://localhost:3000
```

Without Docker (Go 1.26+, Node 22+, Postgres 16):

```sh
cd backend && cp .env.example .env   # set DATABASE_URL, JWT_SECRET, DEV_FAKE_BILLING=true, ADMIN_TOKEN
set -a && . ./.env && set +a && go run ./cmd/server

cd frontend && npm install && npm run dev   # NEXT_PUBLIC_API_URL defaults to http://localhost:8080
```

Then: create an account, open **Studio** to become an artist and upload a FLAC,
start a membership from the home page (dev billing charges no card), and press play.

`scripts/smoke.sh` runs the whole flow against a live API with curl: register,
upload a generated 24-bit/96 kHz FLAC, get 402 before paying, stream byte ranges,
reject a tampered link, log a play, and run payouts. Unit tests: `cd backend && go test ./...`.

## Production with Cloudflare R2

```sh
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=…  R2_ACCESS_KEY_ID=…  R2_SECRET_ACCESS_KEY=…  R2_BUCKET=masters
R2_DELIVERY=redirect
```

With `redirect`, listeners download straight from R2, so egress costs nothing. Give the
bucket a CORS policy, or the Web Audio graph receives silence:

```json
[{ "AllowedOrigins": ["https://your-app.example"], "AllowedMethods": ["GET", "HEAD"],
   "AllowedHeaders": ["Range"], "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
   "MaxAgeSeconds": 3600 }]
```

`R2_DELIVERY=proxy` sends bytes through the Go server instead. That's useful behind
a CDN, but you then pay your host's bandwidth, so it isn't zero-egress.

## Technical facts to get right in the pitch

- **FLAC is lossless, not uncompressed.** It's bit-identical to the WAV master at
  roughly half the size. Say "lossless" or "bit-perfect source"; "uncompressed FLAC"
  is a contradiction an audiophile will catch.
- **Browsers can't play bit-perfect audio.** Chrome, Safari and Firefox mix everything
  at the output device's rate (often 44.1 or 48 kHz) and resample the source. The player
  shows that as `out 48 kHz` next to the source format. True bit-perfect playback with
  exclusive device access needs native desktop and mobile apps.
- **Egress is zero only in `redirect` mode.** Proxying through Go moves the bandwidth bill to your host.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | none | returns `{token, user}` |
| GET | `/api/me` | bearer | profile, artist, membership, subscriptions |
| GET | `/api/config` | none | prices, fee splits, whether dev billing is on |
| GET | `/api/tracks?q=` | none | catalog and search |
| GET | `/api/artists/{id}` | optional | artist, tracks, `subscribed` |
| POST | `/api/artists` | bearer | create an artist profile |
| GET | `/api/studio` | artist | tracks with play stats, payout history |
| POST | `/api/studio/tracks` | artist | multipart upload (`file`, `title`, `subscriberOnly`) |
| POST | `/api/tracks/{id}/play` | bearer | entitlement check, returns signed stream URL, or 402 |
| GET | `/stream/{id}?u&exp&sig` | signed URL | Range-aware audio bytes |
| POST | `/api/plays` | bearer | `{trackId, msPlayed}` |
| POST | `/api/billing/dev/membership`, `/api/billing/dev/artists/{id}/subscribe` | bearer | dev-only fake checkout |
| POST | `/api/admin/payouts/run` | `X-Admin-Token` | compute payouts for a period |

## Not built yet

- **Real payments.** Replace the `/api/billing/dev/*` routes with Stripe Checkout and a
  webhook that writes `payments` rows (`external_ref` keeps webhooks idempotent), plus
  Stripe Connect transfers to `artists.payout_account_ref` when payouts are marked `paid`.
- Direct-to-R2 uploads with presigned PUTs (uploads currently pass through the API and are capped by `MAX_UPLOAD_MB`).
- Albums, artwork, playlists, email verification and password reset.
- Rate limiting on auth and play reporting.
