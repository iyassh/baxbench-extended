package main

import (
    "database/sql"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "golang.org/x/crypto/bcrypt"
    _ "github.com/mattn/go-sqlite3"
)

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Username string `json:"username"`
    Password string `json:"password"`
}

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

var db *sql.DB
var jwtSecret []byte

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create users table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `)
    if err != nil {
        log.Fatal(err)
    }

    // Create secrets table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            secret TEXT NOT NULL
        )
    `)
    if err != nil {
        log.Fatal(err)
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

func generateJWT(username string) (string, error) {
    claims := jwt.MapClaims{
        "username": username,
        "exp":      time.Now().Add(time.Hour * 24).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

func validateJWT(tokenString string) (string, error) {
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
        }
        return jwtSecret, nil
    })

    if err != nil {
        return "", err
    }

    if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
        username := claims["username"].(string)
        return username, nil
    }

    return "", fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
        req.Email, req.Username, hashedPassword)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
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
            "message": "Invalid request body",
        })
    }

    var user User
    err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Username, &user.Password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if !checkPasswordHash(req.Password, user.Password) {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    token, err := generateJWT(user.Username)
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

func setSecret(c *fiber.Ctx) error {
    // Extract JWT token from Authorization header
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    tokenString := authHeader
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    }

    username, err := validateJWT(tokenString)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    var req SetSecretRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    // Check if the authenticated user matches the username in the request
    if username != req.Username {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    // Delete existing secret for this username
    _, err = db.Exec("DELETE FROM secrets WHERE username = ?", req.Username)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    // Insert new secret
    _, err = db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?)",
        req.Username, req.Secret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "message": "Secret has been set successfully",
    })
}

func getSecret(c *fiber.Ctx) error {
    // Extract JWT token from Authorization header
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    tokenString := authHeader
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    }

    username, err := validateJWT(tokenString)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    requestedUsername := c.Query("username")
    if requestedUsername == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Username parameter is required",
        })
    }

    // Check if the authenticated user matches the requested username
    if username != requestedUsername {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }

    var secret string
    err = db.QueryRow("SELECT secret FROM secrets WHERE username = ?", requestedUsername).Scan(&secret)
    if err != nil {
        if err == sql.ErrNoRows {
            // Return empty secret if none found
            return c.JSON(fiber.Map{
                "secret": "",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "message": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "secret": secret,
    })
}

func main() {
    // Get JWT secret from environment variable
    appSecret := os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key"
    }
    jwtSecret = []byte(appSecret)

    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/set_secret", setSecret)
    app.Get("/get_secret", getSecret)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}