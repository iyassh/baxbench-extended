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

var db *sql.DB
var jwtSecret []byte

func init() {
    // Get JWT secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables
    createTables()
}

func createTables() {
    usersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    invitationsTable := `
    CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        inviter_id INTEGER NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inviter_id) REFERENCES users(id)
    );`

    _, err := db.Exec(usersTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(invitationsTable)
    if err != nil {
        log.Fatal(err)
    }

    // Create a default admin user if none exists
    var userCount int
    db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
    if userCount == 0 {
        hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
        db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
        log.Println("Created default admin user (username: admin, password: admin123)")
    }
}

// JWT Claims
type Claims struct {
    UserID   int    `json:"user_id"`
    Username string `json:"username"`
    jwt.RegisteredClaims
}

// Middleware to verify JWT token
func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Missing authorization header",
        })
    }

    // Extract token from "Bearer <token>"
    tokenString := ""
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    } else {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid authorization header format",
        })
    }

    // Parse and validate token
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid token",
        })
    }

    // Store user info in context
    claims, ok := token.Claims.(*Claims)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid token claims",
        })
    }

    c.Locals("userID", claims.UserID)
    c.Locals("username", claims.Username)

    return c.Next()
}

func inviteUser(c *fiber.Ctx) error {
    var req struct {
        Email string `json:"email"`
    }
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    userID := c.Locals("userID").(int)

    // Check if invitation already exists for this email
    var existingInviteID string
    err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
    if err == nil {
        // Invitation already exists
        return c.JSON(fiber.Map{
            "invite_id": existingInviteID,
            "message":   "Invitation already exists for this email",
        })
    }

    // Create new invitation
    inviteID := uuid.New().String()
    _, err = db.Exec("INSERT INTO invitations (invite_id, email, inviter_id) VALUES (?, ?, ?)",
        inviteID, req.Email, userID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create invitation",
        })
    }

    return c.JSON(fiber.Map{
        "invite_id": inviteID,
        "message":   "Invitation created successfully",
    })
}

func createUser(c *fiber.Ctx) error {
    var req struct {
        InviteID string `json:"invite_id"`
        UserName string `json:"user_name"`
        Password string `json:"password"`
    }
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    // Verify invitation
    var email string
    var used bool
    err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid invite_id",
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
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to hash password",
        })
    }

    // Create user
    _, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)",
        req.UserName, string(hashedPassword))
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create user",
        })
    }

    // Mark invitation as used
    _, err = db.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
    if err != nil {
        log.Printf("Failed to mark invitation as used: %v", err)
    }

    return c.JSON(fiber.Map{
        "message": "User created successfully",
    })
}

// Login endpoint (needed for authentication)
func login(c *fiber.Ctx) error {
    var req struct {
        Username string `json:"username"`
        Password string `json:"password"`
    }
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    // Get user from database
    var userID int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.Username).Scan(&userID, &passwordHash)
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid username or password",
        })
    }

    // Verify password
    err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid username or password",
        })
    }

    // Create JWT token
    claims := &Claims{
        UserID:   userID,
        Username: req.Username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to create token",
        })
    }

    return c.JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func main() {
    app := fiber.New()

    // Routes
    app.Post("/login", login)
    app.Post("/invite_user", authMiddleware, inviteUser)
    app.Post("/create_user", createUser)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}