package main

import (
    "database/sql"
    "fmt"
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
var appSecret string

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

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

func main() {
    // Get app secret from environment
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-change-me"
    }

    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })

    // Security headers middleware
    app.Use(securityHeaders)

    // Routes
    app.Post("/login", login)
    app.Post("/invite_user", authenticate, inviteUser)
    app.Post("/create_user", createUser)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables if not exists
    createTables := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        invited_by_user_id INTEGER NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
    CREATE INDEX IF NOT EXISTS idx_invitations_invite_id ON invitations(invite_id);
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }

    // Create initial admin user if no users exist
    var userCount int
    err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
    if err != nil {
        log.Fatal(err)
    }

    if userCount == 0 {
        hashedPassword, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
        if err != nil {
            log.Fatal(err)
        }
        _, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
        if err != nil {
            log.Fatal(err)
        }
        log.Println("Created initial admin user (username: admin, password: admin123)")
    }
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal server error"

    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        message = e.Message
    }

    return c.Status(code).JSON(fiber.Map{
        "message": message,
    })
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func authenticate(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Missing authorization header",
        })
    }

    tokenString := strings.TrimPrefix(authHeader, "Bearer ")
    if tokenString == authHeader {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid authorization header format",
        })
    }

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method")
        }
        return []byte(appSecret), nil
    })

    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid token",
        })
    }

    c.Locals("userID", claims.UserID)
    return c.Next()
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if req.UserName == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Username and password are required",
        })
    }

    var userID int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.UserName).Scan(&userID, &passwordHash)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "message": "Invalid credentials",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid credentials",
        })
    }

    // Create JWT token
    claims := &Claims{
        UserID: userID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create token",
        })
    }

    return c.JSON(fiber.Map{
        "token": tokenString,
    })
}

func inviteUser(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var req InviteRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if req.Email == "" || !isValidEmail(req.Email) {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }

    // Check if invitation already exists for this email
    var existingInviteID string
    err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE", req.Email).Scan(&existingInviteID)
    if err == nil {
        return c.JSON(fiber.Map{
            "invite_id": existingInviteID,
            "message": "Invitation already exists for this email",
        })
    } else if err != sql.ErrNoRows {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Create new invitation
    inviteID := uuid.New().String()
    _, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by_user_id) VALUES (?, ?, ?)",
        inviteID, req.Email, userID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create invitation",
        })
    }

    return c.JSON(fiber.Map{
        "invite_id": inviteID,
        "message": "Invitation created successfully",
    })
}

func createUser(c *fiber.Ctx) error {
    var req CreateUserRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if req.InviteID == "" || req.UserName == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "All fields are required",
        })
    }

    // Validate username (alphanumeric and underscores only)
    if !isValidUsername(req.UserName) {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid username format",
        })
    }

    // Validate password strength
    if len(req.Password) < 8 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Password must be at least 8 characters long",
        })
    }

    // Verify invitation
    var email string
    var used bool
    err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "message": "Invalid invite_id",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    if used {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid invite_id",
        })
    }

    // Check if username already exists
    var existingUser int
    err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
    if err == nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Username already exists. Try providing different username.",
        })
    } else if err != sql.ErrNoRows {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to process password",
        })
    }

    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }
    defer tx.Rollback()

    // Insert user
    _, err = tx.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", req.UserName, string(hashedPassword))
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create user",
        })
    }

    // Mark invitation as used
    _, err = tx.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to update invitation",
        })
    }

    // Commit transaction
    if err := tx.Commit(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to complete user creation",
        })
    }

    return c.JSON(fiber.Map{
        "message": "User created successfully",
    })
}

func isValidEmail(email string) bool {
    // Simple email validation
    parts := strings.Split(email, "@")
    if len(parts) != 2 {
        return false
    }
    if len(parts[0]) == 0 || len(parts[1]) == 0 {
        return false
    }
    domainParts := strings.Split(parts[1], ".")
    if len(domainParts) < 2 {
        return false
    }
    for _, part := range domainParts {
        if len(part) == 0 {
            return false
        }
    }
    return true
}

func isValidUsername(username string) bool {
    if len(username) == 0 || len(username) > 50 {
        return false
    }
    for _, ch := range username {
        if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_') {
            return false
        }
    }
    return true
}