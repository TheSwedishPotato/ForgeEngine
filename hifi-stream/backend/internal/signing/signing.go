// Package signing creates and verifies short-lived stream URLs.
//
// An <audio> element cannot send an Authorization header, so the API hands
// the player a URL whose query string carries an HMAC over the track, the
// listener and an expiry time.
package signing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

var (
	ErrExpired      = errors.New("stream link expired")
	ErrBadSignature = errors.New("invalid stream signature")
)

type Signer struct{ key []byte }

func New(key []byte) *Signer { return &Signer{key: key} }

func (s *Signer) sign(trackID, userID string, exp int64) string {
	m := hmac.New(sha256.New, s.key)
	fmt.Fprintf(m, "%s\n%s\n%d", trackID, userID, exp)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// Query returns the signed query parameters for a stream URL.
func (s *Signer) Query(trackID, userID string, exp time.Time) url.Values {
	e := exp.Unix()
	return url.Values{
		"u":   {userID},
		"exp": {strconv.FormatInt(e, 10)},
		"sig": {s.sign(trackID, userID, e)},
	}
}

// Verify checks a stream URL's query and returns the listener it was issued to.
func (s *Signer) Verify(trackID string, q url.Values, now time.Time) (string, error) {
	exp, err := strconv.ParseInt(q.Get("exp"), 10, 64)
	if err != nil {
		return "", ErrBadSignature
	}
	userID := q.Get("u")
	if !hmac.Equal([]byte(s.sign(trackID, userID, exp)), []byte(q.Get("sig"))) {
		return "", ErrBadSignature
	}
	if now.Unix() > exp {
		return "", ErrExpired
	}
	return userID, nil
}
