package main

import (
    "crypto/rand"
    "database/sql"
    "encoding/hex"
    "errors"
    "log"
    "os"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-change-me"
    }
    jwtSecret = []byte(secret)
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    createUsersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
    
    createTokensTable := `
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (email) REFERENCES users(email)
    );`

    if _, err := db.Exec(createUsersTable); err != nil {
        return err
    }
    
    if _, err := db.Exec(createTokensTable); err != nil {
        return err
    }

    return nil
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
    return c.Next()
}

func generateJWT(email string) (string, error) {
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "email": email,
        "exp":   time.Now().Add(time.Hour * 24).Unix(),
    })
    return token.SignedString(jwtSecret)
}

func generateResetToken() (string, error) {
    bytes := make([]byte, 32)
    if _, err := rand.Read(bytes); err != nil {
        return "", err
    }
    return hex.EncodeToString(bytes), nil
}

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
    return string(bytes), err
}

func checkPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

func isValidEmail(email string) bool {
    if len(email) < 3 || len(email) > 254 {
        return false
    }
    if !strings.Contains(email, "@") {
        return false
    }
    parts := strings.Split(email, "@")
    if len(parts) != 2 || len(parts[0]) == 0 || len(parts[1]) == 0 {
        return false
    }
    if !strings.Contains(parts[1], ".") {
        return false
    }
    return true
}

func register(c *fiber.Ctx) error {
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    if !isValidEmail(req.Email) {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }

    if len(req.Password) < 8 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Password must be at least 8 characters long",
        })
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        log.Printf("Error hashing password: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(400).JSON(fiber.Map{
                "message": "Email already in use or invalid data",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if !isValidEmail(req.Email) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    var hashedPassword string
    err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&hashedPassword)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if !checkPassword(req.Password, hashedPassword) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    token, err := generateJWT(req.Email)
    if err != nil {
        log.Printf("Error generating token: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func forgotPassword(c *fiber.Ctx) error {
    var req struct {
        Email string `json:"email"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    if !isValidEmail(req.Email) {
        return c.Status(404).JSON(fiber.Map{
            "message": "Email not found",
        })
    }

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email).Scan(&exists)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if !exists {
        return c.Status(404).JSON(fiber.Map{
            "message": "Email not found",
        })
    }

    resetToken, err := generateResetToken()
    if err != nil {
        log.Printf("Error generating reset token: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    expiresAt := time.Now().Add(15 * time.Minute)
    _, err = db.Exec("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)",
        req.Email, resetToken, expiresAt)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message":     "Password reset token generated",
        "reset_token": resetToken,
    })
}

func resetPassword(c *fiber.Ctx) error {
    var req struct {
        Token       string `json:"token"`
        NewPassword string `json:"new_password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if len(req.NewPassword) < 8 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if len(req.Token) != 64 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    var email string
    var expiresAt time.Time
    var used bool
    err := db.QueryRow(`
        SELECT email, expires_at, used 
        FROM password_reset_tokens 
        WHERE token = ?`, req.Token).Scan(&email, &expiresAt, &used)

    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(400).JSON(fiber.Map{
                "message": "Invalid or expired token",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if time.Now().After(expiresAt) || used {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        log.Printf("Error hashing password: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    tx, err := db.Begin()
    if err != nil {
        log.Printf("Transaction error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }
    defer tx.Rollback()

    _, err = tx.Exec("UPDATE users SET password = ? WHERE email = ?", hashedPassword, email)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    _, err = tx.Exec("UPDATE password_reset_tokens SET used = 1 WHERE token = ?", req.Token)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if err = tx.Commit(); err != nil {
        log.Printf("Transaction commit error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message": "Password reset successful",
    })
}

func errorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal server error"

    var e *fiber.Error
    if errors.As(err, &e) {
        code = e.Code
        if code >= 400 && code < 500 {
            message = e.Message
        }
    }

    log.Printf("Error: %v", err)

    return c.Status(code).JSON(fiber.Map{
        "message": message,
    })
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: errorHandler,
    })

    app.Use(securityHeaders)

    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/forgot-password", forgotPassword)
    app.Post("/reset-password", resetPassword)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}