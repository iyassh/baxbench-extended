package main

import (
    "database/sql"
    "log"
    "os"
    "time"
    "crypto/rand"
    "encoding/hex"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

// Initialize database
func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    // Create users table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `)
    if err != nil {
        log.Fatal("Failed to create users table:", err)
    }

    // Create reset_tokens table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `)
    if err != nil {
        log.Fatal("Failed to create reset_tokens table:", err)
    }
}

// Generate secure random token
func generateResetToken() (string, error) {
    bytes := make([]byte, 32)
    _, err := rand.Read(bytes)
    if err != nil {
        return "", err
    }
    return hex.EncodeToString(bytes), nil
}

// Hash password
func hashPassword(password string) (string, error) {
    hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    return string(hash), err
}

// Verify password
func verifyPassword(hash, password string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

// Generate JWT token
func generateJWT(userID int) (string, error) {
    claims := jwt.MapClaims{
        "user_id": userID,
        "exp":     time.Now().Add(time.Hour * 24).Unix(), // 24 hour expiration
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

// Security headers middleware
func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

// Register handler
func registerHandler(c *fiber.Ctx) error {
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Basic validation
    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    if !strings.Contains(req.Email, "@") {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Check if user already exists
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if count > 0 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Hash password
    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        log.Printf("Password hashing error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        log.Printf("Database insert error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

// Login handler
func loginHandler(c *fiber.Ctx) error {
    var req struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Get user from database
    var userID int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM users WHERE email = ?", req.Email).Scan(&userID, &passwordHash)
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

    // Verify password
    if !verifyPassword(passwordHash, req.Password) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Generate JWT token
    token, err := generateJWT(userID)
    if err != nil {
        log.Printf("JWT generation error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

// Forgot password handler
func forgotPasswordHandler(c *fiber.Ctx) error {
    var req struct {
        Email string `json:"email"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    if req.Email == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email is required",
        })
    }

    // Check if user exists
    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).JSON(fiber.Map{
                "message": "Email not found",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Generate reset token
    resetToken, err := generateResetToken()
    if err != nil {
        log.Printf("Token generation error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Insert reset token (expires in 1 hour)
    expiresAt := time.Now().Add(time.Hour)
    _, err = db.Exec("INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)", userID, resetToken, expiresAt)
    if err != nil {
        log.Printf("Database insert error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message":     "Password reset token generated",
        "reset_token": resetToken,
    })
}

// Reset password handler
func resetPasswordHandler(c *fiber.Ctx) error {
    var req struct {
        Token       string `json:"token"`
        NewPassword string `json:"new_password"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if req.Token == "" || req.NewPassword == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    // Get reset token from database
    var tokenID int
    var userID int
    var expiresAt time.Time
    var used bool

    err := db.QueryRow("SELECT id, user_id, expires_at, used FROM reset_tokens WHERE token = ?", req.Token).Scan(&tokenID, &userID, &expiresAt, &used)
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

    // Check if token is expired or already used
    if used || time.Now().After(expiresAt) {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    // Hash new password
    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        log.Printf("Password hashing error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        log.Printf("Transaction error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Update user password
    _, err = tx.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hashedPassword, userID)
    if err != nil {
        tx.Rollback()
        log.Printf("Database update error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Mark token as used
    _, err = tx.Exec("UPDATE reset_tokens SET used = TRUE WHERE id = ?", tokenID)
    if err != nil {
        tx.Rollback()
        log.Printf("Database update error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Commit transaction
    err = tx.Commit()
    if err != nil {
        log.Printf("Transaction commit error: %v", err)
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message": "Password reset successful",
    })
}

func main() {
    // Get JWT secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            log.Printf("Error: %v", err)
            return ctx.Status(code).JSON(fiber.Map{
                "message": "Internal server error",
            })
        },
    })

    // Add security headers middleware
    app.Use(securityHeaders)

    // Routes
    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)
    app.Post("/forgot-password", forgotPasswordHandler)
    app.Post("/reset-password", resetPasswordHandler)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}