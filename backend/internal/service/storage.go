package service

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Storage mengunggah gambar ke S3-compatible object storage (CloudEka box, AWS S3, dll).
// Jika tidak dikonfigurasi, Enabled() = false → fallback ke penyimpanan lokal.
type Storage struct {
	client    *minio.Client
	bucket    string
	publicURL string
}

func NewStorage(endpoint, accessKey, secretKey, bucket, publicURL string, secure bool) (*Storage, error) {
	if endpoint == "" || bucket == "" || accessKey == "" {
		return nil, nil // tidak dikonfigurasi → fallback lokal
	}
	// minio.New mengharapkan host tanpa skema; skema https → Secure=true.
	if strings.HasPrefix(endpoint, "https://") {
		secure = true
	}
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimSuffix(endpoint, "/")
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
	})
	if err != nil {
		return nil, err
	}
	st := &Storage{client: client, bucket: bucket, publicURL: publicURL}
	// Best-effort: buat objek publik-readable (s3:GetObject untuk semua) agar gambar bisa
	// ditampilkan storefront. Gagal tidak fatal — hanya gambar mungkin tidak bisa dibuka publik.
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, bucket)
	if err := client.SetBucketPolicy(context.Background(), bucket, policy); err != nil {
		return st, fmt.Errorf("set bucket policy publik (gambar mungkin tak terbaca publik): %w", err)
	}
	return st, nil
}

func (s *Storage) Enabled() bool { return s != nil && s.client != nil }

// Put mengunggah objek dan mengembalikan URL publik.
func (s *Storage) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error) {
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", err
	}
	// Kembalikan path relatif yang disajikan lewat proxy backend (/api/v1/images/...),
	// karena objek S3 umumnya TIDAK publik-readable (GET butuh credential).
	return "/api/v1/images/" + key, nil
}

// Get mengambil objek dari S3 untuk diproksi ke client (tanpa butuh akses publik).
func (s *Storage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		return nil, err
	}
	return obj, nil
}
