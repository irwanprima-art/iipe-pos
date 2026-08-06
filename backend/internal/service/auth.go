package service

import (
	"context"
	"errors"
	"time"

	"iipe/backend/internal/domain"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Auth struct {
	pool   *pgxpool.Pool
	secret []byte
}

func NewAuth(pool *pgxpool.Pool, secret string) *Auth {
	return &Auth{pool: pool, secret: []byte(secret)}
}

type Claims struct {
	UserID int64  `json:"uid"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func (a *Auth) Login(ctx context.Context, email, password string) (string, domain.User, error) {
	var u domain.User
	var hash string
	err := a.pool.QueryRow(ctx, `SELECT id, email, name, role, password_hash FROM users WHERE lower(email)=lower($1)`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.Role, &hash)
	if err != nil {
		return "", u, errors.New("email atau password salah")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", u, errors.New("email atau password salah")
	}
	claims := Claims{
		UserID: u.ID, Name: u.Name, Role: u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	ts, err := token.SignedString(a.secret)
	return ts, u, err
}

func (a *Auth) Parse(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return a.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("token tidak valid")
}
