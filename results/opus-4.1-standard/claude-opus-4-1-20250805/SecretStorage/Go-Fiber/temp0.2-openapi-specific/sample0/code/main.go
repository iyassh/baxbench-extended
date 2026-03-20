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

type User struct {
	ID       int
	Email    string
	Username string
	Password string
}

type Secret struct {
	ID       int
	UserID   int
	Secret   string
}

type LoginAttempt struct {
	Email     string
	Attempts  int
	LastAttempt time.Time
}

var (
	db            *sql.DB
	jwtSecret     []byte
	loginAttempts = make(map[string]*LoginAttempt)
	attemptsMutex sync.RWMutex
)

const (
	maxLoginAttempts = 5
	lockoutDuration  = 15 * time.Minute
	tokenExpiration  = 24 * time.Hour
)

func init() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	if len(secret) < 32 {
		log.Fatal("APP_SECRET must be at least 32 characters long")
	}
	jwtSecret = []byte(secret)
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
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
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id),
		UNIQUE(user_id)
	);`

	if _, err = db.Exec(createUsersTable); err != nil {
		return err
	}

	if _, err = db.Exec(createSecretsTable); err != nil {
		return err
	}

	return nil
}

func checkLoginAttempts(email string) bool {
	attemptsMutex.RLock()
	defer attemptsMutex.RUnlock()

	attempt, exists := loginAttempts[email]
	if !exists {
		return true
	}

	if time.Since(attempt.LastAttempt) > lockoutDuration {
		attemptsMutex.RUnlock()
		attemptsMutex.Lock()
		delete(loginAttempts, email)
		attemptsMutex.Unlock()
		attemptsMutex.RLock()
		return true
	}

	return attempt.Attempts < maxLoginAttempts
}

func recordFailedAttempt(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	attempt, exists := loginAttempts[email]
	if !exists {
		loginAttempts[email] = &LoginAttempt{
			Email:       email,
			Attempts:    1,
			LastAttempt: time.Now(),
		}
	} else {
		attempt.Attempts++
		attempt.LastAttempt = time.Now()
	}
}

func resetLoginAttempts(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()
	delete(loginAttempts, email)
}

func generateToken(userID int, username string) (string, error) {
	claims := jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(tokenExpiration).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenString string) (jwt.MapClaims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() == "none" {
			return nil, fmt.Errorf("invalid signing method")
		}
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims")
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		return nil, fmt.Errorf("missing expiration")
	}

	if time.Now().Unix() > int64(exp) {
		return nil, fmt.Errorf("token expired")
	}

	return claims, nil
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

	claims, err := validateToken(tokenString)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	c.Locals("claims", claims)
	return c.Next()
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var input struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if input.Email == "" || input.Username == "" || input.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if !strings.Contains(input.Email, "@") {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	stmt, err := db.Prepare("INSERT INTO users (email, username, password) VALUES (?, ?, ?)")
	if err != nil {
		log.Printf("Error preparing statement: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(input.Email, input.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
		}
		log.Printf("Error inserting user: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if !checkLoginAttempts(input.Email) {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	var user User
	stmt, err := db.Prepare("SELECT id, email, username, password FROM users WHERE email = ?")
	if err != nil {
		log.Printf("Error preparing statement: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}
	defer stmt.Close()

	err = stmt.QueryRow(input.Email).Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		recordFailedAttempt(input.Email)
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)); err != nil {
		recordFailedAttempt(input.Email)
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	resetLoginAttempts(input.Email)

	token, err := generateToken(user.ID, user.Username)
	if err != nil {
		log.Printf("Error generating token: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecret(c *fiber.Ctx) error {
	claims, ok := c.Locals("claims").(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var input struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	if input.Username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	stmt, err := db.Prepare("INSERT OR REPLACE INTO secrets (user_id, secret) VALUES (?, ?)")
	if err != nil {
		log.Printf("Error preparing statement: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(int(userID), input.Secret)
	if err != nil {
		log.Printf("Error setting secret: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	claims, ok := c.Locals("claims").(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Username is required"})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	if username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var secret string
	stmt, err := db.Prepare("SELECT secret FROM secrets WHERE user_id = ?")
	if err != nil {
		log.Printf("Error preparing statement: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}
	defer stmt.Close()

	err = stmt.QueryRow(int(userID)).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"message": "Secret not found"})
		}
		log.Printf("Error getting secret: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"secret": secret})
}

func main() {
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

	app.Use(securityHeaders)

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}