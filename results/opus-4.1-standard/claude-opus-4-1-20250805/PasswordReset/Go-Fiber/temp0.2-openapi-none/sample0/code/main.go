package main

import (
    "database/sql"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );`

    _, err = db.Exec(createTableSQL)
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

func generateJWT(email string) (string, error) {
    token := jwt.New(jwt.SigningMethodHS256)
    claims := token.Claims.(jwt.MapClaims)
    claims["email"] = email
    claims["exp"] = time.Now().Add(time.Hour * 24).Unix()

    tokenString, err := token.SignedString([]byte(appSecret))
    return tokenString, err
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Email and password are required"})
    }

    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Database error"})
    }
    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Error processing password"})
    }

    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    var userID int
    var email, password string
    err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&userID, &email, &password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    if !checkPasswordHash(req.Password, password) {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    token, err := generateJWT(email)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Error generating token"})
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func forgotPassword(c *fiber.Ctx) error {
    var req ForgotPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(404).JSON(fiber.Map{"message": "Email not found"})
    }

    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"message": "Email not found"})
    }

    resetToken := uuid.New().String()

    _, err = db.Exec("INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)", userID, resetToken)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Error generating reset token"})
    }

    return c.Status(200).JSON(fiber.Map{
        "message":     "Password reset token generated",
        "reset_token": resetToken,
    })
}

func resetPassword(c *fiber.Ctx) error {
    var req ResetPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
    }

    var userID int
    var used bool
    err := db.QueryRow("SELECT user_id, used FROM reset_tokens WHERE token = ?", req.Token).Scan(&userID, &used)
    if err != nil || used {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
    }

    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Error processing password"})
    }

    _, err = db.Exec("UPDATE users SET password = ? WHERE id = ?", hashedPassword, userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Error updating password"})
    }

    _, err = db.Exec("UPDATE reset_tokens SET used = 1 WHERE token = ?", req.Token)
    if err != nil {
        log.Printf("Failed to mark token as used: %v", err)
    }

    return c.Status(200).JSON(fiber.Map{"message": "Password reset successful"})
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