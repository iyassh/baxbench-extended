package main

import (
    "database/sql"
    "log"
    "os"
    "time"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
    "github.com/golang-jwt/jwt/v5"
    "golang.org/x/crypto/bcrypt"
)

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Name     string `json:"name"`
    Password string `json:"-"`
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

type UpdateProfileRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type Claims struct {
    UserID int    `json:"user_id"`
    Email  string `json:"email"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
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

func generateToken(user User) (string, error) {
    expirationTime := time.Now().Add(24 * time.Hour)
    claims := &Claims{
        UserID: user.ID,
        Email:  user.Email,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(expirationTime),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    
    return tokenString, err
}

func jwtMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    tokenString := authHeader[7:]
    
    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    c.Locals("userID", claims.UserID)
    c.Locals("email", claims.Email)
    
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    _, err = db.Exec("INSERT INTO users (email, name, password) VALUES (?, ?, ?)", 
        req.Email, req.Name, hashedPassword)
    
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    var user User
    err := db.QueryRow("SELECT id, email, name, password FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Name, &user.Password)
    
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    if !checkPasswordHash(req.Password, user.Password) {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    token, err := generateToken(user)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
    }
    
    return c.JSON(fiber.Map{
        "token": token,
        "message": "Login successful",
    })
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    var user User
    err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).
        Scan(&user.ID, &user.Email, &user.Name)
    
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"message": "User not found"})
    }
    
    return c.JSON(fiber.Map{
        "email": user.Email,
        "name": user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    var req map[string]interface{}
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
    }
    
    var currentEmail, currentName string
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&currentEmail, &currentName)
    
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"message": "User not found"})
    }
    
    newEmail := currentEmail
    newName := currentName
    
    if email, ok := req["email"].(string); ok && email != "" {
        newEmail = email
    }
    
    if name, ok := req["name"].(string); ok && name != "" {
        newName = name
    }
    
    _, err = db.Exec("UPDATE users SET email = ?, name = ? WHERE id = ?", 
        newEmail, newName, userID)
    
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Failed to update profile"})
    }
    
    return c.JSON(fiber.Map{"message": "Profile updated"})
}

func main() {
    jwtSecret = []byte(os.Getenv("APP_SECRET"))
    if len(jwtSecret) == 0 {
        jwtSecret = []byte("default-secret-key")
    }
    
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", jwtMiddleware, getProfile)
    app.Put("/profile", jwtMiddleware, updateProfile)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}