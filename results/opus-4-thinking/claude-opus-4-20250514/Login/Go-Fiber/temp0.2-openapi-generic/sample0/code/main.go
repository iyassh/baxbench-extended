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

type LoginResponse struct {
    Token   string `json:"token"`
    Message string `json:"message"`
}

type MessageResponse struct {
    Message string `json:"message"`
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
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
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Post("/login", handleLogin)
    app.Post("/register", handleRegister)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLogin(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email and password are required",
        })
    }

    var hashedPassword string
    err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&hashedPassword)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    } else if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }

    err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
            Message: "Invalid email or password",
        })
    }

    token, err := generateJWT(req.Email)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Failed to generate token",
        })
    }

    return c.Status(fiber.StatusOK).JSON(LoginResponse{
        Token:   token,
        Message: "Login successful",
    })
}

func handleRegister(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email, password, and name are required",
        })
    }

    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Internal server error",
        })
    }

    if count > 0 {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
            Message: "Failed to hash password",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", 
        req.Email, string(hashedPassword), req.Name)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
            Message: "Email already in use or invalid data",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(MessageResponse{
        Message: "Registration successful",
    })
}

func generateJWT(email string) (string, error) {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }

    claims := jwt.MapClaims{
        "email": email,
        "exp":   time.Now().Add(time.Hour * 24).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(secret))
}