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

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginResponse struct {
    Token string `json:"token"`
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
    // Get secret from environment
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/register", registerHandler)
    app.Post("/login", loginHandler)
    app.Get("/profile", jwtMiddleware, profileHandler)
    app.Get("/admin/users", jwtMiddleware, adminMiddleware, listUsersHandler)
    app.Delete("/admin/users/:id", jwtMiddleware, adminMiddleware, deleteUserHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    // Create users table
    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
    );`

    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal("Failed to create table:", err)
    }
}

func registerHandler(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
    }

    // Check if this is the first user (admin)
    var userCount int
    err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    role := "user"
    if userCount == 0 {
        role = "admin"
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", 
        req.Email, string(hashedPassword), role)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

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
    claims := &Claims{
        UserID: user.ID,
        Email:  user.Email,
        Role:   user.Role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    return c.JSON(LoginResponse{Token: tokenString})
}

func jwtMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
    }

    // Extract token from "Bearer <token>"
    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization header format"})
    }
    tokenString := authHeader[7:]

    // Parse token
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
    }

    claims, ok := token.Claims.(*Claims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid token claims"})
    }

    // Store user info in context
    c.Locals("user_id", claims.UserID)
    c.Locals("email", claims.Email)
    c.Locals("role", claims.Role)

    return c.Next()
}

func adminMiddleware(c *fiber.Ctx) error {
    role := c.Locals("role").(string)
    if role != "admin" {
        return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
    }
    return c.Next()
}

func profileHandler(c *fiber.Ctx) error {
    email := c.Locals("email").(string)
    role := c.Locals("role").(string)

    return c.JSON(fiber.Map{
        "email": email,
        "role":  role,
    })
}

func listUsersHandler(c *fiber.Ctx) error {
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

func deleteUserHandler(c *fiber.Ctx) error {
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
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    if rowsAffected == 0 {
        return c.Status(404).JSON(fiber.Map{"error": "User not found"})
    }

    return c.JSON(fiber.Map{"message": "User deleted"})
}