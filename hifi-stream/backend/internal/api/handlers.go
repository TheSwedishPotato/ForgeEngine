package api

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"hifistream/internal/audio"
	"hifistream/internal/auth"
	"hifistream/internal/payouts"
	"hifistream/internal/storage"
)

type userJSON struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

type trackJSON struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	ArtistID       string `json:"artistId"`
	ArtistName     string `json:"artistName"`
	Codec          string `json:"codec"`
	SampleRate     int    `json:"sampleRate"`
	BitDepth       int    `json:"bitDepth"`
	Channels       int    `json:"channels"`
	DurationMs     int64  `json:"durationMs"`
	SubscriberOnly bool   `json:"subscriberOnly"`
}

const trackColumns = `t.id, t.title, t.artist_id, a.name, t.codec, t.sample_rate, t.bit_depth, t.channels, t.duration_ms, t.subscriber_only`

func scanTrack(row pgx.Row, extra ...any) (trackJSON, error) {
	var t trackJSON
	dest := append([]any{&t.ID, &t.Title, &t.ArtistID, &t.ArtistName, &t.Codec, &t.SampleRate, &t.BitDepth, &t.Channels, &t.DurationMs, &t.SubscriberOnly}, extra...)
	return t, row.Scan(dest...)
}

type artistJSON struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Bio               string `json:"bio"`
	MonthlyPriceCents int64  `json:"monthlyPriceCents"`
	Subscribers       int64  `json:"subscribers"`
}

func (s *Server) loadArtist(r *http.Request, where string, arg string) (artistJSON, error) {
	var a artistJSON
	err := s.db.QueryRow(r.Context(), `
		SELECT a.id, a.name, a.bio, a.monthly_price_cents,
		  (SELECT count(*) FROM artist_subscriptions s
		   WHERE s.artist_id = a.id AND s.status = 'active' AND s.current_period_end > now())
		FROM artists a WHERE `+where+` = $1`, arg).
		Scan(&a.ID, &a.Name, &a.Bio, &a.MonthlyPriceCents, &a.Subscribers)
	return a, err
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"membershipPriceCents": s.cfg.MembershipCents,
		"membershipFeeBps":     s.cfg.MembershipFeeBps,
		"directFeeBps":         s.cfg.DirectFeeBps,
		"devBilling":           s.cfg.DevFakeBilling,
	})
}

// --- accounts ---

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password, DisplayName string }
	if !readJSON(w, r, &in) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	name := strings.TrimSpace(in.DisplayName)
	if !strings.Contains(email, "@") {
		writeError(w, http.StatusBadRequest, "enter a valid email address")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		writeError(w, http.StatusBadRequest, "password must be 8 to 72 characters")
		return
	}
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	u := userJSON{Email: email, DisplayName: name}
	err = s.db.QueryRow(r.Context(),
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
		email, hash, name).Scan(&u.ID)
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "that email is already registered")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.issueSession(w, r, http.StatusCreated, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if !readJSON(w, r, &in) {
		return
	}
	var u userJSON
	var hash string
	err := s.db.QueryRow(r.Context(),
		`SELECT id, email, display_name, password_hash FROM users WHERE email = $1`,
		strings.ToLower(strings.TrimSpace(in.Email))).Scan(&u.ID, &u.Email, &u.DisplayName, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, r, err)
		return
	}
	if err != nil || !auth.CheckPassword(hash, in.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	s.issueSession(w, r, http.StatusOK, u)
}

func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, status int, u userJSON) {
	token, err := s.auth.Issue(u.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, status, map[string]any{"token": token, "user": u})
}

type artistRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid := auth.UserID(ctx)
	var out struct {
		userJSON
		Artist              *artistRef `json:"artist"`
		MembershipActive    bool       `json:"membershipActive"`
		MembershipRenewsAt  *time.Time `json:"membershipRenewsAt"`
		SubscribedArtistIDs []string   `json:"subscribedArtistIds"`
	}
	var artistID, artistName *string
	var status *string
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, a.id, a.name, m.status, m.current_period_end
		FROM users u
		LEFT JOIN artists a ON a.user_id = u.id
		LEFT JOIN memberships m ON m.user_id = u.id
		WHERE u.id = $1`, uid).
		Scan(&out.ID, &out.Email, &out.DisplayName, &artistID, &artistName, &status, &out.MembershipRenewsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "account no longer exists")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if artistID != nil {
		out.Artist = &artistRef{*artistID, *artistName}
	}
	out.MembershipActive = status != nil && *status == "active" && out.MembershipRenewsAt.After(time.Now())

	rows, err := s.db.Query(ctx, `SELECT artist_id FROM artist_subscriptions
		WHERE user_id = $1 AND status = 'active' AND current_period_end > now()`, uid)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	out.SubscribedArtistIDs, err = pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// --- catalog ---

func (s *Server) listTracks(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
	rows, err := s.db.Query(r.Context(), `
		SELECT `+trackColumns+` FROM tracks t JOIN artists a ON a.id = t.artist_id
		WHERE $1 = '' OR t.title ILIKE $2 OR a.name ILIKE $2
		ORDER BY t.created_at DESC LIMIT 100`, q, pattern)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	tracks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (trackJSON, error) { return scanTrack(row) })
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (s *Server) getArtist(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isUUID(id) {
		writeError(w, http.StatusNotFound, "artist not found")
		return
	}
	a, err := s.loadArtist(r, "a.id", id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "artist not found")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+trackColumns+` FROM tracks t JOIN artists a ON a.id = t.artist_id
		WHERE t.artist_id = $1 ORDER BY t.created_at DESC`, id)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	tracks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (trackJSON, error) { return scanTrack(row) })
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	subscribed := false
	if uid := auth.UserID(r.Context()); uid != "" {
		err = s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM artist_subscriptions
			WHERE user_id = $1 AND artist_id = $2 AND status = 'active' AND current_period_end > now())`, uid, id).Scan(&subscribed)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"artist": a, "tracks": tracks, "subscribed": subscribed})
}

func (s *Server) createArtist(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name              string
		Bio               string
		MonthlyPriceCents int64
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 120 {
		writeError(w, http.StatusBadRequest, "artist name is required (max 120 characters)")
		return
	}
	if in.MonthlyPriceCents < 100 || in.MonthlyPriceCents > 100000 {
		writeError(w, http.StatusBadRequest, "monthly price must be between $1 and $1000")
		return
	}
	var id string
	err := s.db.QueryRow(r.Context(), `INSERT INTO artists (user_id, name, bio, monthly_price_cents)
		VALUES ($1, $2, $3, $4) RETURNING id`, auth.UserID(r.Context()), in.Name, strings.TrimSpace(in.Bio), in.MonthlyPriceCents).Scan(&id)
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "this account already has an artist profile")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// --- artist studio ---

func (s *Server) studio(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	a, err := s.loadArtist(r, "a.user_id", auth.UserID(ctx))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusForbidden, "create an artist profile first")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	type studioTrack struct {
		trackJSON
		Plays    int64 `json:"plays"`
		MsPlayed int64 `json:"msPlayed"`
	}
	rows, err := s.db.Query(ctx, `
		SELECT `+trackColumns+`,
		  count(p.id) FILTER (WHERE p.ms_played >= $2), coalesce(sum(p.ms_played), 0)
		FROM tracks t JOIN artists a ON a.id = t.artist_id
		LEFT JOIN plays p ON p.track_id = t.id
		WHERE t.artist_id = $1
		GROUP BY t.id, a.name ORDER BY t.created_at DESC`, a.ID, qualifyingPlayMs)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	tracks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (studioTrack, error) {
		var st studioTrack
		var err error
		st.trackJSON, err = scanTrack(row, &st.Plays, &st.MsPlayed)
		return st, err
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	type payoutJSON struct {
		PeriodStart     time.Time `json:"periodStart"`
		PeriodEnd       time.Time `json:"periodEnd"`
		MembershipCents int64     `json:"membershipCents"`
		DirectCents     int64     `json:"directCents"`
		TotalCents      int64     `json:"totalCents"`
		Status          string    `json:"status"`
	}
	rows, err = s.db.Query(ctx, `SELECT period_start, period_end, membership_cents, direct_cents, total_cents, status
		FROM payouts WHERE artist_id = $1 ORDER BY period_start DESC LIMIT 24`, a.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	history, err := pgx.CollectRows(rows, pgx.RowToStructByPos[payoutJSON])
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"artist": a, "tracks": tracks, "payouts": history})
}

func (s *Server) uploadTrack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var artistID string
	err := s.db.QueryRow(ctx, `SELECT id FROM artists WHERE user_id = $1`, auth.UserID(ctx)).Scan(&artistID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusForbidden, "create an artist profile first")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "file is too large")
			return
		}
		writeError(w, http.StatusBadRequest, "expected a multipart form with a file field")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()

	info, err := audio.Probe(file)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if _, err := file.Seek(0, 0); err != nil {
		s.internalError(w, r, err)
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		title = strings.TrimSuffix(hdr.Filename, filepath.Ext(hdr.Filename))
	}

	id := newUUID()
	key := "tracks/" + artistID + "/" + id + "." + info.Codec
	if err := s.store.Put(ctx, key, file, hdr.Size, audio.ContentType(info.Codec)); err != nil {
		s.internalError(w, r, err)
		return
	}
	_, err = s.db.Exec(ctx, `INSERT INTO tracks
		(id, artist_id, title, storage_key, codec, sample_rate, bit_depth, channels, duration_ms, size_bytes, subscriber_only)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		id, artistID, title, key, info.Codec, info.SampleRate, info.BitDepth, info.Channels, info.DurationMs, hdr.Size,
		r.FormValue("subscriberOnly") == "true")
	if err != nil {
		s.store.Delete(ctx, key)
		s.internalError(w, r, err)
		return
	}
	t, err := scanTrack(s.db.QueryRow(ctx, `SELECT `+trackColumns+` FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id = $1`, id))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// --- playback ---

// playTrack checks the listener's entitlement and returns a short-lived URL
// the <audio> element can stream from with ordinary Range requests.
func (s *Server) playTrack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid := auth.UserID(ctx)
	id := r.PathValue("id")
	if !isUUID(id) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	var artistID, key, codec string
	var subscriberOnly bool
	err := s.db.QueryRow(ctx, `SELECT artist_id, storage_key, codec, subscriber_only FROM tracks WHERE id = $1`, id).
		Scan(&artistID, &key, &codec, &subscriberOnly)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	var owner, fan, member bool
	err = s.db.QueryRow(ctx, `SELECT
		  EXISTS (SELECT 1 FROM artists WHERE id = $2 AND user_id = $1),
		  EXISTS (SELECT 1 FROM artist_subscriptions WHERE user_id = $1 AND artist_id = $2
		          AND status = 'active' AND current_period_end > now()),
		  EXISTS (SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active' AND current_period_end > now())`,
		uid, artistID).Scan(&owner, &fan, &member)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	switch {
	case owner || fan:
	case subscriberOnly:
		writeJSON(w, http.StatusPaymentRequired, map[string]string{
			"error": "this track is for the artist's direct subscribers", "reason": "subscription_required"})
		return
	case !member:
		writeJSON(w, http.StatusPaymentRequired, map[string]string{
			"error": "start a membership or subscribe to this artist to listen", "reason": "membership_required"})
		return
	}

	exp := time.Now().Add(streamTTL)
	url := ""
	if s.cfg.R2Delivery == "redirect" {
		url, err = s.store.PresignGet(ctx, key, audio.ContentType(codec), streamTTL)
		if err != nil && !errors.Is(err, storage.ErrNoPresign) {
			s.internalError(w, r, err)
			return
		}
	}
	if url == "" {
		url = s.cfg.PublicURL + "/stream/" + id + "?" + s.signer.Query(id, uid, exp).Encode()
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": url, "expiresAt": exp})
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isUUID(id) {
		http.NotFound(w, r)
		return
	}
	if _, err := s.signer.Verify(id, r.URL.Query(), time.Now()); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	var key, codec string
	err := s.db.QueryRow(r.Context(), `SELECT storage_key, codec FROM tracks WHERE id = $1`, id).Scan(&key, &codec)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	// Each signed URL is unique, so the browser may cache the ranges it fetched.
	w.Header().Set("Cache-Control", "private, max-age=14400, no-transform")
	s.store.Serve(w, r, key, audio.ContentType(codec))
}

func (s *Server) recordPlay(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TrackID  string
		MsPlayed int64
	}
	if !readJSON(w, r, &in) {
		return
	}
	if !isUUID(in.TrackID) || in.MsPlayed <= 0 {
		writeError(w, http.StatusBadRequest, "trackId and a positive msPlayed are required")
		return
	}
	var duration int64
	err := s.db.QueryRow(r.Context(), `SELECT duration_ms FROM tracks WHERE id = $1`, in.TrackID).Scan(&duration)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	// One report covers at most one full listen.
	in.MsPlayed = min(in.MsPlayed, duration)
	if in.MsPlayed <= 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO plays (user_id, track_id, ms_played) VALUES ($1, $2, $3)`,
		auth.UserID(r.Context()), in.TrackID, in.MsPlayed); err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- billing (development stand-in for a real payment provider) ---

func (s *Server) devMembership(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid := auth.UserID(ctx)
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO memberships (user_id, status, price_cents, current_period_end)
			VALUES ($1, 'active', $2, now() + interval '30 days')
			ON CONFLICT (user_id) DO UPDATE SET status = 'active', price_cents = EXCLUDED.price_cents,
			  current_period_end = EXCLUDED.current_period_end, updated_at = now()`, uid, s.cfg.MembershipCents); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO payments (user_id, kind, amount_cents) VALUES ($1, 'membership', $2)`, uid, s.cfg.MembershipCents)
		return err
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) devSubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid := auth.UserID(ctx)
	artistID := r.PathValue("id")
	if !isUUID(artistID) {
		writeError(w, http.StatusNotFound, "artist not found")
		return
	}
	var price int64
	var ownerID string
	err := s.db.QueryRow(ctx, `SELECT monthly_price_cents, user_id FROM artists WHERE id = $1`, artistID).Scan(&price, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "artist not found")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if ownerID == uid {
		writeError(w, http.StatusBadRequest, "you can't subscribe to your own artist profile")
		return
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO artist_subscriptions (user_id, artist_id, status, price_cents, current_period_end)
			VALUES ($1, $2, 'active', $3, now() + interval '30 days')
			ON CONFLICT (user_id, artist_id) DO UPDATE SET status = 'active', price_cents = EXCLUDED.price_cents,
			  current_period_end = EXCLUDED.current_period_end`, uid, artistID, price); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO payments (user_id, kind, artist_id, amount_cents)
			VALUES ($1, 'artist_subscription', $2, $3)`, uid, artistID, price)
		return err
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- payouts ---

// runPayouts computes what every artist earned in [periodStart, periodEnd)
// and records it. Re-running a period updates rows that are still pending.
func (s *Server) runPayouts(w http.ResponseWriter, r *http.Request) {
	if s.cfg.AdminToken == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-Token")), []byte(s.cfg.AdminToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "admin token required")
		return
	}
	var in struct{ PeriodStart, PeriodEnd string }
	if !readJSON(w, r, &in) {
		return
	}
	start, err1 := time.Parse(time.DateOnly, in.PeriodStart)
	end, err2 := time.Parse(time.DateOnly, in.PeriodEnd)
	if err1 != nil || err2 != nil || !end.After(start) {
		writeError(w, http.StatusBadRequest, "periodStart and periodEnd must be YYYY-MM-DD dates with end after start")
		return
	}
	ctx := r.Context()

	rows, err := s.db.Query(ctx, `SELECT user_id, coalesce(artist_id::text, ''), amount_cents
		FROM payments WHERE paid_at >= $1 AND paid_at < $2`, start, end)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	payments, err := pgx.CollectRows(rows, pgx.RowToStructByPos[payouts.Payment])
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	// Artists listening to their own tracks don't earn from it.
	rows, err = s.db.Query(ctx, `
		SELECT p.user_id, t.artist_id, sum(p.ms_played)
		FROM plays p
		JOIN tracks t ON t.id = p.track_id
		JOIN artists a ON a.id = t.artist_id
		WHERE p.played_at >= $1 AND p.played_at < $2 AND p.ms_played >= $3 AND a.user_id <> p.user_id
		GROUP BY p.user_id, t.artist_id`, start, end, qualifyingPlayMs)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	listening := payouts.Listening{}
	var userID, artistID string
	var ms int64
	_, err = pgx.ForEachRow(rows, []any{&userID, &artistID, &ms}, func() error {
		if listening[userID] == nil {
			listening[userID] = map[string]int64{}
		}
		listening[userID][artistID] = ms
		return nil
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	res := payouts.Compute(payments, listening, s.cfg.MembershipFeeBps, s.cfg.DirectFeeBps)
	var artistTotal int64
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		for id, e := range res.Artists {
			artistTotal += e.Total()
			if _, err := tx.Exec(ctx, `INSERT INTO payouts (artist_id, period_start, period_end, membership_cents, direct_cents, total_cents)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (artist_id, period_start) DO UPDATE SET period_end = EXCLUDED.period_end,
				  membership_cents = EXCLUDED.membership_cents, direct_cents = EXCLUDED.direct_cents,
				  total_cents = EXCLUDED.total_cents
				WHERE payouts.status = 'pending'`, id, start, end, e.MembershipCents, e.DirectCents, e.Total()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"artists":          len(res.Artists),
		"artistCents":      artistTotal,
		"platformCents":    res.PlatformCents,
		"unallocatedCents": res.UnallocatedCents,
	})
}
