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

var (
	db            *sql.DB
	jwtSecret     []byte
	loginAttempts = make(map[string][]time.Time)
	attemptsMutex sync.Mutex
)

type Merchant struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type WaresUploadRequest struct {
	CSV string `json:"csv"`
}

type Ware struct {
	Name        string
	Description string
	Price       float64
	MerchantEmail string
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS merchants (
		email TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL
	);
	
	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		merchant_email TEXT NOT NULL,
		FOREIGN KEY(merchant_email) REFERENCES merchants(email)
	);
	`

	if _, err = db.Exec(createTables); err != nil {
		log.Fatal(err)
	}
}

func rateLimitCheck(email string) bool {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	now := time.Now()
	attempts, exists := loginAttempts[email]
	
	if !exists {
		loginAttempts[email] = []time.Time{now}
		return true
	}

	// Clean old attempts (older than 15 minutes)
	var validAttempts []time.Time
	for _, attempt := range attempts {
		if now.Sub(attempt) < 15*time.Minute {
			validAttempts = append(validAttempts, attempt)
		}
	}

	// Check if too many attempts (max 5 in 15 minutes)
	if len(validAttempts) >= 5 {
		return false
	}

	validAttempts = append(validAttempts, now)
	loginAttempts[email] = validAttempts
	return true
}

func generateJWT(email string) (string, error) {
	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	}
	
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateJWT(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return "", err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		email, ok := claims["email"].(string)
		if !ok {
			return "", fmt.Errorf("invalid token claims")
		}
		return email, nil
	}

	return "", fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	email, err := validateJWT(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("email", email)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var merchant Merchant
	if err := c.BodyParser(&merchant); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if merchant.Email == "" || merchant.Name == "" || merchant.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(merchant.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)", 
		merchant.Email, merchant.Name, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.SendStatus(201)
}

func loginHandler(c *fiber.Ctx) error {
	var loginReq LoginRequest
	if err := c.BodyParser(&loginReq); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if !rateLimitCheck(loginReq.Email) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var passwordHash string
	err := db.QueryRow("SELECT password_hash FROM merchants WHERE email = ?", loginReq.Email).Scan(&passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(loginReq.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token, err := generateJWT(loginReq.Email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
	})

	return c.Status(200).JSON("Login successful")
}

func uploadWaresHandler(c *fiber.Ctx) error {
	var uploadReq WaresUploadRequest
	if err := c.BodyParser(&uploadReq); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	email := c.Locals("email").(string)

	reader := csv.NewReader(strings.NewReader(uploadReq.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO wares (name, description, price, merchant_email) VALUES (?, ?, ?, ?)")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = stmt.Exec(record[0], record[1], price, email)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	if err = tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.SendString("Wares uploaded successfully")
}

func getWaresHandler(c *fiber.Ctx) error {
	query := "SELECT name, description, price, merchant_email FROM wares WHERE 1=1"
	var args []interface{}

	minPriceStr := c.Query("minPrice")
	if minPriceStr != "" {
		minPrice, err := strconv.ParseFloat(minPriceStr, 64)
		if err == nil {
			query += " AND price >= ?"
			args = append(args, minPrice)
		}
	}

	maxPriceStr := c.Query("maxPrice")
	if maxPriceStr != "" {
		maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
		if err == nil {
			query += " AND price <= ?"
			args = append(args, maxPrice)
		}
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("<html><body>Error loading wares</body></html>")
	}
	defer rows.Close()

	var wares []Ware
	for rows.Next() {
		var ware Ware
		if err := rows.Scan(&ware.Name, &ware.Description, &ware.Price, &ware.MerchantEmail); err != nil {
			continue
		}
		wares = append(wares, ware)
	}

	htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>Warehouse</title>
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Warehouse</h1>
    <table>
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>`

	for _, ware := range wares {
		htmlContent += fmt.Sprintf(`
        <tr>
            <td>%s</td>
            <td>%.2f</td>
            <td>%s</td>
            <td>%s</td>
        </tr>`,
			html.EscapeString(ware.Name),
			ware.Price,
			html.EscapeString(ware.Description),
			html.EscapeString(ware.MerchantEmail))
	}

	htmlContent += `
    </table>
</body>
</html>`

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent)
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-for-development"
	}
	jwtSecret = []byte(secret)

	initDB()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		ContentSecurityPolicy: "default-src 'self'",
		XFrameOptions:         "DENY",
		XContentTypeOptions:   "nosniff",
	}))

	app.Post("/merchants/register", registerHandler)
	app.Post("/merchants/login", loginHandler)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWaresHandler)
	app.Get("/wares", authMiddleware, getWaresHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}