#!/usr/bin/env bash
# End-to-end check of the API: register, become an artist, upload a 24-bit
# FLAC, buy a membership (dev billing), stream byte ranges, report a play and
# run payouts. Needs curl, jq and ffmpeg, and a server started with
# DEV_FAKE_BILLING=true and ADMIN_TOKEN set.
set -euo pipefail

API=${API:-http://localhost:8080}
ADMIN_TOKEN=${ADMIN_TOKEN:?set ADMIN_TOKEN to the server\'s admin token}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
run=$RANDOM$RANDOM

ffmpeg -loglevel error -f lavfi -i "sine=frequency=440:sample_rate=96000:duration=40" \
  -ac 2 -c:a flac -sample_fmt s32 -bits_per_raw_sample 24 "$WORK/tone.flac"

post() { curl -sS -f -X POST "$API$1" -H "Content-Type: application/json" ${3:+-H "Authorization: Bearer $3"} -d "$2"; }

ARTIST_TOKEN=$(post /api/auth/register "{\"email\":\"artist$run@example.com\",\"password\":\"password123\",\"displayName\":\"Artist\"}" | jq -r .token)
FAN_TOKEN=$(post /api/auth/register "{\"email\":\"fan$run@example.com\",\"password\":\"password123\"}" | jq -r .token)
ARTIST_ID=$(post /api/artists '{"name":"Sine Waves","bio":"Test tones","monthlyPriceCents":500}' "$ARTIST_TOKEN" | jq -r .id)

TRACK=$(curl -sS -f -X POST "$API/api/studio/tracks" -H "Authorization: Bearer $ARTIST_TOKEN" \
  -F "file=@$WORK/tone.flac" -F "title=A440")
echo "uploaded: $(echo "$TRACK" | jq -c '{codec, sampleRate, bitDepth, channels, durationMs}')"
TRACK_ID=$(echo "$TRACK" | jq -r .id)

status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/api/tracks/$TRACK_ID/play" -H "Authorization: Bearer $FAN_TOKEN")
[ "$status" = 402 ] || { echo "expected 402 before membership, got $status"; exit 1; }

curl -sS -f -X POST "$API/api/billing/dev/membership" -H "Authorization: Bearer $FAN_TOKEN"
URL=$(post "/api/tracks/$TRACK_ID/play" '{}' "$FAN_TOKEN" | jq -r .url)

range=$(curl -sS -o "$WORK/part" -D - -H "Range: bytes=0-65535" "$URL" | tr -d '\r')
echo "$range" | grep -q '^HTTP/1.1 206' || { echo "expected 206 Partial Content"; echo "$range"; exit 1; }
echo "range: $(echo "$range" | grep -i '^content-range')"
[ "$(head -c 4 "$WORK/part")" = fLaC ] || { echo "range did not start with the FLAC header"; exit 1; }

status=$(curl -sS -o /dev/null -w '%{http_code}' "${URL/sig=/sig=x}")
[ "$status" = 403 ] || { echo "expected 403 for a tampered link, got $status"; exit 1; }

post /api/plays "{\"trackId\":\"$TRACK_ID\",\"msPlayed\":35000}" "$FAN_TOKEN"
today=$(date -u +%F); tomorrow=$(date -u -d tomorrow +%F)
echo "payouts: $(curl -sS -f -X POST "$API/api/admin/payouts/run" -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d "{\"periodStart\":\"$today\",\"periodEnd\":\"$tomorrow\"}")"
echo "studio:  $(curl -sS -f "$API/api/studio" -H "Authorization: Bearer $ARTIST_TOKEN" | jq -c '{plays: .tracks[0].plays, payout: .payouts[0].totalCents}')"
echo "artist page: http://localhost:3000/artists/$ARTIST_ID"
echo "smoke test passed"
