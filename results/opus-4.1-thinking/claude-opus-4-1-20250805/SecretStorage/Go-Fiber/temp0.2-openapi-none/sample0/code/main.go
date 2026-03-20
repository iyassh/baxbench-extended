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

var db *sql.DB
var appSecret string

type RegisterRequest struct {
    Email    string `json:"email"`
    Username string `json:"username"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type SetSecretRequest struct {
    Username string `json:"username"`
    Secret   string `json:"secret"`
}

type Claims struct {
    UserID   int    `json:"user_id"`
    Username string `json:"username"`
    jwt.RegisteredClaims
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create tables if they don't exist
    createUsersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    );`
    
    createSecretsTable := `
    CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        secret TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
    );`
    
    _, err = db.Exec(createUsersTable)
    if err != nil {
        log.Fatal(err)
    }
    
    _, err = db.Exec(createSecretsTable)
    if err != nil {
        log.Fatal(err)
    }
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }
    
    // Check if it starts with "Bearer "
    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }
    
    tokenString := authHeader[7:]
    
    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return []byte(appSecret), nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }
    
    c.Locals("userID", claims.UserID)
    c.Locals("username", claims.Username)
    
    return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    // Validate input
    if req.Email == "" || req.Username == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    // Insert user
    _, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
        req.Email, req.Username, string(hashedPassword))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    // Find user
    var userID int
    var username, passwordHash string
    err := db.QueryRow("SELECT id, username, password_hash FROM users WHERE email = ?", req.Email).
        Scan(&userID, &username, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    // Verify password
    err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    // Generate JWT token
    claims := &Claims{
        UserID:   userID,
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    return c.JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func setSecretHandler(c *fiber.Ctx) error {
    var req SetSecretRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
    }
    
    userID := c.Locals("userID").(int)
    username := c.Locals("username").(string)
    
    // Verify the username matches
    if req.Username != username {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }
    
    // Check if secret already exists
    var existingID int
    err := db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", userID).Scan(&existingID)
    
    if err == sql.ErrNoRows {
        // Insert new secret
        _, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", userID, req.Secret)
    } else if err == nil {
        // Update existing secret
        _, err = db.Exec("UPDATE secrets SET secret = ? WHERE user_id = ?", req.Secret, userID)
    }
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    return c.JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecretHandler(c *fiber.Ctx) error {
    requestedUsername := c.Query("username")
    if requestedUsername == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Username required"})
    }
    
    authenticatedUsername := c.Locals("username").(string)
    
    // Users can only get their own secrets
    if requestedUsername != authenticatedUsername {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }
    
    userID := c.Locals("userID").(int)
    
    var secret string
    err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).JSON(fiber.Map{"message": "Secret not found"})
        }
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    return c.JSON(fiber.Map{"secret": secret})
}

func main() {
    // Get app secret from environment
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-change-in-production"
    }
    
    // Initialize database
    initDB()
    defer db.Close()
    
    // Create Fiber app
    app := fiber.New()
    
    // Routes
    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)
    app.Post("/set_secret", authMiddleware, setSecretHandler)
    app.Get("/get_secret", authMiddleware, getSecretHandler)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}