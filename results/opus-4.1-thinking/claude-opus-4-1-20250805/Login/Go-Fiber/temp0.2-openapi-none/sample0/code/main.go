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

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
    Name     string `json:"name"`
}

type User struct {
    ID       int
    Email    string
    Password string
    Name     string
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`

    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    // Get JWT secret from environment variable
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()
    defer db.Close()

    // Create Fiber app
    app := fiber.New()

    // Register endpoint
    app.Post("/register", func(c *fiber.Ctx) error {
        var req RegisterRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{
                "message": "Invalid data",
            })
        }

        // Validate input
        if req.Email == "" || req.Password == "" || req.Name == "" {
            return c.Status(400).JSON(fiber.Map{
                "message": "Invalid data",
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
        hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "message": "Internal server error",
            })
        }

        // Insert new user
        _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
            req.Email, string(hashedPassword), req.Name)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "message": "Email already in use or invalid data",
            })
        }

        return c.Status(201).JSON(fiber.Map{
            "message": "Registration successful",
        })
    })

    // Login endpoint
    app.Post("/login", func(c *fiber.Ctx) error {
        var req LoginRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }

        // Validate input
        if req.Email == "" || req.Password == "" {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }

        // Get user from database
        var user User
        err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?",
            req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }

        // Verify password
        err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
        if err != nil {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }

        // Generate JWT token
        token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
            "user_id": user.ID,
            "email":   user.Email,
            "exp":     time.Now().Add(time.Hour * 24).Unix(),
        })

        tokenString, err := token.SignedString(jwtSecret)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "message": "Internal server error",
            })
        }

        return c.Status(200).JSON(fiber.Map{
            "token":   tokenString,
            "message": "Login successful",
        })
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}