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

func init() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-for-development"
    }
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }
    
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `)
    if err != nil {
        return err
    }
    
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `)
    if err != nil {
        return err
    }
    
    return nil
}

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
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
    if err != nil {
        return "", err
    }
    
    return tokenString, nil
}

func registerHandler(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }
    
    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }
    
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email).Scan(&exists)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Database error"})
    }
    
    if exists {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
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

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    var userID int
    var email string
    var passwordHash string
    err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", req.Email).Scan(&userID, &email, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    if !checkPasswordHash(req.Password, passwordHash) {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    token, err := generateJWT(userID, email)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
    }
    
    return c.Status(200).JSON(LoginResponse{
        Token:   token,
        Message: "Login successful",
    })
}

func forgotPasswordHandler(c *fiber.Ctx) error {
    var req ForgotPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(404).JSON(MessageResponse{Message: "Email not found"})
    }
    
    var userID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
    if err != nil {
        return c.Status(404).JSON(MessageResponse{Message: "Email not found"})
    }
    
    resetToken := uuid.New().String()
    
    _, err = db.Exec("INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)", userID, resetToken)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error generating reset token"})
    }
    
    return c.Status(200).JSON(ForgotPasswordResponse{
        Message:    "Password reset token generated",
        ResetToken: resetToken,
    })
}

func resetPasswordHandler(c *fiber.Ctx) error {
    var req ResetPasswordRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
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
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
    }
    
    if used {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
    }
    
    if time.Since(createdAt) > 24*time.Hour {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
    }
    
    hashedPassword, err := hashPassword(req.NewPassword)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error processing password"})
    }
    
    _, err = db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hashedPassword, userID)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Error updating password"})
    }
    
    _, err = db.Exec("UPDATE reset_tokens SET used = TRUE WHERE token = ?", req.Token)
    if err != nil {
        log.Printf("Error marking token as used: %v", err)
    }
    
    return c.Status(200).JSON(MessageResponse{Message: "Password reset successful"})
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)
    app.Post("/forgot-password", forgotPasswordHandler)
    app.Post("/reset-password", resetPasswordHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}