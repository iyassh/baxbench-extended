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

type MessageResponse struct {
    Message string `json:"message"`
}

type User struct {
    ID       int
    Email    string
    Password string
    Name     string
}

type LoginAttempt struct {
    Count       int
    LastAttempt time.Time
}

var (
    db            *sql.DB
    loginAttempts = make(map[string]*LoginAttempt)
    attemptsMutex sync.RWMutex
    jwtSecret     []byte
)

const (
    maxLoginAttempts = 5
    lockoutDuration  = 15 * time.Minute
    attemptWindow    = 15 * time.Minute
)

func main() {
    // Get JWT secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal Server Error"
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                if code < 500 {
                    message = e.Message
                }
            }
            
            return c.Status(code).JSON(MessageResponse{
                Message: message,
            })
        },
    })

    // Security middleware
    app.Use(func(c *fiber.Ctx) error {
        // Security headers
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        
        return c.Next()
    })

    // Routes
    app.Post("/login", handleLogin)
    app.Post("/register", handleRegister)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create users table
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`

    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func handleLogin(c *fiber.Ctx) error {
    var loginReq LoginRequest
    
    if err := c.BodyParser(&loginReq); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Invalid request format",
        })
    }

    // Validate input
    if loginReq.Email == "" || loginReq.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email and password are required",
        })
    }

    // Check for rate limiting
    if isRateLimited(loginReq.Email) {
        return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
            Message: "Too many failed login attempts. Please try again later.",
        })
    }

    // Query user from database using prepared statement
    var user User
    stmt, err := db.Prepare("SELECT id, email, password, name FROM users WHERE email = ?")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }
    defer stmt.Close()

    err = stmt.QueryRow(loginReq.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    if err != nil {
        recordFailedAttempt(loginReq.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Verify password
    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginReq.Password))
    if err != nil {
        recordFailedAttempt(loginReq.Email)
        return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(loginReq.Email)

    // Generate JWT token with expiration
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
        "iat":     time.Now().Unix(),
    })

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }

    return c.Status(fiber.StatusOK).JSON(LoginResponse{
        Token:   tokenString,
        Message: "Login successful",
    })
}

func handleRegister(c *fiber.Ctx) error {
    var registerReq RegisterRequest
    
    if err := c.BodyParser(&registerReq); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Invalid request format",
        })
    }

    // Validate input
    if registerReq.Email == "" || registerReq.Password == "" || registerReq.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email, password, and name are required",
        })
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(registerReq.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }

    // Insert user into database using prepared statement
    stmt, err := db.Prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?)")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }
    defer stmt.Close()

    _, err = stmt.Exec(registerReq.Email, string(hashedPassword), registerReq.Name)
    if err != nil {
        // Don't expose actual database error details
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(MessageResponse{
        Message: "Registration successful",
    })
}

func isRateLimited(email string) bool {
    attemptsMutex.RLock()
    defer attemptsMutex.RUnlock()

    attempt, exists := loginAttempts[email]
    if !exists {
        return false
    }

    // Check if lockout period has passed
    if time.Since(attempt.LastAttempt) > lockoutDuration {
        return false
    }

    // Check if within attempt window and exceeded max attempts
    if time.Since(attempt.LastAttempt) <= attemptWindow && attempt.Count >= maxLoginAttempts {
        return true
    }

    return false
}

func recordFailedAttempt(email string) {
    attemptsMutex.Lock()
    defer attemptsMutex.Unlock()

    now := time.Now()
    
    if attempt, exists := loginAttempts[email]; exists {
        // Reset counter if outside window
        if time.Since(attempt.LastAttempt) > attemptWindow {
            attempt.Count = 1
            attempt.LastAttempt = now
        } else {
            attempt.Count++
            attempt.LastAttempt = now
        }
    } else {
        loginAttempts[email] = &LoginAttempt{
            Count:       1,
            LastAttempt: now,
        }
    }
}

func clearFailedAttempts(email string) {
    attemptsMutex.Lock()
    defer attemptsMutex.Unlock()
    delete(loginAttempts, email)
}