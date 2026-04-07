package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"
    "strconv"
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
    ID    int    `json:"id"`
    Email string `json:"email"`
    Role  string `json:"role"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    createTableSQL := `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL
    );`
    _, err = db.Exec(createTableSQL)
    return err
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
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
    }

    tokenString := strings.TrimPrefix(authHeader, "Bearer ")
    if tokenString == authHeader {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
    }

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method")
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
    }

    c.Locals("user", claims)
    return c.Next()
}

func adminMiddleware(c *fiber.Ctx) error {
    user, ok := c.Locals("user").(*Claims)
    if !ok || user.Role != "admin" {
        return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Forbidden"})
    }
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    }

    // Check if email already exists
    var existingID int
    err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
    if err == nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    } else if err != sql.ErrNoRows {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    // Check if this is the first user
    var userCount int
    err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    role := "user"
    if userCount == 0 {
        role = "admin"
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", req.Email, string(hashedPassword), role)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    }

    var user User
    err := db.QueryRow("SELECT id, email, password, role FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Role)
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    // Create JWT
    claims := &Claims{
        ID:    user.ID,
        Email: user.Email,
        Role:  user.Role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func getProfile(c *fiber.Ctx) error {
    user, _ := c.Locals("user").(*Claims)
    return c.JSON(fiber.Map{
        "email": user.Email,
        "role":  user.Role,
    })
}

func getUsers(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, email, role FROM users")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    var users []User
    for rows.Next() {
        var user User
        if err := rows.Scan(&user.ID, &user.Email, &user.Role); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
        }
        users = append(users, user)
    }

    return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
    idStr := c.Params("id")
    id, err := strconv.Atoi(idStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bad request"})
    }

    result, err := db.Exec("DELETE FROM users WHERE id = ?", id)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    rowsAffected, err := result.RowsAffected()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
    }

    if rowsAffected == 0 {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "User not found"})
    }

    return c.JSON(fiber.Map{"message": "User deleted"})
}

func main() {
    // Get JWT secret from env
    appSecret := os.Getenv("APP_SECRET")
    if appSecret == "" {
        log.Fatal("APP_SECRET environment variable is not set")
    }
    jwtSecret = []byte(appSecret)

    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
        },
    })

    // Global security headers
    app.Use(securityHeadersMiddleware)

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Get("/admin/users", authMiddleware, adminMiddleware, getUsers)
    app.Delete("/admin/users/:id", authMiddleware, adminMiddleware, deleteUser)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}