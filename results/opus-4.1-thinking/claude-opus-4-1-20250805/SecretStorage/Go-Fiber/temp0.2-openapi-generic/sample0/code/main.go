package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

type RegisterRequest struct {
    Email    string `json:"email"`
    Username string `json:"username"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type SetSecretRequest struct {
    Username string `json:"username"`
    Secret   string `json:"secret"`
}

type Claims struct {
    UserID   int    `json:"user_id"`
    Email    string `json:"email"`
    Username string `json:"username"`
    jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)
    
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTables()
}

func createTables() {
    userTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );`
    
    secretTable := `
    CREATE TABLE IF NOT EXISTS secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        secret TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );`
    
    if _, err := db.Exec(userTable); err != nil {
        log.Fatal(err)
    }
    
    if _, err := db.Exec(secretTable); err != nil {
        log.Fatal(err)
    }
}

func main() {
    app := fiber.New()
    
    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/set_secret", authMiddleware, setSecret)
    app.Get("/get_secret", authMiddleware, getSecret)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }
    
    if req.Email == "" || req.Username == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }
    
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }
    
    _, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
        req.Email, req.Username, string(hashedPassword))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "message": "Email already in use or invalid data",
        })
    }
    
    return c.Status(201).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    var userID int
    var email, username, password string
    err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email).
        Scan(&userID, &email, &username, &password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(req.Password)); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
        })
    }
    
    claims := Claims{
        UserID:   userID,
        Email:    email,
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid email or password",
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
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    tokenString := authHeader
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    }
    
    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return jwtSecret, nil
    })
    
    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    c.Locals("claims", claims)
    
    return c.Next()
}

func setSecret(c *fiber.Ctx) error {
    var req SetSecretRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    claims := c.Locals("claims").(*Claims)
    
    if req.Username != claims.Username {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    var existingID int
    err := db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", claims.UserID).Scan(&existingID)
    
    if err == sql.ErrNoRows {
        _, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)",
            claims.UserID, req.Secret)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid authentication token",
            })
        }
    } else if err == nil {
        _, err = db.Exec("UPDATE secrets SET secret = ? WHERE user_id = ?",
            req.Secret, claims.UserID)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{
                "message": "Invalid authentication token",
            })
        }
    } else {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    return c.JSON(fiber.Map{
        "message": "Secret has been set successfully",
    })
}

func getSecret(c *fiber.Ctx) error {
    username := c.Query("username")
    if username == "" {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    claims := c.Locals("claims").(*Claims)
    
    if username != claims.Username {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    var secret string
    err := db.QueryRow(`
        SELECT s.secret 
        FROM secrets s 
        JOIN users u ON s.user_id = u.id 
        WHERE u.username = ?`, username).Scan(&secret)
    
    if err == sql.ErrNoRows {
        return c.JSON(fiber.Map{
            "secret": "",
        })
    } else if err != nil {
        return c.Status(401).JSON(fiber.Map{
            "message": "Invalid authentication token",
        })
    }
    
    return c.JSON(fiber.Map{
        "secret": secret,
    })
}