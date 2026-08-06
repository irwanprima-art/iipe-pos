package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"iipe/backend/internal/config"
	"iipe/backend/internal/db"
	"iipe/backend/internal/httpapi"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	srv := httpapi.NewServer(pool, cfg)
	if err := srv.Seed(ctx); err != nil {
		log.Printf("seed: %v", err)
	}
	go srv.StartSweeper(ctx)

	s := &http.Server{Addr: ":" + cfg.Port, Handler: srv.Handler()}
	go func() {
		log.Printf("IIPE backend listening on :%s", cfg.Port)
		if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	shCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.Shutdown(shCtx)
}
