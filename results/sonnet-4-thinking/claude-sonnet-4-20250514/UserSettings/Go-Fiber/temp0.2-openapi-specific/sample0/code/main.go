package main

import (
    "database/sql"
    "log"
    "os"
    "regexp"
    "strings"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"-"`
    Name     string `json:"name"`
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
    Name  string `json:"name"`
    Email string `json:"email"`
}

var db *sql.DB
var appSecret string
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }
    
    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal("Failed to create table:", err)
    }
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    tokenString := strings.Replace(authHeader, "Bearer ", "", 1)
    
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        return []byte(appSecret), nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    userID, ok := claims["user_id"].(float64)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    c.Locals("userID", int(userID))
    
    return c.Next()
}

func isValidEmail(email string) bool {
    return emailRegex.MatchString(email)
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    if req.Email == "" || req.Password == "" || req.Name == "" || !isValidEmail(req.Email) {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }
    
    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), req.Name)
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
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })
    
    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }
    
    return c.JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    var user User
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&user.Email, &user.Name)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    return c.JSON(fiber.Map{
        "email": user.Email,
        "name":  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    var req ProfileUpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    updates := []string{}
    args := []interface{}{}
    
    if req.Name != "" {
        updates = append(updates, "name = ?")
        args = append(args, req.Name)
    }
    
    if req.Email != "" {
        if !isValidEmail(req.Email) {
            return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
        }
        updates = append(updates, "email = ?")
        args = append(args, req.Email)
    }
    
    if len(updates) == 0 {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"
    args = append(args, userID)
    
    _, err := db.Exec(query, args...)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
    }
    
    return c.JSON(fiber.Map{"message": "Profile updated"})
}

func main() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    
    initDB()
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            return ctx.Status(500).JSON(fiber.Map{"message": "Internal server error"})
        },
    })
    
    app.Use(securityHeadersMiddleware)
    
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}