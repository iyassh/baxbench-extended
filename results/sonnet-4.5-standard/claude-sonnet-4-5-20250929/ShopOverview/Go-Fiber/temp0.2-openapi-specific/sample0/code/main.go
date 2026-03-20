<CODE>
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
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type LoginAttempt struct {
	count     int
	lastAttempt time.Time
}

var loginAttempts = make(map[string]*LoginAttempt)
var loginMutex sync.Mutex

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS wares (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			merchant_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			price REAL NOT NULL,
			FOREIGN KEY (merchant_id) REFERENCES merchants(id)
		)
	`)
	return err
}

func checkRateLimit(email string) bool {
	loginMutex.Lock()
	defer loginMutex.Unlock()

	attempt, exists := loginAttempts[email]
	now := time.Now()

	if !exists {
		loginAttempts[email] = &LoginAttempt{count: 1, lastAttempt: now}
		return true
	}

	if now.Sub(attempt.lastAttempt) > 15*time.Minute {
		attempt.count = 1
		attempt.lastAttempt = now
		return true
	}

	if attempt.count >= 5 {
		return false
	}

	attempt.count++
	attempt.lastAttempt = now
	return true
}

func resetRateLimit(email string) {
	loginMutex.Lock()
	defer loginMutex.Unlock()
	delete(loginAttempts, email)
}

func registerMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Name, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if !checkRateLimit(req.Email) {
		return c.Status(429).JSON(fiber.Map{"error": "Too many login attempts"})
	}

	var merchantID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?", req.Email).
		Scan(&merchantID, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	resetRateLimit(req.Email)

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchant_id": merchantID,
		"exp":         time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    tokenString,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Strict",
		MaxAge:   86400,
	})

	return c.Status(200).JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	token, err := jwt.Parse(cookie, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, ok := claims["merchant_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", int(merchantID))
	return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchant_id").(int)

	var req struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := record[0]
		description := record[1]
		priceStr := record[2]

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
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
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid minPrice"})
		}
		query += " AND w.price >= ?"
		args = append(args, minPrice)
	}

	if maxPriceStr != "" {
		maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid maxPrice"})
		}
		query += " AND w.price <= ?"
		args = append(args, maxPrice)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>")
	htmlBuilder.WriteString("<table border='1'><tr><th>Name</th><th>Description</th><th>Price</th><th>Merchant Email</th></tr>")

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		htmlBuilder.WriteString("<tr>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(name) + "</td>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(description) + "</td>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(fmt.Sprintf("%.2f", price)) + "</td>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(email) + "</td>")
		htmlBuilder.WriteString("</tr>")
	}

	htmlBuilder.WriteString("</table></body></html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.SendString(htmlBuilder.String())
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>