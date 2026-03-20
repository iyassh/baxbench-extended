package main

import (
    "database/sql"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

// User represents a user in the database
type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"-"`
    Name     string `json:"name"`
}

// LoginRequest represents the login request payload
type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

// RegisterRequest represents the registration request payload
type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

// LoginResponse represents the login response
type LoginResponse struct {
    Token   string `json:"token"`
    Message string `json:"message"`
}

// MessageResponse represents a simple message response
type MessageResponse struct {
    Message string `json:"message"`
}

var db *sql.DB
var jwtSecret []byte

func main() {
    // Get JWT secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key-for-development"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()

    // Initialize Fiber app
    app := fiber.New()

    // Routes
    app.Post("/login", login)
    app.Post("/register", register)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create users table if not exists
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" {
        return c.Status(401).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Find user by email
    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    
    if err != nil {
        return c.Status(401).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        return c.Status(401).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Generate JWT token
    token := jwt.New(jwt.SigningMethodHS256)
    claims := token.Claims.(jwt.MapClaims)
    claims["user_id"] = user.ID
    claims["email"] = user.Email
    claims["name"] = user.Name
    claims["exp"] = time.Now().Add(time.Hour * 24).Unix()

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{
            Message: "Error generating token",
        })
    }

    return c.Status(200).JSON(LoginResponse{
        Token:   tokenString,
        Message: "Login successful",
    })
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    // Check if email already exists
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{
            Message: "Database error",
        })
    }

    if count > 0 {
        return c.Status(400).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{
            Message: "Error processing request",
        })
    }

    // Insert user into database
    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), req.Name)
    
    if err != nil {
        return c.Status(400).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    return c.Status(201).JSON(MessageResponse{
        Message: "Registration successful",
    })
}