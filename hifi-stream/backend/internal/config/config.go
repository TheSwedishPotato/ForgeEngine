// Package config loads server settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   []byte
	// StreamSecret signs the short-lived stream URLs handed to the <audio> element.
	StreamSecret []byte
	// PublicURL is the externally reachable base URL of this API, used to build stream URLs.
	PublicURL   string
	CORSOrigins []string

	StorageDriver   string // "local" or "r2"
	LocalStorageDir string
	R2AccountID     string
	R2AccessKeyID   string
	R2SecretKey     string
	R2Bucket        string
	// R2Delivery is "redirect" (clients fetch straight from R2, zero egress) or
	// "proxy" (bytes flow through this server).
	R2Delivery string

	DevFakeBilling   bool
	AdminToken       string
	MembershipCents  int64
	MembershipFeeBps int64
	DirectFeeBps     int64
	MaxUploadBytes   int64
}

func Load() (Config, error) {
	c := Config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		JWTSecret:       []byte(os.Getenv("JWT_SECRET")),
		StreamSecret:    []byte(os.Getenv("STREAM_SIGNING_SECRET")),
		PublicURL:       strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		CORSOrigins:     splitList(env("CORS_ORIGINS", "http://localhost:3000")),
		StorageDriver:   env("STORAGE_DRIVER", "local"),
		LocalStorageDir: env("LOCAL_STORAGE_DIR", "./data/media"),
		R2AccountID:     os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:   os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretKey:     os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Bucket:        os.Getenv("R2_BUCKET"),
		R2Delivery:      env("R2_DELIVERY", "redirect"),
		DevFakeBilling:  env("DEV_FAKE_BILLING", "false") == "true",
		AdminToken:      os.Getenv("ADMIN_TOKEN"),
	}

	var err error
	if c.MembershipCents, err = envInt("MEMBERSHIP_PRICE_CENTS", 1099); err != nil {
		return c, err
	}
	if c.MembershipFeeBps, err = envInt("MEMBERSHIP_FEE_BPS", 3000); err != nil {
		return c, err
	}
	if c.DirectFeeBps, err = envInt("DIRECT_FEE_BPS", 1000); err != nil {
		return c, err
	}
	maxMB, err := envInt("MAX_UPLOAD_MB", 2048)
	if err != nil {
		return c, err
	}
	c.MaxUploadBytes = maxMB << 20

	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		return c, errors.New("JWT_SECRET must be at least 32 bytes")
	}
	if len(c.StreamSecret) == 0 {
		c.StreamSecret = append([]byte("stream:"), c.JWTSecret...)
	}
	if c.MembershipFeeBps < 0 || c.MembershipFeeBps > 10000 || c.DirectFeeBps < 0 || c.DirectFeeBps > 10000 {
		return c, errors.New("fee basis points must be between 0 and 10000")
	}
	switch c.StorageDriver {
	case "local":
	case "r2":
		if c.R2AccountID == "" || c.R2AccessKeyID == "" || c.R2SecretKey == "" || c.R2Bucket == "" {
			return c, errors.New("STORAGE_DRIVER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET")
		}
		if c.R2Delivery != "redirect" && c.R2Delivery != "proxy" {
			return c, errors.New(`R2_DELIVERY must be "redirect" or "proxy"`)
		}
	default:
		return c, fmt.Errorf("unknown STORAGE_DRIVER %q", c.StorageDriver)
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int64) (int64, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
