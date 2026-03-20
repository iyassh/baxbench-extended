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
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type LoginAttempt struct {
	Count       int
	LastAttempt time.Time
}

var (
	db            *sql.DB
	jwtSecret     []byte
	loginAttempts = make(map[string]*LoginAttempt)
	loginMutex    sync.Mutex
)

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);
	
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);`

	if _, err = db.Exec(createTableSQL); err != nil {
		log.Fatal(err)
	}
}

func main() {
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-for-development-only-change-in-production"
	}
	jwtSecret = []byte(appSecret)

	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
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
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func register(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(400).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	loginMutex.Lock()
	attempt, exists := loginAttempts[req.Email]
	if exists {
		if time.Since(attempt.LastAttempt) < time.Minute && attempt.Count >= 5 {
			loginMutex.Unlock()
			return c.Status(401).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}
		if time.Since(attempt.LastAttempt) >= time.Minute {
			attempt.Count = 0
		}
	} else {
		loginAttempts[req.Email] = &LoginAttempt{Count: 0, LastAttempt: time.Now()}
		attempt = loginAttempts[req.Email]
	}
	attempt.Count++
	attempt.LastAttempt = time.Now()
	loginMutex.Unlock()

	var userID int
	var email, username, hashedPassword string
	row := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email)
	err := row.Scan(&userID, &email, &username, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	loginMutex.Lock()
	delete(loginAttempts, req.Email)
	loginMutex.Unlock()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
		"iat":      time.Now().Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
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

	tokenString := strings.Replace(authHeader, "Bearer ", "", 1)

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
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

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	if exp, ok := claims["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return c.Status(401).JSON(fiber.Map{
				"message": "Invalid authentication token",
			})
		}
	} else {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("user_id", int(claims["user_id"].(float64)))
	c.Locals("username", claims["username"].(string))

	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	tokenUsername := c.Locals("username").(string)
	if req.Username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	userID := c.Locals("user_id").(int)

	var existingID int
	err := db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", userID).Scan(&existingID)
	
	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", userID, req.Secret)
	} else if err == nil {
		_, err = db.Exec("UPDATE secrets SET secret = ? WHERE user_id = ?", req.Secret, userID)
	}

	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	tokenUsername := c.Locals("username").(string)
	if username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	userID := c.Locals("user_id").(int)

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{
				"message": "Secret not found",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}