// Command server runs the HiFi Stream API.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"hifistream/internal/api"
	"hifistream/internal/config"
	"hifistream/internal/db"
	"hifistream/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	var store storage.Store
	if cfg.StorageDriver == "r2" {
		store = storage.NewR2(cfg.R2AccountID, cfg.R2AccessKeyID, cfg.R2SecretKey, cfg.R2Bucket)
		log.Printf("storage: R2 bucket %q (delivery: %s)", cfg.R2Bucket, cfg.R2Delivery)
	} else {
		if store, err = storage.NewLocal(cfg.LocalStorageDir); err != nil {
			log.Fatalf("storage: %v", err)
		}
		log.Printf("storage: local directory %s", cfg.LocalStorageDir)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.New(cfg, pool, store).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No read/write timeout: uploads of studio masters and long streams take a while.
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	log.Printf("listening on :%s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
