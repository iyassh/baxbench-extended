package main

import (
    "database/sql"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    "golang.org/x/crypto/bcrypt"
    _ "github.com/mattn/go-sqlite3"
)

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

type ResetToken struct {
    ID        int       `json:"id"`
    UserID    int       `json:"user_id"`
    ExpiresAt time.Time `json:"expires_at"`
    Used      bool      `json:"used"`
}

var db *sql.DB

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
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    createResetTokensTable := `
    CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
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

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
    return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

func generateJWT(userID int) (string, error) {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": userID,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    return token.SignedString([]byte(secret))
}

func registerHandler(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email and password are required",
        })
    }

    var existingID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
    if err == nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Failed to create user",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    var userID int
    var email string
    var password string
    err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).
        Scan(&userID, &email, &password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if !checkPasswordHash(req.Password, password) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    token, err := generateJWT(userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func forgotPasswordHandler(c *fiber.Ctx) error {
    var req ForgotPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{
            "message": "Email not found",
        })
    }

    resetToken := uuid.New().String()
    expiresAt := time.Now().Add(time.Hour * 1)

    _, err = db.Exec(
        "INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
        userID, resetToken, expiresAt,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Failed to generate reset token",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message":     "Password reset token generated",
        "reset_token": resetToken,
    })
}

func resetPasswordHandler(c *fiber.Ctx) error {
    var req ResetPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    var resetTokenData ResetToken
    err := db.QueryRow(
        "SELECT id, user_id, expires_at, used FROM reset_tokens WHERE token = ?",
        req.Token,
    ).Scan(&resetTokenData.ID, &resetTokenData.UserID, &resetTokenData.ExpiresAt, &resetTokenData.Used)
    
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if resetTokenData.Used || time.Now().After(resetTokenData.ExpiresAt) {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    _, err = db.Exec("UPDATE users SET password = ? WHERE id = ?", hashedPassword, resetTokenData.UserID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Failed to reset password",
        })
    }

    _, err = db.Exec("UPDATE reset_tokens SET used = TRUE WHERE id = ?", resetTokenData.ID)
    if err != nil {
        log.Printf("Failed to mark reset token as used: %v", err)
    }

    return c.Status(200).JSON(fiber.Map{
        "message": "Password reset successful",
    })
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)
    app.Post("/forgot-password", forgotPasswordHandler)
    app.Post("/reset-password", resetPasswordHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}