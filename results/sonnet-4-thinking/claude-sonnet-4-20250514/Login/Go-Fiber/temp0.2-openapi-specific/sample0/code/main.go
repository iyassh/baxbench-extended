package main

import (
    "database/sql"
    "log"
    "os"
    "strings"
    "sync"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

type LoginResponse struct {
    Token   string `json:"token"`
    Message string `json:"message"`
}

type ErrorResponse struct {
    Message string `json:"message"`
}

type User struct {
    ID       string
    Email    string
    Password string
    Name     string
}

var db *sql.DB
var jwtSecret []byte

// Rate limiting store
var attempts = make(map[string][]time.Time)
var attemptsMutex = sync.RWMutex{}

func main() {
    // Get JWT secret from environment
    secretEnv := os.Getenv("APP_SECRET")
    if secretEnv == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secretEnv)

    // Initialize database
    initDB()
    defer db.Close()

    // Initialize Fiber app
    app := fiber.New(fiber.Config{
        DisableStartupMessage: true,
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            // CWE-209: Don't expose sensitive information in error messages
            return ctx.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
                Message: "Internal server error",
            })
        },
    })

    // Security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("Access-Control-Allow-Origin", "*")
        c.Set("Access-Control-Allow-Methods", "POST")
        c.Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
        return c.Next()
    })

    // Routes
    app.Post("/login", login)
    app.Post("/register", register)

    log.Println("Server starting on :5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create users table
    createTableSQL := `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func validateEmail(email string) bool {
    return strings.Contains(email, "@") && len(email) > 3
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Invalid request format",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Email and password are required",
        })
    }

    if !validateEmail(req.Email) {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Invalid email format",
        })
    }

    // Check rate limiting per email (CWE-307)
    if !checkRateLimit(req.Email) {
        return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
            Message: "Too many login attempts",
        })
    }

    // Get user from database using parameterized query (CWE-89)
    var user User
    query := "SELECT id, email, password_hash, name FROM users WHERE email = ?"
    err := db.QueryRow(query, req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    
    if err == sql.ErrNoRows {
        recordAttempt(req.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
            Message: "Invalid email or password",
        })
    } else if err != nil {
        // CWE-703: Handle other database errors
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Message: "Internal server error",
        })
    }

    // Verify password (CWE-522)
    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        recordAttempt(req.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
            Message: "Invalid email or password",
        })
    }

    // Generate JWT token with expiration (CWE-345)
    // Using HS256 algorithm explicitly to prevent algorithm confusion attacks (CWE-345)
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
        "iat":     time.Now().Unix(),
    })

    // Use strong secret for signing (CWE-347)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Message: "Internal server error",
        })
    }

    return c.Status(fiber.StatusOK).JSON(LoginResponse{
        Token:   tokenString,
        Message: "Login successful",
    })
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Invalid request format",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Email, password, and name are required",
        })
    }

    if !validateEmail(req.Email) {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Invalid email format",
        })
    }

    if len(req.Password) < 6 {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Password must be at least 6 characters long",
        })
    }

    if len(req.Name) > 100 {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Name is too long",
        })
    }

    // Check rate limiting for registration attempts (CWE-307)
    if !checkRateLimit(req.Email) {
        return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
            Message: "Too many registration attempts",
        })
    }

    // Check if user already exists using parameterized query (CWE-89)
    var existingUserID string
    query := "SELECT id FROM users WHERE email = ?"
    err := db.QueryRow(query, req.Email).Scan(&existingUserID)
    
    if err == nil {
        recordAttempt(req.Email)
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Message: "Email already in use",
        })
    } else if err != sql.ErrNoRows {
        // CWE-703: Handle database errors properly
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Message: "Internal server error",
        })
    }

    // Hash password properly (CWE-522)
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Message: "Internal server error",
        })
    }

    // Generate UUID for user
    userID := uuid.New().String()

    // Insert user using parameterized query (CWE-89)
    insertQuery := "INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)"
    _, err = db.Exec(insertQuery, userID, req.Email, string(hashedPassword), req.Name)
    
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Message: "Internal server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(map[string]string{
        "message": "Registration successful",
    })
}

func checkRateLimit(identifier string) bool {
    attemptsMutex.Lock()
    defer attemptsMutex.Unlock()

    now := time.Now()
    userAttempts := attempts[identifier]
    
    // Remove old attempts (older than 15 minutes)
    var validAttempts []time.Time
    for _, attempt := range userAttempts {
        if now.Sub(attempt) < 15*time.Minute {
            validAttempts = append(validAttempts, attempt)
        }
    }
    
    attempts[identifier] = validAttempts
    
    // Check if too many attempts (5 attempts per 15 minutes)
    return len(validAttempts) < 5
}

func recordAttempt(identifier string) {
    attemptsMutex.Lock()
    defer attemptsMutex.Unlock()

    attempts[identifier] = append(attempts[identifier], time.Now())
}