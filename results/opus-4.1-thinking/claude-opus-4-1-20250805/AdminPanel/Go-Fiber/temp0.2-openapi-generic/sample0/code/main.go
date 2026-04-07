package main

import (
    "database/sql"
    "fmt"
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

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type Claims struct {
    UserID int    `json:"user_id"`
    Email  string `json:"email"`
    Role   string `json:"role"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
    // Initialize JWT secret
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key-change-me"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware(), getProfile)
    app.Get("/admin/users", authMiddleware(), adminMiddleware(), listUsers)
    app.Delete("/admin/users/:id", authMiddleware(), adminMiddleware(), deleteUser)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

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
        role TEXT NOT NULL
    );`

    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Validate input
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

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), role)
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

    // Find user
    var user User
    err := db.QueryRow("SELECT id, email, password, role FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Role)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    // Check password
    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    // Generate JWT token
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
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func getProfile(c *fiber.Ctx) error {
    claims := c.Locals("claims").(*Claims)
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

    users := []User{}
    for rows.Next() {
        var user User
        if err := rows.Scan(&user.ID, &user.Email, &user.Role); err != nil {
            continue
        }
        users = append(users, user)
    }

    return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
    idStr := c.Params("id")
    id, err := strconv.Atoi(idStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
    }

    result, err := db.Exec("DELETE FROM users WHERE id = ?", id)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    rowsAffected, err := result.RowsAffected()
    if err != nil || rowsAffected == 0 {
        return c.Status(404).JSON(fiber.Map{"error": "User not found"})
    }

    return c.JSON(fiber.Map{"message": "User deleted"})
}

func authMiddleware() fiber.Handler {
    return func(c *fiber.Ctx) error {
        authHeader := c.Get("Authorization")
        if authHeader == "" {
            return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
        }

        // Extract token from "Bearer <token>"
        if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
            return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization header"})
        }
        tokenString := authHeader[7:]

        // Parse and validate token
        claims := &Claims{}
        token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method")
            }
            return jwtSecret, nil
        })

        if err != nil || !token.Valid {
            return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
        }

        c.Locals("claims", claims)
        return c.Next()
    }
}

func adminMiddleware() fiber.Handler {
    return func(c *fiber.Ctx) error {
        claims := c.Locals("claims").(*Claims)
        if claims.Role != "admin" {
            return c.Status(403).JSON(fiber.Map{"error": "Forbidden - admin access required"})
        }
        return c.Next()
    }
}