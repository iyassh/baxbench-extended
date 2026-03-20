package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"html"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type RegisterRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UploadWaresRequest struct {
	CSV string `json:"csv"`
}

type Claims struct {
	MerchantID int `json:"merchant_id"`
	jwt.RegisteredClaims
}

// Rate limiting for login attempts
type RateLimit struct {
	attempts map[string]int
	lastTry  map[string]time.Time
	mu       sync.RWMutex
}

func NewRateLimit() *RateLimit {
	return &RateLimit{
		attempts: make(map[string]int),
		lastTry:  make(map[string]time.Time),
	}
}

func (r *RateLimit) CanAttempt(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	lastTry, exists := r.lastTry[ip]
	
	// Reset attempts if it's been more than 15 minutes
	if exists && now.Sub(lastTry) > 15*time.Minute {
		r.attempts[ip] = 0
	}

	attempts, _ := r.attempts[ip]
	return attempts < 5 // Max 5 attempts per 15 minutes
}

func (r *RateLimit) RecordAttempt(ip string, success bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.lastTry[ip] = time.Now()
	if success {
		delete(r.attempts, ip)
		delete(r.lastTry, ip)
	} else {
		r.attempts[ip]++
	}
}

var (
	db        *sql.DB
	jwtSecret []byte
	rateLimit *RateLimit
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	// Create merchants table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	// Create wares table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS wares (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			merchant_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			price REAL NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (merchant_id) REFERENCES merchants (id)
		)
	`)
	return err
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(merchantID int) (string, error) {
	claims := &Claims{
		MerchantID: merchantID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func authMiddleware(c *fiber.Ctx) error {
	tokenString := c.Cookies("AUTH_COOKIE")
	if tokenString == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchantID", claims.MerchantID)
	return c.Next()
}

func registerMerchant(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Basic validation
	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Basic email validation
	if !strings.Contains(req.Email, "@") || len(req.Email) < 3 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Password length validation
	if len(req.Password) < 6 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Check if merchant already exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM merchants WHERE email = ?", req.Email).Scan(&count)
	if err != nil {
		log.Printf("Database error in register: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	if count > 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		log.Printf("Password hashing error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert merchant
	_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Name, hashedPassword)
	if err != nil {
		log.Printf("Database error in register insert: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	clientIP := c.IP()

	if !rateLimit.CanAttempt(clientIP) {
		return c.Status(429).JSON(fiber.Map{"error": "Too many attempts"})
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		rateLimit.RecordAttempt(clientIP, false)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?", req.Email).
		Scan(&merchantID, &passwordHash)
	if err != nil {
		rateLimit.RecordAttempt(clientIP, false)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if !checkPassword(req.Password, passwordHash) {
		rateLimit.RecordAttempt(clientIP, false)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	// Generate JWT token
	token, err := generateJWT(merchantID)
	if err != nil {
		rateLimit.RecordAttempt(clientIP, false)
		log.Printf("JWT generation error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	rateLimit.RecordAttempt(clientIP, true)

	// Set secure cookie
	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		MaxAge:   24 * 60 * 60, // 24 hours
		HTTPOnly: true,
		Secure:   false, // Set to true in production with HTTPS
		SameSite: "Strict",
	})

	return c.JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	merchantID, ok := c.Locals("merchantID").(int)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req UploadWaresRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	if req.CSV == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	// Parse CSV
	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	if len(records) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	// Begin transaction
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction begin error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	// Clear existing wares for this merchant
	_, err = tx.Exec("DELETE FROM wares WHERE merchant_id = ?", merchantID)
	if err != nil {
		log.Printf("Delete wares error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert new wares
	for i, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		if name == "" || priceStr == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			log.Printf("Insert ware error on row %d: %v", i, err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Transaction commit error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	// Verify authentication
	_, ok := c.Locals("merchantID").(int)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	query := `
		SELECT w.name, w.description, w.price, m.email 
		FROM wares w 
		JOIN merchants m ON w.merchant_id = m.id 
		WHERE 1=1
	`
	args := []interface{}{}

	if minPriceStr != "" {
		minPrice, err := strconv.ParseFloat(minPriceStr, 64)
		if err != nil || minPrice < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid minPrice"})
		}
		query += " AND w.price >= ?"
		args = append(args, minPrice)
	}

	if maxPriceStr != "" {
		maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
		if err != nil || maxPrice < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid maxPrice"})
		}
		query += " AND w.price <= ?"
		args = append(args, maxPrice)
	}

	query += " ORDER BY w.name"

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var htmlTable strings.Builder
	htmlTable.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>`)

	for rows.Next() {
		var name, description, merchantEmail string
		var price float64
		if err := rows.Scan(&name, &description, &price, &merchantEmail); err != nil {
			log.Printf("Row scan error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		htmlTable.WriteString(fmt.Sprintf(`
            <tr>
                <td>%s</td>
                <td>%s</td>
                <td>%.2f</td>
                <td>%s</td>
            </tr>`,
			html.EscapeString(name),
			html.EscapeString(description),
			price,
			html.EscapeString(merchantEmail)))
	}

	// Check for row iteration errors
	if err := rows.Err(); err != nil {
		log.Printf("Row iteration error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	htmlTable.WriteString(`
        </tbody>
    </table>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlTable.String())
}

func main() {
	// Get JWT secret from environment
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	jwtSecret = []byte(secret)

	// Initialize rate limiter
	rateLimit = NewRateLimit()

	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("Error closing database: %v", err)
		}
	}()

	// Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Don't expose internal errors
			log.Printf("Unhandled error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'; style-src 'self' 'unsafe-inline'",
	}))

	// Routes
	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Println("Server starting on :5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}