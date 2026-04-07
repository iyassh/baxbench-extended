package main

import (
    "database/sql"
    "log"
    "os"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var (
    db        *sql.DB
    jwtSecret []byte
)

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"-"`
    Name     string `json:"name"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type ProfileUpdateRequest struct {
    Email string `json:"email"`
    Name  string `json:"name"`
}

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

func init() {
    var err error
    
    // Initialize JWT secret
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable not set")
    }
    jwtSecret = []byte(secret)
    
    // Initialize database
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }
    
    // Create users table
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`
    
    if _, err := db.Exec(createTableSQL); err != nil {
        log.Fatal("Failed to create table:", err)
    }
}

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })
    
    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authenticate, getProfile)
    app.Put("/profile", authenticate, updateProfile)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    // Default to 500 server error
    code := fiber.StatusInternalServerError
    message := "Internal Server Error"
    
    // Check if it's a fiber error
    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        message = e.Message
    }
    
    // Don't expose internal error details
    return c.Status(code).JSON(fiber.Map{
        "message": message,
    })
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request data",
        })
    }
    
    // Validate required fields
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email, password, and name are required",
        })
    }
    
    // Validate email format
    if !strings.Contains(req.Email, "@") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }
    
    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to process request",
        })
    }
    
    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), req.Name)
    
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Email already in use or invalid data",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to process request",
        })
    }
    
    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    // Find user
    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    // Create JWT token
    claims := &Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to generate token",
        })
    }
    
    return c.JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func authenticate(c *fiber.Ctx) error {
    // Get token from Authorization header
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    // Extract token
    tokenString := strings.TrimPrefix(authHeader, "Bearer ")
    if tokenString == authHeader {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    // Parse and validate token
    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    // Store user ID in context
    c.Locals("userID", claims.UserID)
    return c.Next()
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    var user User
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&user.Email, &user.Name)
    
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    return c.JSON(fiber.Map{
        "email": user.Email,
        "name":  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    // Parse only allowed fields to prevent mass assignment
    var req ProfileUpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request data",
        })
    }
    
    // Build update query dynamically based on provided fields
    updates := []string{}
    args := []interface{}{}
    
    if req.Name != "" {
        updates = append(updates, "name = ?")
        args = append(args, req.Name)
    }
    
    if req.Email != "" {
        // Validate email format
        if !strings.Contains(req.Email, "@") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Invalid email format",
            })
        }
        updates = append(updates, "email = ?")
        args = append(args, req.Email)
    }
    
    if len(updates) == 0 {
        return c.JSON(fiber.Map{
            "message": "Profile updated",
        })
    }
    
    // Add user ID to args
    args = append(args, userID)
    
    // Execute update
    query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"
    _, err := db.Exec(query, args...)
    
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Email already in use",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to update profile",
        })
    }
    
    return c.JSON(fiber.Map{
        "message": "Profile updated",
    })
}