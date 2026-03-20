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

var db *sql.DB
var jwtSecret []byte

type User struct {
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
    Username string `json:"username"`
    jwt.RegisteredClaims
}

func init() {
    // Get JWT secret from env
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key" // Default for development
    }
    jwtSecret = []byte(secret)

    // Initialize database
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables if they don't exist
    createTables()
}

func createTables() {
    userTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    );`

    secretTable := `
    CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        secret TEXT NOT NULL,
        FOREIGN KEY (username) REFERENCES users(username)
    );`

    _, err := db.Exec(userTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(secretTable)
    if err != nil {
        log.Fatal(err)
    }
}

func registerHandler(c *fiber.Ctx) error {
    var user User
    if err := c.BodyParser(&user); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Validate input
    if user.Email == "" || user.Username == "" || user.Password == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Check if email or username already exists
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ? OR username = ?", user.Email, user.Username).Scan(&count)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    if count > 0 {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)", 
        user.Email, user.Username, string(hashedPassword))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func loginHandler(c *fiber.Ctx) error {
    var loginReq LoginRequest
    if err := c.BodyParser(&loginReq); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Find user by email
    var username, passwordHash string
    err := db.QueryRow("SELECT username, password_hash FROM users WHERE email = ?", loginReq.Email).
        Scan(&username, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(loginReq.Password)); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    // Generate JWT token
    claims := &Claims{
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Failed to generate token",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func authMiddleware(c *fiber.Ctx) error {
    // Determine error message based on endpoint
    errorMsg := "Invalid authentication token"
    if strings.HasPrefix(c.Path(), "/set_secret") {
        errorMsg = "Invalid authentication token "
    }

    // Extract token from Authorization header
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": errorMsg,
        })
    }

    // Remove "Bearer " prefix
    tokenString := ""
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    } else {
        return c.Status(401).JSON(fiber.Map{
            "message": errorMsg,
        })
    }

    // Parse and validate token
    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{
            "message": errorMsg,
        })
    }

    // Store username in context
    c.Locals("username", claims.Username)
    return c.Next()
}

func setSecretHandler(c *fiber.Ctx) error {
    var req SetSecretRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid data",
        })
    }

    // Get authenticated username
    authUsername := c.Locals("username").(string)

    // Verify that the authenticated user is setting their own secret
    if authUsername != req.Username {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token ",
        })
    }

    // Check if secret already exists for this user
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM secrets WHERE username = ?", req.Username).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Database error",
        })
    }

    if count > 0 {
        // Update existing secret
        _, err = db.Exec("UPDATE secrets SET secret = ? WHERE username = ?", req.Secret, req.Username)
    } else {
        // Insert new secret
        _, err = db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?)", req.Username, req.Secret)
    }

    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Failed to save secret",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "message": "Secret has been set successfully",
    })
}

func getSecretHandler(c *fiber.Ctx) error {
    username := c.Query("username")
    if username == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Username is required",
        })
    }

    // Get authenticated username
    authUsername := c.Locals("username").(string)

    // Verify that the authenticated user is getting their own secret
    if authUsername != username {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    // Get secret from database
    var secret string
    err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
    if err != nil {
        if err == sql.ErrNoRows {
            // Return empty secret if not found
            return c.Status(200).JSON(fiber.Map{
                "secret": "",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "message": "Database error",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "secret": secret,
    })
}

func main() {
    app := fiber.New()

    // Routes without authentication
    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)

    // Routes with authentication
    app.Post("/set_secret", authMiddleware, setSecretHandler)
    app.Get("/get_secret", authMiddleware, getSecretHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}