package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
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
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type Merchant struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"-"`
}

type Ware struct {
	ID          int     `json:"id"`
	MerchantID  int     `json:"merchant_id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
}

type LoginAttempt struct {
	Email     string
	Timestamp time.Time
}

var (
	db             *sql.DB
	loginAttempts  = make(map[string][]time.Time)
	attemptsMutex  sync.RWMutex
	jwtSecret      []byte
	maxAttempts    = 5
	lockoutPeriod  = 15 * time.Minute
)

func init() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		randomBytes := make([]byte, 32)
		rand.Read(randomBytes)
		jwtSecret = randomBytes
	} else {
		jwtSecret = []byte(secret)
	}
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	merchantsTable := `
	CREATE TABLE IF NOT EXISTS merchants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password TEXT NOT NULL
	);`

	waresTable := `
	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants (id)
	);`

	if _, err := db.Exec(merchantsTable); err != nil {
		return err
	}

	if _, err := db.Exec(waresTable); err != nil {
		return err
	}

	return nil
}

func isRateLimited(email string) bool {
	attemptsMutex.RLock()
	attempts, exists := loginAttempts[email]
	attemptsMutex.RUnlock()

	if !exists {
		return false
	}

	now := time.Now()
	validAttempts := 0
	for _, attempt := range attempts {
		if now.Sub(attempt) < lockoutPeriod {
			validAttempts++
		}
	}

	return validAttempts >= maxAttempts
}

func recordLoginAttempt(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	now := time.Now()
	if attempts, exists := loginAttempts[email]; exists {
		var validAttempts []time.Time
		for _, attempt := range attempts {
			if now.Sub(attempt) < lockoutPeriod {
				validAttempts = append(validAttempts, attempt)
			}
		}
		loginAttempts[email] = append(validAttempts, now)
	} else {
		loginAttempts[email] = []time.Time{now}
	}
}

func clearLoginAttempts(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()
	delete(loginAttempts, email)
}

func generateToken(merchantID int) (string, error) {
	claims := jwt.MapClaims{
		"merchant_id": merchantID,
		"exp":         time.Now().Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenString string) (int, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return 0, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		merchantID, ok := claims["merchant_id"].(float64)
		if !ok {
			return 0, fmt.Errorf("invalid merchant_id")
		}
		return int(merchantID), nil
	}

	return 0, fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, err := validateToken(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", merchantID)
	return c.Next()
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
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		req.Email, req.Name, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{"error": "Email already exists"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if isRateLimited(req.Email) {
		return c.Status(429).JSON(fiber.Map{"error": "Too many login attempts"})
	}

	var merchant Merchant
	err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?", req.Email).
		Scan(&merchant.ID, &merchant.Email, &merchant.Name, &merchant.Password)
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(req.Password))
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	clearLoginAttempts(req.Email)

	token, err := generateToken(merchant.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Strict",
		MaxAge:   24 * 60 * 60,
	})

	return c.JSON("Login successful")
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
			return c.Status(400).JSON(fiber.Map{"error": "CSV must have exactly 3 columns: name, description, price"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		if name == "" || description == "" || priceStr == "" {
			return c.Status(400).JSON(fiber.Map{"error": "All fields must be non-empty"})
		}

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid price format"})
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

	return c.JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	query := `
		SELECT w.name, w.description, w.price, m.email 
		FROM wares w 
		JOIN merchants m ON w.merchant_id = m.id 
		WHERE 1=1`
	args := []interface{}{}

	if minPriceStr != "" {
		minPrice, err := strconv.ParseFloat(minPriceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid minPrice format"})
		}
		query += " AND w.price >= ?"
		args = append(args, minPrice)
	}

	if maxPriceStr != "" {
		maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid maxPrice format"})
		}
		query += " AND w.price <= ?"
		args = append(args, maxPrice)
	}

	query += " ORDER BY w.name"

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <meta charset="UTF-8">
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Price</th>
            <th>Merchant Email</th>
        </tr>`)

	for rows.Next() {
		var name, description, email string
		var price float64

		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		htmlBuilder.WriteString("<tr>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(name) + "</td>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(description) + "</td>")
		htmlBuilder.WriteString("<td>$" + fmt.Sprintf("%.2f", price) + "</td>")
		htmlBuilder.WriteString("<td>" + html.EscapeString(email) + "</td>")
		htmlBuilder.WriteString("</tr>")
	}

	htmlBuilder.WriteString(`
    </table>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'; style-src 'unsafe-inline'",
	}))

	app.Use(recover.New())

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}