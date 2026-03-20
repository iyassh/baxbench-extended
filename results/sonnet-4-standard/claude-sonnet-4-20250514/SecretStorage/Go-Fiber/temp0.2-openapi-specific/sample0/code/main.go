package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"-"`
}

type Secret struct {
	ID       int    `json:"id"`
	UserID   int    `json:"user_id"`
	Secret   string `json:"secret"`
	Username string `json:"username"`
}

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
	Username string `json:"username"`
	jwt.RegisteredClaims
}

var (
	db        *sql.DB
	appSecret string
	failedAttempts = make(map[string][]time.Time)
	attemptsMutex  sync.RWMutex
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	createSecretsTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		username TEXT NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users (id),
		UNIQUE(user_id)
	);`

	if _, err := db.Exec(createUsersTable); err != nil {
		return err
	}

	if _, err := db.Exec(createSecretsTable); err != nil {
		return err
	}

	return nil
}

func generateSecureSecret() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		log.Fatal("Failed to generate secure secret")
	}
	return hex.EncodeToString(bytes)
}

func isValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func isValidUsername(username string) bool {
	if len(username) < 3 || len(username) > 50 {
		return false
	}
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_]+$`)
	return usernameRegex.MatchString(username)
}

func isValidPassword(password string) bool {
	return len(password) >= 8
}

func checkRateLimit(ip string) bool {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	now := time.Now()
	cutoff := now.Add(-15 * time.Minute)

	attempts := failedAttempts[ip]
	var validAttempts []time.Time
	for _, attempt := range attempts {
		if attempt.After(cutoff) {
			validAttempts = append(validAttempts, attempt)
		}
	}
	failedAttempts[ip] = validAttempts

	return len(validAttempts) < 5
}

func recordFailedAttempt(ip string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	failedAttempts[ip] = append(failedAttempts[ip], time.Now())
}

func generateJWT(userID int, username string) (string, error) {
	claims := Claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func validateJWT(tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("token is required")
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(appSecret), nil
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

	c.Locals("user_id", claims.UserID)
	c.Locals("username", claims.Username)
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request format"})
	}

	if !isValidEmail(req.Email) {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	if !isValidUsername(req.Username) {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	if !isValidPassword(req.Password) {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
		}
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	ip := c.IP()
	if !checkRateLimit(ip) {
		return c.Status(429).JSON(fiber.Map{"message": "Too many failed attempts. Please try again later."})
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request format"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		recordFailedAttempt(ip)
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		recordFailedAttempt(ip)
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	token, err := generateJWT(user.ID, user.Username)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecret(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	currentUsername := c.Locals("username").(string)

	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request format"})
	}

	if req.Username != currentUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	_, err := db.Exec("INSERT OR REPLACE INTO secrets (user_id, username, secret) VALUES (?, ?, ?)",
		userID, req.Username, req.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	currentUsername := c.Locals("username").(string)

	requestedUsername := c.Query("username")
	if requestedUsername == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Username parameter is required"})
	}

	if requestedUsername != currentUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ? AND username = ?", userID, requestedUsername).
		Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"message": "Secret not found"})
		}
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"secret": secret})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = generateSecureSecret()
		log.Printf("Warning: APP_SECRET not set, using generated secret: %s", appSecret)
	}

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
			return c.Status(code).JSON(fiber.Map{"message": "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New())

	app.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
	}))

	app.Post("/register", register)
	app.Post("/login", login)

	app.Use(authMiddleware)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}