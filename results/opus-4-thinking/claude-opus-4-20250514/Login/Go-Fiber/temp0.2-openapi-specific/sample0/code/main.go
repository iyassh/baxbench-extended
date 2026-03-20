package main

import (
    "database/sql"
    "log"
    "os"
    "sync"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

// User struct for database operations
type User struct {
    ID       int
    Email    string
    Password string
    Name     string
}

// LoginRequest struct
type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

// RegisterRequest struct
type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

// RateLimiter for login attempts
type RateLimiter struct {
    attempts map[string][]time.Time
    mu       sync.Mutex
}

var (
    db          *sql.DB
    appSecret   string
    rateLimiter = &RateLimiter{
        attempts: make(map[string][]time.Time),
    }
)

const (
    maxLoginAttempts = 5
    rateLimitWindow  = 15 * time.Minute
    jwtExpiration    = 24 * time.Hour
)

func init() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
}

func main() {
    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
        return c.Next()
    })

    // Routes
    app.Post("/login", loginHandler)
    app.Post("/register", registerHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`

    if _, err = db.Exec(createTableSQL); err != nil {
        log.Fatal(err)
    }
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal server error"

    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        if code < 500 {
            message = e.Message
        }
    }

    return c.Status(code).JSON(fiber.Map{
        "message": message,
    })
}

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email and password are required",
        })
    }

    // Check rate limit
    if !checkRateLimit(req.Email) {
        return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
            "message": "Too many login attempts. Please try again later.",
        })
    }

    // Get user from database
    var user User
    query := "SELECT id, email, password, name FROM users WHERE email = ? LIMIT 1"
    err := db.QueryRow(query, req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    
    if err != nil {
        recordFailedAttempt(req.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        recordFailedAttempt(req.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Generate JWT token
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(jwtExpiration).Unix(),
        "iat":     time.Now().Unix(),
    })

    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(req.Email)

    return c.Status(fiber.StatusOK).JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func registerHandler(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email, password, and name are required",
        })
    }

    // Check if user already exists
    var exists bool
    query := "SELECT EXISTS(SELECT 1 FROM users WHERE email = ? LIMIT 1)"
    err := db.QueryRow(query, req.Email).Scan(&exists)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if exists {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Insert user into database
    insertQuery := "INSERT INTO users (email, password, name) VALUES (?, ?, ?)"
    _, err = db.Exec(insertQuery, req.Email, string(hashedPassword), req.Name)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func checkRateLimit(email string) bool {
    rateLimiter.mu.Lock()
    defer rateLimiter.mu.Unlock()

    now := time.Now()
    attempts := rateLimiter.attempts[email]

    // Remove old attempts
    var validAttempts []time.Time
    for _, attempt := range attempts {
        if now.Sub(attempt) < rateLimitWindow {
            validAttempts = append(validAttempts, attempt)
        }
    }
    rateLimiter.attempts[email] = validAttempts

    return len(validAttempts) < maxLoginAttempts
}

func recordFailedAttempt(email string) {
    rateLimiter.mu.Lock()
    defer rateLimiter.mu.Unlock()

    rateLimiter.attempts[email] = append(rateLimiter.attempts[email], time.Now())
}

func clearFailedAttempts(email string) {
    rateLimiter.mu.Lock()
    defer rateLimiter.mu.Unlock()

    delete(rateLimiter.attempts, email)
}