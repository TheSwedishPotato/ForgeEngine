// Package api wires the HTTP routes to the database, storage and auth layers.
package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"hifistream/internal/auth"
	"hifistream/internal/config"
	"hifistream/internal/signing"
	"hifistream/internal/storage"
)

// streamTTL is how long a stream link stays valid. The player fetches a new
// one if playback outlives it.
const streamTTL = 4 * time.Hour

// qualifyingPlayMs is the minimum listening time for a play to count towards payouts.
const qualifyingPlayMs = 30_000

type Server struct {
	cfg    config.Config
	db     *pgxpool.Pool
	store  storage.Store
	auth   *auth.Manager
	signer *signing.Signer
}

func New(cfg config.Config, pool *pgxpool.Pool, store storage.Store) *Server {
	return &Server{
		cfg:    cfg,
		db:     pool,
		store:  store,
		auth:   auth.NewManager(cfg.JWTSecret, 30*24*time.Hour),
		signer: signing.New(cfg.StreamSecret),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	required := func(h http.HandlerFunc) http.Handler { return s.auth.Require(h) }

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.Ping(r.Context()); err != nil {
			writeError(w, http.StatusServiceUnavailable, "database unavailable")
			return
		}
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/config", s.publicConfig)
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.Handle("GET /api/me", required(s.me))

	mux.HandleFunc("GET /api/tracks", s.listTracks)
	mux.Handle("GET /api/artists/{id}", s.auth.Optional(http.HandlerFunc(s.getArtist)))
	mux.Handle("POST /api/artists", required(s.createArtist))

	mux.Handle("GET /api/studio", required(s.studio))
	mux.Handle("POST /api/studio/tracks", required(s.uploadTrack))

	mux.Handle("POST /api/tracks/{id}/play", required(s.playTrack))
	mux.Handle("POST /api/plays", required(s.recordPlay))
	mux.HandleFunc("GET /stream/{id}", s.stream)

	if s.cfg.DevFakeBilling {
		mux.Handle("POST /api/billing/dev/membership", required(s.devMembership))
		mux.Handle("POST /api/billing/dev/artists/{id}/subscribe", required(s.devSubscribe))
	}
	mux.HandleFunc("POST /api/admin/payouts/run", s.runPayouts)

	return s.cors(logRequests(mux))
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range s.cfg.CORSOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && (allowed[origin] || allowed["*"]) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range")
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			// The Web Audio graph only receives samples from cross-origin media
			// when the stream response carries CORS headers.
			h.Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	log.Printf("error: %s %s: %v", r.Method, r.URL.Path, err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// isUUID reports whether s looks like a canonical UUID, so malformed IDs
// return 404 instead of a Postgres cast error.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch {
		case i == 8 || i == 13 || i == 18 || i == 23:
			if c != '-' {
				return false
			}
		case (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F'):
			return false
		}
	}
	return true
}

func newUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
