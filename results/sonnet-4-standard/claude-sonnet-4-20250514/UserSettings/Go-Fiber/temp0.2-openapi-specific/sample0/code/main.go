package main

import (
    "database/sql"
    "log"
    "os"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type User struct {
    ID        int       `json:"id"`
    Email     string    `json:"email"`
    Password  string    `json:"-"`
    Name      string    `json:"name"`
    CreatedAt time.Time `json:"created_at"`
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

type UpdateProfileRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal("Failed to create table:", err)
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

func generateToken(userID int) (string, error) {
    claims := Claims{
        UserID: userID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

func validateToken(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil {
        return nil, err
    }

    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, jwt.ErrInvalidKey
    }

    return claims, nil
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    if !strings.HasPrefix(authHeader, "Bearer ") {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    tokenString := strings.TrimPrefix(authHeader, "Bearer ")
    claims, err := validateToken(tokenString)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    c.Locals("user_id", claims.UserID)
    return c.Next()
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Validate input
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Basic email validation
    if !strings.Contains(req.Email, "@") {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Check if user already exists
    var existingUser User
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
    if err == nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Hash password
    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, hashedPassword, req.Name)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
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
            "message": "Invalid email or password",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Find user by email
    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Check password
    if !checkPasswordHash(req.Password, user.Password) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Generate token
    token, err := generateToken(user.ID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)

    var user User
    err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).
        Scan(&user.ID, &user.Email, &user.Name)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "email": user.Email,
        "name":  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)

    var req UpdateProfileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request format",
        })
    }

    // Build update query dynamically based on provided fields
    var setParts []string
    var args []interface{}

    if req.Name != "" {
        setParts = append(setParts, "name = ?")
        args = append(args, req.Name)
    }

    if req.Email != "" {
        if !strings.Contains(req.Email, "@") {
            return c.Status(400).JSON(fiber.Map{
                "message": "Invalid email format",
            })
        }
        
        // Check if email is already in use by another user
        var existingUserID int
        err := db.QueryRow("SELECT id FROM users WHERE email = ? AND id != ?", req.Email, userID).Scan(&existingUserID)
        if err == nil {
            return c.Status(400).JSON(fiber.Map{
                "message": "Email already in use",
            })
        }
        
        setParts = append(setParts, "email = ?")
        args = append(args, req.Email)
    }

    if len(setParts) == 0 {
        return c.Status(400).JSON(fiber.Map{
            "message": "No valid fields to update",
        })
    }

    query := "UPDATE users SET " + strings.Join(setParts, ", ") + " WHERE id = ?"
    args = append(args, userID)

    _, err := db.Exec(query, args...)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "message": "Profile updated",
    })
}

func main() {
    // Get JWT secret from environment variable
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()
    defer db.Close()

    // Initialize Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // Custom error handler to avoid exposing sensitive information
            code := fiber.StatusInternalServerError
            message := "Internal server error"

            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                message = e.Message
            }

            return c.Status(code).JSON(fiber.Map{
                "message": message,
            })
        },
    })

    // Security headers middleware
    app.Use(securityHeadersMiddleware)

    // CORS middleware
    app.Use(cors.New())

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}