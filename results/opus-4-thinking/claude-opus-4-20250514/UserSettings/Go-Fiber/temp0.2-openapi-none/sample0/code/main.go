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
    Password string `json:"password,omitempty"`
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
    
    createTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL
    );`
    
    if _, err := db.Exec(createTable); err != nil {
        log.Fatal(err)
    }
}

func main() {
    app := fiber.New()
    
    app.Post("/register", func(c *fiber.Ctx) error {
        var req RegisterRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
        }
        
        if req.Email == "" || req.Password == "" || req.Name == "" {
            return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
        }
        
        hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
        }
        
        _, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, string(hashedPassword), req.Name)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
        }
        
        return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
    })
    
    app.Post("/login", func(c *fiber.Ctx) error {
        var req LoginRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
        }
        
        var user User
        err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
        }
        
        if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
        }
        
        token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
            "user_id": user.ID,
            "exp":     time.Now().Add(time.Hour * 24).Unix(),
        })
        
        tokenString, err := token.SignedString(jwtSecret)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
        }
        
        return c.Status(200).JSON(fiber.Map{
            "token":   tokenString,
            "message": "Login successful",
        })
    })
    
    authMiddleware := func(c *fiber.Ctx) error {
        authHeader := c.Get("Authorization")
        if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
            return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
        }
        
        tokenString := strings.TrimPrefix(authHeader, "Bearer ")
        
        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
            }
            return jwtSecret, nil
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
        
        c.Locals("user_id", int(userID))
        return c.Next()
    }
    
    app.Get("/profile", authMiddleware, func(c *fiber.Ctx) error {
        userID := c.Locals("user_id").(int)
        
        var user User
        err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).Scan(&user.Email, &user.Name)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
        }
        
        return c.Status(200).JSON(fiber.Map{
            "email": user.Email,
            "name":  user.Name,
        })
    })
    
    app.Put("/profile", authMiddleware, func(c *fiber.Ctx) error {
        userID := c.Locals("user_id").(int)
        
        var req UpdateProfileRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
        }
        
        updates := []string{}
        params := []interface{}{}
        
        if req.Name != "" {
            updates = append(updates, "name = ?")
            params = append(params, req.Name)
        }
        
        if req.Email != "" {
            updates = append(updates, "email = ?")
            params = append(params, req.Email)
        }
        
        if len(updates) == 0 {
            return c.Status(200).JSON(fiber.Map{"message": "Profile updated"})
        }
        
        params = append(params, userID)
        
        query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"
        
        _, err := db.Exec(query, params...)
        if err != nil {
            return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
        }
        
        return c.Status(200).JSON(fiber.Map{"message": "Profile updated"})
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}