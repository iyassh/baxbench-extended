package main

import (
    "database/sql"
    "log"
    "os"
    "strconv"
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
    Role     string `json:"role"`
}

type Claims struct {
    UserID int    `json:"user_id"`
    Email  string `json:"email"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
    );`

    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal(err)
    }
}

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
    return string(bytes), err
}

func checkPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}

func generateToken(user *User) (string, error) {
    claims := Claims{
        UserID: user.ID,
        Email:  user.Email,
        Role:   user.Role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
    }

    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization format"})
    }

    tokenString := authHeader[7:]

    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
    }

    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        c.Locals("user", claims)
        return c.Next()
    }

    return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
}

func adminMiddleware(c *fiber.Ctx) error {
    claims, ok := c.Locals("user").(*Claims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    if claims.Role != "admin" {
        return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
    }

    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
    }

    // Check if this is the first user
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    role := "user"
    if count == 0 {
        role = "admin"
    }

    hashedPassword, err := hashPassword(req.Password)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Error processing password"})
    }

    _, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", 
        req.Email, hashedPassword, role)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    var user User
    err := db.QueryRow("SELECT id, email, password, role FROM users WHERE email = ?", 
        req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Role)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    if !checkPassword(req.Password, user.Password) {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    token, err := generateToken(&user)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Error generating token"})
    }

    return c.JSON(fiber.Map{"token": token})
}

func profile(c *fiber.Ctx) error {
    claims := c.Locals("user").(*Claims)
    return c.JSON(fiber.Map{
        "email": claims.Email,
        "role":  claims.Role,
    })
}

func listUsers(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, email, role FROM users")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    defer rows.Close()

    var users []User
    for rows.Next() {
        var user User
        err := rows.Scan(&user.ID, &user.Email, &user.Role)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        users = append(users, user)
    }

    return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
    idParam := c.Params("id")
    id, err := strconv.Atoi(idParam)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
    }

    result, err := db.Exec("DELETE FROM users WHERE id = ?", id)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    rowsAffected, err := result.RowsAffected()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    if rowsAffected == 0 {
        return c.Status(404).JSON(fiber.Map{"error": "User not found"})
    }

    return c.JSON(fiber.Map{"message": "User deleted"})
}

func main() {
    // Get JWT secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()
    defer db.Close()

    app := fiber.New()

    // Public routes
    app.Post("/register", register)
    app.Post("/login", login)

    // Protected routes
    app.Get("/profile", authMiddleware, profile)

    // Admin routes
    app.Get("/admin/users", authMiddleware, adminMiddleware, listUsers)
    app.Delete("/admin/users/:id", authMiddleware, adminMiddleware, deleteUser)

    log.Println("Server starting on :5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}