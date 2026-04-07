package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type User struct {
    ID       string
    Email    string
    Password string
    Name     string
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

type ProfileUpdateRequest struct {
    Name  *string `json:"name,omitempty"`
    Email *string `json:"email,omitempty"`
}

type ProfileResponse struct {
    Email string `json:"email"`
    Name  string `json:"name"`
}

type MessageResponse struct {
    Message string `json:"message"`
}

type LoginResponse struct {
    Token   string `json:"token"`
    Message string `json:"message"`
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
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableQuery)
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

func generateJWT(userID string) (string, error) {
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": userID,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })
    
    tokenString, err := token.SignedString(jwtSecret)
    return tokenString, err
}

func validateJWT(tokenString string) (string, error) {
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method")
        }
        return jwtSecret, nil
    })
    
    if err != nil {
        return "", err
    }
    
    if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
        userID := claims["user_id"].(string)
        return userID, nil
    }
    
    return "", fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
    }
    
    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
    }
    
    token := authHeader[7:]
    userID, err := validateJWT(token)
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
    }
    
    c.Locals("user_id", userID)
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }
    
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }
    
    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Server error"})
    }
    
    userID := uuid.New().String()
    _, err = db.Exec("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)",
        userID, req.Email, hashedPassword, req.Name)
    
    if err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
    }
    
    return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    if !checkPasswordHash(req.Password, user.Password) {
        return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
    }
    
    token, err := generateJWT(user.ID)
    if err != nil {
        return c.Status(500).JSON(MessageResponse{Message: "Server error"})
    }
    
    return c.Status(200).JSON(LoginResponse{
        Token:   token,
        Message: "Login successful",
    })
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(string)
    
    var user User
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&user.Email, &user.Name)
    
    if err != nil {
        return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
    }
    
    return c.Status(200).JSON(ProfileResponse{
        Email: user.Email,
        Name:  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(string)
    
    var req ProfileUpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
    }
    
    if req.Name != nil {
        _, err := db.Exec("UPDATE users SET name = ? WHERE id = ?", *req.Name, userID)
        if err != nil {
            return c.Status(500).JSON(MessageResponse{Message: "Server error"})
        }
    }
    
    if req.Email != nil {
        _, err := db.Exec("UPDATE users SET email = ? WHERE id = ?", *req.Email, userID)
        if err != nil {
            return c.Status(400).JSON(MessageResponse{Message: "Email already in use"})
        }
    }
    
    return c.Status(200).JSON(MessageResponse{Message: "Profile updated"})
}

func main() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)
    
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}