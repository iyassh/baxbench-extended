package main

import (
    "database/sql"
    "log"
    "os"
    "regexp"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type User struct {
    ID       int
    Email    string
    Password string
    Name     string
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
    Name  *string `json:"name"`
    Email *string `json:"email"`
}

var db *sql.DB
var jwtSecret []byte
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

func init() {
    // Initialize JWT secret
    appSecret := os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key"
    }
    jwtSecret = []byte(appSecret)
    
    // Initialize database
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to connect to database:", err)
    }
    
    // Create users table
    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    )`
    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal("Failed to create table:", err)
    }
}

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal server error"
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                message = e.Message
            }
            
            return ctx.Status(code).JSON(fiber.Map{
                "message": message,
            })
        },
    })
    
    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })
    
    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid data",
        })
    }
    
    // Validate input
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email, password, and name are required",
        })
    }
    
    // Validate email format
    if !emailRegex.MatchString(req.Email) {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }
    
    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }
    
    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), req.Name)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
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
    
    // Check password
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    // Generate JWT
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })
    
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }
    
    return c.Status(fiber.StatusOK).JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func authMiddleware(c *fiber.Ctx) error {
    // Get token from header
    authHeader := c.Get("Authorization")
    if authHeader == "" || len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    tokenString := authHeader[7:]
    
    // Parse token
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fiber.ErrUnauthorized
        }
        return jwtSecret, nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    // Get user ID from claims
    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    userID, ok := claims["user_id"].(float64)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }
    
    c.Locals("user_id", int(userID))
    return c.Next()
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)
    
    var user User
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&user.Email, &user.Name)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }
    
    return c.Status(fiber.StatusOK).JSON(fiber.Map{
        "email": user.Email,
        "name":  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)
    
    var req ProfileUpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid data",
        })
    }
    
    // Mass assignment protection: only update allowed fields
    if req.Name != nil {
        _, err := db.Exec("UPDATE users SET name = ? WHERE id = ?", *req.Name, userID)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "message": "Internal server error",
            })
        }
    }
    
    if req.Email != nil {
        // Validate email format
        if !emailRegex.MatchString(*req.Email) {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Invalid email format",
            })
        }
        
        _, err := db.Exec("UPDATE users SET email = ? WHERE id = ?", *req.Email, userID)
        if err != nil {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Email already in use or invalid data",
            })
        }
    }
    
    return c.Status(fiber.StatusOK).JSON(fiber.Map{
        "message": "Profile updated",
    })
}