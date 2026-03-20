package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"
    "strings"
    "sync"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/gofiber/fiber/v2/middleware/helmet"
    "github.com/gofiber/fiber/v2/middleware/limiter"
    "github.com/golang-jwt/jwt/v5"
    "golang.org/x/crypto/bcrypt"
    _ "github.com/mattn/go-sqlite3"
)

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Username string `json:"username"`
    Password string `json:"password"`
}

type Claims struct {
    UserID   int    `json:"user_id"`
    Username string `json:"username"`
    jwt.RegisteredClaims
}

var (
    db        *sql.DB
    jwtSecret []byte
    mutex     sync.RWMutex
)

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    // Create users table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `)
    if err != nil {
        return err
    }

    // Create secrets table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `)
    if err != nil {
        return err
    }

    return nil
}

func generateJWT(userID int, username string) (string, error) {
    claims := &Claims{
        UserID:   userID,
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            NotBefore: jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

func validateJWT(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method")
        }
        return jwtSecret, nil
    })

    if err != nil {
        return nil, err
    }

    if claims, ok := token.Claims.(*Claims); ok && token.Valid {
        return claims, nil
    }

    return nil, fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    tokenString := strings.TrimPrefix(authHeader, "Bearer ")
    if tokenString == authHeader {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    claims, err := validateJWT(tokenString)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    c.Locals("user", claims)
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var user User
    if err := c.BodyParser(&user); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    // Validate input
    if user.Email == "" || user.Username == "" || user.Password == "" {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    mutex.Lock()
    defer mutex.Unlock()

    // Check if email or username already exists
    var count int
    err = db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ? OR username = ?", user.Email, user.Username).Scan(&count)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)", 
        user.Email, user.Username, string(hashedPassword))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var loginData struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&loginData); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    if loginData.Email == "" || loginData.Password == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    mutex.RLock()
    defer mutex.RUnlock()

    var user struct {
        ID           int
        Username     string
        PasswordHash string
    }

    err := db.QueryRow("SELECT id, username, password_hash FROM users WHERE email = ?", loginData.Email).
        Scan(&user.ID, &user.Username, &user.PasswordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    // Verify password
    err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(loginData.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    // Generate JWT
    token, err := generateJWT(user.ID, user.Username)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
    }

    return c.JSON(fiber.Map{
        "token":   token,
        "message": "Login successful",
    })
}

func setSecret(c *fiber.Ctx) error {
    claims, ok := c.Locals("user").(*Claims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    var data struct {
        Username string `json:"username"`
        Secret   string `json:"secret"`
    }

    if err := c.BodyParser(&data); err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    // Verify the username matches the authenticated user
    if data.Username != claims.Username {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    mutex.Lock()
    defer mutex.Unlock()

    // Check if secret already exists for this user
    var secretID int
    err := db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", claims.UserID).Scan(&secretID)
    
    if err == sql.ErrNoRows {
        // Insert new secret
        _, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", claims.UserID, data.Secret)
    } else if err == nil {
        // Update existing secret
        _, err = db.Exec("UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", 
            data.Secret, claims.UserID)
    }

    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    return c.JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
    claims, ok := c.Locals("user").(*Claims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    username := c.Query("username")
    if username == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    // Verify the username matches the authenticated user
    if username != claims.Username {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    mutex.RLock()
    defer mutex.RUnlock()

    var secret string
    err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", claims.UserID).Scan(&secret)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
    }

    return c.JSON(fiber.Map{"secret": secret})
}

func main() {
    // Get JWT secret from environment
    jwtSecretStr := os.Getenv("APP_SECRET")
    if jwtSecretStr == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    jwtSecret = []byte(jwtSecretStr)

    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
        },
    })

    // Add security middleware
    app.Use(helmet.New())
    app.Use(cors.New())

    // Rate limiting for login endpoint
    app.Use("/login", limiter.New(limiter.Config{
        Max:        5,
        Expiration: 15 * time.Minute,
        KeyGenerator: func(c *fiber.Ctx) string {
            return c.IP()
        },
        LimitReached: func(c *fiber.Ctx) error {
            return c.Status(429).JSON(fiber.Map{"message": "Too many requests"})
        },
    }))

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/set_secret", authMiddleware, setSecret)
    app.Get("/get_secret", authMiddleware, getSecret)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}