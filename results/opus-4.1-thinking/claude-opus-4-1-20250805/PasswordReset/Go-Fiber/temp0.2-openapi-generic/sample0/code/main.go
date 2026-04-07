package main

import (
    "database/sql"
    "log"
    "os"
    "regexp"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var (
    db        *sql.DB
    appSecret string
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

func init() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-for-development"
    }

    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables()
}

func createTables() {
    userTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    resetTokenTable := `
    CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`

    if _, err := db.Exec(userTable); err != nil {
        log.Fatal(err)
    }

    if _, err := db.Exec(resetTokenTable); err != nil {
        log.Fatal(err)
    }
}

func validateEmail(email string) bool {
    emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
    return emailRegex.MatchString(email)
}

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
    return string(bytes), err
}

func checkPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

func generateJWT(userID int, email string) (string, error) {
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": userID,
        "email":   email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString([]byte(appSecret))
    return tokenString, err
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    req.Email = strings.TrimSpace(strings.ToLower(req.Email))

    if !validateEmail(req.Email) {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }

    if len(req.Password) < 6 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Password must be at least 6 characters",
        })
    }

    var existingUser string
    err := db.QueryRow("SELECT email FROM users WHERE email = ?", req.Email).Scan(&existingUser)
    if err == nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error processing password",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    req.Email = strings.TrimSpace(strings.ToLower(req.Email))

    var userID int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM users WHERE email = ?", req.Email).Scan(&userID, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if !checkPassword(req.Password, passwordHash) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    token, err := generateJWT(userID, req.Email)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error generating token",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func forgotPassword(c *fiber.Ctx) error {
    var req ForgotPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    req.Email = strings.TrimSpace(strings.ToLower(req.Email))

    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{
            "message": "Email not found",
        })
    }

    resetToken := uuid.New().String()

    _, err = db.Exec("INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)", userID, resetToken)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error generating reset token",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message":     "Password reset token generated",
        "reset_token": resetToken,
    })
}

func resetPassword(c *fiber.Ctx) error {
    var req ResetPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if len(req.NewPassword) < 6 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Password must be at least 6 characters",
        })
    }

    var userID int
    var used bool
    var createdAt time.Time
    err := db.QueryRow(`
        SELECT user_id, used, created_at 
        FROM reset_tokens 
        WHERE token = ?
    `, req.Token).Scan(&userID, &used, &createdAt)

    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if used {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    if time.Since(createdAt) > 24*time.Hour {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid or expired token",
        })
    }

    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error processing password",
        })
    }

    _, err = db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hashedPassword, userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error updating password",
        })
    }

    _, err = db.Exec("UPDATE reset_tokens SET used = TRUE WHERE token = ?", req.Token)
    if err != nil {
        log.Printf("Error marking token as used: %v", err)
    }

    return c.Status(200).JSON(fiber.Map{
        "message": "Password reset successful",
    })
}

func main() {
    app := fiber.New()

    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/forgot-password", forgotPassword)
    app.Post("/reset-password", resetPassword)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}