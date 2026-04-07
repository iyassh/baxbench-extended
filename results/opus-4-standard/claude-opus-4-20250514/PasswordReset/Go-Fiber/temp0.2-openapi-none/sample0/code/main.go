package main

import (
    "crypto/rand"
    "database/sql"
    "encoding/hex"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type ForgotPasswordRequest struct {
    Email string `json:"email"`
}

type ResetPasswordRequest struct {
    Token       string `json:"token"`
    NewPassword string `json:"new_password"`
}

type MessageResponse struct {
    Message string `json:"message"`
}

type LoginResponse struct {
    Token   string `json:"token"`
    Message string `json:"message"`
}

type ForgotPasswordResponse struct {
    Message    string `json:"message"`
    ResetToken string `json:"reset_token"`
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createUsersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    createResetTokensTable := `
    CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        used BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`

    _, err = db.Exec(createUsersTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(createResetTokensTable)
    if err != nil {
        log.Fatal(err)
    }
}

func generateToken() (string, error) {
    bytes := make([]byte, 32)
    if _, err := rand.Read(bytes); err != nil {
        return "", err
    }
    return hex.EncodeToString(bytes), nil
}

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

func createJWT(email string) (string, error) {
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "email": email,
        "exp":   time.Now().Add(time.Hour * 24).Unix(),
    })
    return token.SignedString([]byte(appSecret))
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(MessageResponse{Message: "Email and password are required"})
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error processing password"})
    }

    _, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }

    return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    var passwordHash string
    err := db.QueryRow("SELECT password_hash FROM users WHERE email = ?", req.Email).Scan(&passwordHash)
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    if !checkPasswordHash(req.Password, passwordHash) {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    token, err := createJWT(req.Email)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
    }

    return c.Status(200).JSON(LoginResponse{
        Token:   token,
        Message: "Login successful",
    })
}

func forgotPassword(c *fiber.Ctx) error {
    var req ForgotPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }

    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        return c.Status(404).JSON(MessageResponse{Message: "Email not found"})
    }

    resetToken, err := generateToken()
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
    }

    expiresAt := time.Now().Add(time.Hour * 1)
    _, err = db.Exec("INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        userID, resetToken, expiresAt)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error creating reset token"})
    }

    return c.Status(200).JSON(ForgotPasswordResponse{
        Message:    "Password reset token generated",
        ResetToken: resetToken,
    })
}

func resetPassword(c *fiber.Ctx) error {
    var req ResetPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }

    var userID int
    var used bool
    var expiresAt time.Time
    err := db.QueryRow(`
        SELECT user_id, used, expires_at FROM reset_tokens 
        WHERE token = ?`, req.Token).Scan(&userID, &used, &expiresAt)
    
    if err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
    }

    if used || time.Now().After(expiresAt) {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
    }

    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error processing password"})
    }

    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Database error"})
    }

    _, err = tx.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hashedPassword, userID)
    if err != nil {
        tx.Rollback()
        return c.Status(500).JSON(MessageResponse{Message: "Error updating password"})
    }

    _, err = tx.Exec("UPDATE reset_tokens SET used = 1 WHERE token = ?", req.Token)
    if err != nil {
        tx.Rollback()
        return c.Status(500).JSON(MessageResponse{Message: "Error invalidating token"})
    }

    if err = tx.Commit(); err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Database error"})
    }

    return c.Status(200).JSON(MessageResponse{Message: "Password reset successful"})
}

func main() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key"
    }

    initDB()
    defer db.Close()

    app := fiber.New()

    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/forgot-password", forgotPassword)
    app.Post("/reset-password", resetPassword)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}