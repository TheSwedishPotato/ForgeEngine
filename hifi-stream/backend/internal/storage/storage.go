// Package storage abstracts where master audio files live: a local
// directory for development, or a Cloudflare R2 bucket in production.
package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"
)

var ErrNoPresign = errors.New("storage: presigned URLs not supported")

type Store interface {
	Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error
	Delete(ctx context.Context, key string) error
	// Serve writes the object to w, honouring the request's Range header so
	// the player only downloads the bytes it is about to play.
	Serve(w http.ResponseWriter, r *http.Request, key, contentType string)
	// PresignGet returns a time-limited URL the client can fetch directly,
	// or ErrNoPresign.
	PresignGet(ctx context.Context, key, contentType string, ttl time.Duration) (string, error)
}
