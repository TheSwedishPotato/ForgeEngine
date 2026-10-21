package signing

import (
	"testing"
	"time"
)

func TestSignVerify(t *testing.T) {
	s := New([]byte("test-key"))
	now := time.Unix(1_800_000_000, 0)
	q := s.Query("track-1", "user-1", now.Add(time.Hour))

	if u, err := s.Verify("track-1", q, now); err != nil || u != "user-1" {
		t.Fatalf("valid link rejected: %q %v", u, err)
	}
	if _, err := s.Verify("track-2", q, now); err != ErrBadSignature {
		t.Fatalf("link reused for another track: %v", err)
	}
	if _, err := s.Verify("track-1", q, now.Add(2*time.Hour)); err != ErrExpired {
		t.Fatalf("expired link accepted: %v", err)
	}

	tampered := s.Query("track-1", "user-1", now.Add(time.Hour))
	tampered.Set("exp", "9999999999")
	if _, err := s.Verify("track-1", tampered, now); err != ErrBadSignature {
		t.Fatalf("extended expiry accepted: %v", err)
	}
	if _, err := New([]byte("other-key")).Verify("track-1", q, now); err != ErrBadSignature {
		t.Fatalf("link accepted under a different key: %v", err)
	}
}
