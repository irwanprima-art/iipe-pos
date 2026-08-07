package httpapi

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
)

// rewriteImages mengubah URL gambar (S3 absolut lama / relatif) menjadi path yang
// disajikan melalui proxy backend, agar gambar bisa ditampilkan meski objek S3
// tidak publik-readable (GET butuh credential).
func (s *Server) rewriteImages(imgs []string) []string {
	out := make([]string, len(imgs))
	for i, u := range imgs {
		out[i] = s.imageURL(u)
	}
	return out
}

func (s *Server) imageURL(u string) string {
	if u == "" || strings.HasPrefix(u, "/") {
		return u // sudah relatif (/api/v1/images/... atau /uploads/...)
	}
	// URL absolut S3 lama: <base>/<bucket>/<key> → /api/v1/images/<key>
	if s.cfg.S3Bucket != "" {
		marker := "/" + s.cfg.S3Bucket + "/"
		if i := strings.Index(u, marker); i >= 0 {
			return "/api/v1/images/" + u[i+len(marker):]
		}
	}
	return u
}

// handleImage memproksi gambar dari S3 (dengan kredensial) atau dari folder
// uploads lokal bila S3 tidak dikonfigurasi.
func (s *Server) handleImage(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, "/api/v1/images/")
	if key == "" {
		writeErr(w, 400, "key kosong")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if s.storage.Enabled() {
		rc, err := s.storage.Get(r.Context(), key)
		if err != nil {
			writeErr(w, 404, "gambar tidak ditemukan")
			return
		}
		defer rc.Close()
		w.Header().Set("Content-Type", imageContentType(key))
		if _, err := io.Copy(w, rc); err != nil {
			return
		}
		return
	}
	// fallback: file lokal
	http.ServeFile(w, r, filepath.Join(s.cfg.UploadDir, filepath.Base(key)))
}

func imageContentType(key string) string {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	}
	return "application/octet-stream"
}
