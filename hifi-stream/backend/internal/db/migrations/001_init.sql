CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- An artist profile belongs to exactly one user account.
CREATE TABLE artists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                text NOT NULL,
  bio                 text NOT NULL DEFAULT '',
  monthly_price_cents bigint NOT NULL DEFAULT 500 CHECK (monthly_price_cents BETWEEN 100 AND 100000),
  payout_account_ref  text,  -- e.g. a Stripe Connect account ID
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tracks (
  id              uuid PRIMARY KEY,
  artist_id       uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title           text NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  codec           text NOT NULL CHECK (codec IN ('flac', 'wav')),
  sample_rate     integer NOT NULL CHECK (sample_rate > 0),
  bit_depth       smallint NOT NULL CHECK (bit_depth > 0),
  channels        smallint NOT NULL CHECK (channels > 0),
  duration_ms     bigint NOT NULL CHECK (duration_ms >= 0),
  size_bytes      bigint NOT NULL,
  subscriber_only boolean NOT NULL DEFAULT false,  -- only direct subscribers of the artist may stream
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracks_artist_idx ON tracks (artist_id, created_at DESC);
CREATE INDEX tracks_created_idx ON tracks (created_at DESC);

-- The platform-wide "all access" plan.
CREATE TABLE memberships (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status             text NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
  price_cents        bigint NOT NULL,
  current_period_end timestamptz NOT NULL,
  external_ref       text,  -- e.g. a Stripe subscription ID
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A fan paying one artist directly.
CREATE TABLE artist_subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id          uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  status             text NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
  price_cents        bigint NOT NULL,
  current_period_end timestamptz NOT NULL,
  external_ref       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, artist_id)
);
CREATE INDEX artist_subscriptions_artist_idx ON artist_subscriptions (artist_id);

-- Money actually collected. Payouts are computed from these rows, never from plan prices.
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('membership', 'artist_subscription')),
  artist_id    uuid REFERENCES artists(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  external_ref text UNIQUE,  -- payment provider invoice ID, makes webhooks idempotent
  paid_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'artist_subscription') = (artist_id IS NOT NULL))
);
CREATE INDEX payments_paid_at_idx ON payments (paid_at);

-- One row per listening session reported by the player.
CREATE TABLE plays (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id  uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  ms_played integer NOT NULL CHECK (ms_played > 0),
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plays_played_at_idx ON plays (played_at);
CREATE INDEX plays_track_idx ON plays (track_id);

CREATE TABLE payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id       uuid NOT NULL REFERENCES artists(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  membership_cents bigint NOT NULL DEFAULT 0,
  direct_cents    bigint NOT NULL DEFAULT 0,
  total_cents     bigint NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artist_id, period_start)
);
