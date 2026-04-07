package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"
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

type UpdateProfileRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    initDB()

    app := fiber.New()

    app.Post("/register", register)
    app.Post("/login", login)
    app.Get("/profile", authMiddleware, getProfile)
    app.Put("/profile", authMiddleware, updateProfile)

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
        name TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" || req.Name == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email, password, and name are required",
        })
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error processing password",
        })
    }

    _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", 
        req.Email, string(hashedPassword), req.Name)
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(400).JSON(fiber.Map{
                "message": "Email already in use or invalid data",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "message": "Error creating user",
        })
    }

    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    var user User
    err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
        Scan(&user.ID, &user.Email, &user.Password, &user.Name)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }

    claims := &Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "message": "Error creating token",
        })
    }

    return c.Status(200).JSON(fiber.Map{
        "token":   tokenString,
        "message": "Login successful",
    })
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    if !strings.HasPrefix(authHeader, "Bearer ") {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    tokenString := strings.TrimPrefix(authHeader, "Bearer ")

    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{
            "message": "Unauthorized",
        })
    }

    claims, ok := token.Claims.(*Claims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{
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
        return c.Status(500).JSON(fiber.Map{
            "message": "Error fetching profile",
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
        return c.Status(400).JSON(fiber.Map{
            "message": "Invalid request body",
        })
    }

    updateFields := []string{}
    updateValues := []interface{}{}

    if req.Name != "" {
        updateFields = append(updateFields, "name = ?")
        updateValues = append(updateValues, req.Name)
    }

    if req.Email != "" {
        updateFields = append(updateFields, "email = ?")
        updateValues = append(updateValues, req.Email)
    }

    if len(updateFields) == 0 {
        return c.Status(400).JSON(fiber.Map{
            "message": "No fields to update",
        })
    }

    updateValues = append(updateValues, userID)

    query := fmt.Sprintf("UPDATE users SET %s WHERE id = ?", strings.Join(updateFields, ", "))
    _, err := db.Exec(query, updateValues...)
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(400).JSON(fiber.Map{
                "message": "Email already in use",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "message": "Error updating profile",
        })
    }

    return c.JSON(fiber.Map{
        "message": "Profile updated",
    })
}