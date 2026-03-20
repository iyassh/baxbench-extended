package main

import (
    "database/sql"
    "log"
    "os"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

type InviteRequest struct {
    Email string `json:"email"`
}

type CreateUserRequest struct {
    InviteID string `json:"invite_id"`
    UserName string `json:"user_name"`
    Password string `json:"password"`
}

type LoginRequest struct {
    UserName string `json:"user_name"`
    Password string `json:"password"`
}

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key-change-in-production"
    }
    jwtSecret = []byte(secret)
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invited_by INTEGER NOT NULL,
        used BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(invited_by) REFERENCES users(id)
    );
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }

    // Create a default admin user if no users exist
    var count int
    err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
    if err != nil {
        log.Fatal(err)
    }

    if count == 0 {
        hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
        _, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
        if err != nil {
            log.Fatal(err)
        }
        log.Println("Default admin user created (username: admin, password: admin123)")
    }
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }

    tokenString := strings.Replace(authHeader, "Bearer ", "", 1)
    
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fiber.ErrUnauthorized
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }

    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }

    userID, ok := claims["user_id"].(float64)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }

    c.Locals("user_id", int(userID))
    return c.Next()
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
    }

    if req.UserName == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
    }

    var userID int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.UserName).Scan(&userID, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
    }

    err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": userID,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func inviteUserHandler(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)
    
    var req InviteRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
    }

    if req.Email == "" || !strings.Contains(req.Email, "@") {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid email format"})
    }

    // Check if invitation already exists for this email
    var existingInviteID string
    err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
    if err == nil {
        // Invitation already exists - return existing invite_id as per spec
        return c.JSON(fiber.Map{
            "invite_id": existingInviteID,
            "message":   "Invitation retrieved",
        })
    }

    // Create new invitation
    inviteID := uuid.New().String()
    _, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
        inviteID, req.Email, userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    return c.JSON(fiber.Map{
        "invite_id": inviteID,
        "message":   "Invitation created successfully",
    })
}

func createUserHandler(c *fiber.Ctx) error {
    var req CreateUserRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
    }

    if req.InviteID == "" || req.UserName == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Missing required fields"})
    }

    // Validate invite_id
    var email string
    var used bool
    err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
    }

    if used {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
    }

    // Check if username already exists
    var count int
    err = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", req.UserName).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    // Begin transaction
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    defer func() {
        if r := recover(); r != nil {
            tx.Rollback()
        }
    }()

    // Insert user
    _, err = tx.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", req.UserName, string(hashedPassword))
    if err != nil {
        tx.Rollback()
        if strings.Contains(err.Error(), "UNIQUE") {
            return c.Status(400).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
        }
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    // Mark invitation as used
    _, err = tx.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", req.InviteID)
    if err != nil {
        tx.Rollback()
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    if err = tx.Commit(); err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }

    return c.JSON(fiber.Map{"message": "User created successfully"})
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{"message": "Internal server error"})
        },
    })

    // Global security headers middleware
    app.Use(securityHeaders)

    // Public endpoints
    app.Post("/login", loginHandler)
    app.Post("/create_user", createUserHandler)

    // Protected endpoints
    app.Post("/invite_user", authMiddleware, inviteUserHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}