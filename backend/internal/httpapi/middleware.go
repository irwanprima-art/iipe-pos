package httpapi

import (
	"context"
	"log"
	"net/http"
	"time"

	"iipe/backend/internal/service"
)

type ctxKey string

const claimsKey ctxKey = "claims"

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}

func (s *Server) requireAuth(next http.HandlerFunc, roles ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if len(h) < 8 || h[:7] != "Bearer " {
			writeErr(w, http.StatusUnauthorized, "harus login")
			return
		}
		claims, err := s.auth.Parse(h[7:])
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "token tidak valid")
			return
		}
		if len(roles) > 0 {
			ok := false
			for _, role := range roles {
				if claims.Role == role {
					ok = true
					break
				}
			}
			if !ok {
				writeErr(w, http.StatusForbidden, "akses ditolak")
				return
			}
		}
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func claimsFrom(r *http.Request) *service.Claims {
	c, _ := r.Context().Value(claimsKey).(*service.Claims)
	return c
}
