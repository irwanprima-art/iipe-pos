package httpapi

import (
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var validRoles = map[string]bool{
	"admin": true, "cashier": true, "operator": true,
}

// handleListUsers: daftar semua user staff/admin.
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id, email, name, role, created_at FROM users ORDER BY id`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	type userRow struct {
		ID        int64     `json:"id"`
		Email     string    `json:"email"`
		Name      string    `json:"name"`
		Role      string    `json:"role"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := []userRow{}
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.CreatedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleCreateUser: tambah user staff/admin baru.
func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	body.Name = strings.TrimSpace(body.Name)
	if body.Email == "" || body.Name == "" {
		writeErr(w, 400, "email dan nama wajib diisi")
		return
	}
	if !validRoles[body.Role] {
		writeErr(w, 400, "role tidak valid")
		return
	}
	if len(body.Password) < 6 {
		writeErr(w, 400, "password minimal 6 karakter")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_, err = s.pool.Exec(r.Context(),
		`INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)`,
		body.Email, string(hash), body.Name, body.Role)
	if err != nil {
		writeErr(w, 400, err.Error()) // email duplikat dsb.
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleUpdateUser: ubah nama / role / reset password user.
func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	var body struct {
		Name     *string `json:"name"`
		Role     *string `json:"role"`
		Password *string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if body.Role != nil && !validRoles[*body.Role] {
		writeErr(w, 400, "role tidak valid")
		return
	}
	if body.Password != nil && *body.Password != "" && len(*body.Password) < 6 {
		writeErr(w, 400, "password minimal 6 karakter")
		return
	}
	if body.Name != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE users SET name=$1 WHERE id=$2`, strings.TrimSpace(*body.Name), id)
	}
	if body.Role != nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE users SET role=$1 WHERE id=$2`, *body.Role, id)
	}
	if body.Password != nil && *body.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_, _ = s.pool.Exec(r.Context(), `UPDATE users SET password_hash=$1 WHERE id=$2`, string(hash), id)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDeleteUser: hapus user (tidak boleh akun sendiri / admin terakhir).
func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		writeErr(w, 400, "id tidak valid")
		return
	}
	claims := claimsFrom(r)
	if claims.UserID == id {
		writeErr(w, 400, "tidak bisa menghapus akun sendiri")
		return
	}
	var role string
	_ = s.pool.QueryRow(r.Context(), `SELECT role FROM users WHERE id=$1`, id).Scan(&role)
	if role == "admin" {
		var adminCount int
		_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&adminCount)
		if adminCount <= 1 {
			writeErr(w, 400, "tidak bisa menghapus admin terakhir")
			return
		}
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM users WHERE id=$1`, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
