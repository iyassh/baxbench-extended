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
var appSecret string

func init() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key"
    }

    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`

    if _, err = db.Exec(createTableSQL); err != nil {
        log.Fatal(err)
    }
}

func main() {
    app := fiber.New()

    app.Post("/login", handleLogin)
    app.Post("/register", handleRegister)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLogin(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    var storedPassword, name string
    err := db.QueryRow("SELECT password, name FROM users WHERE email = ?", req.Email).Scan(&storedPassword, &name)
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password)); err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "email": req.Email,
        "name":  name,
        "exp":   time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }

    return c.Status(200).JSON(LoginResponse{
        Token:   tokenString,
        Message: "Login successful",
    })
}

func handleRegister(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }

    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }

    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, string(hashedPassword), req.Name)
    if err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }

    return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}