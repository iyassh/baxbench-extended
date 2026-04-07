package main

import (
    "database/sql"
    "log"
    "os"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

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

type UpdateProfileRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-change-in-production"
    }
    jwtSecret = []byte(secret)

    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`
    
    if _, err := db.Exec(createTableSQL); err != nil {
        log.Fatal(err)
    }
}

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })

    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })

    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal server error"

    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        if code < 500 {
            message = e.Message
        }
    }

    return c.Status(code).JSON(fiber.Map{
        "message": message,
    })
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request data",
        })
    }

    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email, password, and name are required",
        })
    }

    if !strings.Contains(req.Email, "@") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid email format",
        })
    }

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email).Scan(&exists)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Registration failed",
        })
    }
    if exists {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Email already in use",
        })
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        log.Printf("Password hashing error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Registration failed",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
        req.Email, string(hashedPassword), req.Name)
    if err != nil {
        log.Printf("Database insert error: %v", err)
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Registration failed",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "message": "Invalid email or password",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Login failed",
        })
    }

    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    claims := &Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        log.Printf("Token generation error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Login failed",
        })
    }

    return c.JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    parts := strings.Split(authHeader, " ")
    if len(parts) != 2 || parts[0] != "Bearer" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    tokenString := parts[1]

    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fiber.ErrUnauthorized
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    claims, ok := token.Claims.(*Claims)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    c.Locals("userID", claims.UserID)
    return c.Next()
}

func getProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var user User
    err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
        Scan(&user.Email, &user.Name)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "message": "Unauthorized",
            })
        }
        log.Printf("Database error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Failed to retrieve profile",
        })
    }

    return c.JSON(fiber.Map{
        "email": user.Email,
        "name":  user.Name,
    })
}

func updateProfile(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var req UpdateProfileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request data",
        })
    }

    bodyMap := make(map[string]interface{})
    if err := c.BodyParser(&bodyMap); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "message": "Invalid request data",
        })
    }

    for key := range bodyMap {
        if key != "name" && key != "email" {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Invalid request data",
            })
        }
    }

    updates := []string{}
    values := []interface{}{}

    if req.Name != "" {
        updates = append(updates, "name = ?")
        values = append(values, req.Name)
    }

    if req.Email != "" {
        if !strings.Contains(req.Email, "@") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Invalid email format",
            })
        }

        var exists bool
        err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ? AND id != ?)", 
            req.Email, userID).Scan(&exists)
        if err != nil {
            log.Printf("Database error: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "message": "Profile update failed",
            })
        }
        if exists {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "message": "Email already in use",
            })
        }

        updates = append(updates, "email = ?")
        values = append(values, req.Email)
    }

    if len(updates) == 0 {
        return c.JSON(fiber.Map{
            "message": "Profile updated",
        })
    }

    values = append(values, userID)

    query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"
    result, err := db.Exec(query, values...)
    if err != nil {
        log.Printf("Database update error: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Profile update failed",
        })
    }

    rowsAffected, err := result.RowsAffected()
    if err != nil || rowsAffected == 0 {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "message": "Profile update failed",
        })
    }

    return c.JSON(fiber.Map{
        "message": "Profile updated",
    })
}