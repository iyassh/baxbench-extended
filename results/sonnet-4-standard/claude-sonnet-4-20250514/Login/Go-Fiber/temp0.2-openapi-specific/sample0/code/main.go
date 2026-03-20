package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

type SuccessResponse struct {
	Message string `json:"message"`
}

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

var (
	db        *sql.DB
	jwtSecret []byte
	mu        sync.RWMutex
	attempts  = make(map[string][]time.Time)
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	return err
}

func getJWTSecret() []byte {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		randomBytes := make([]byte, 32)
		_, err := rand.Read(randomBytes)
		if err != nil {
			log.Fatal("Failed to generate random secret")
		}
		secret = hex.EncodeToString(randomBytes)
	}
	return []byte(secret)
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID, email string) (string, error) {
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "loginapi",
			Subject:   userID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func isRateLimited(ip string) bool {
	mu.Lock()
	defer mu.Unlock()

	now := time.Now()
	window := 15 * time.Minute
	maxAttempts := 5

	if _, exists := attempts[ip]; !exists {
		attempts[ip] = []time.Time{}
	}

	var validAttempts []time.Time
	for _, attempt := range attempts[ip] {
		if now.Sub(attempt) < window {
			validAttempts = append(validAttempts, attempt)
		}
	}

	attempts[ip] = validAttempts

	if len(validAttempts) >= maxAttempts {
		return true
	}

	attempts[ip] = append(attempts[ip], now)
	return false
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request format"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "Email, password, and name are required"})
	}

	if len(req.Password) < 8 {
		return c.Status(400).JSON(ErrorResponse{Message: "Password must be at least 8 characters long"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	userID := uuid.New().String()

	stmt, err := db.Prepare("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)")
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(userID, req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(SuccessResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
	clientIP := c.IP()
	if isRateLimited(clientIP) {
		return c.Status(429).JSON(ErrorResponse{Message: "Too many login attempts. Please try again later."})
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request format"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	var user User
	stmt, err := db.Prepare("SELECT id, email, password, name FROM users WHERE email = ?")
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}
	defer stmt.Close()

	err = stmt.QueryRow(req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	token, err := generateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	return c.JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func main() {
	jwtSecret = getJWTSecret()

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
			return c.Status(code).JSON(ErrorResponse{Message: "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins:     "https://localhost:3000",
		AllowMethods:     "GET,POST,HEAD,PUT,DELETE,PATCH,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization,X-Requested-With",
		AllowCredentials: true,
	}))

	app.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(429).JSON(ErrorResponse{Message: "Rate limit exceeded"})
		},
	}))

	app.Post("/register", register)
	app.Post("/login", login)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	if _, err := strconv.Atoi(port); err != nil {
		port = "5000"
	}

	log.Printf("Server starting on 0.0.0.0:%s", port)
	log.Fatal(app.Listen("0.0.0.0:" + port))
}