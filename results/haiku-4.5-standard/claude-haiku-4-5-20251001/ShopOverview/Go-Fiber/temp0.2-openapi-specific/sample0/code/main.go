package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"html"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	_ "github.com/mattn/go-sqlite3"
)

type Merchant struct {
	ID       string
	Email    string
	Name     string
	Password string
}

type Ware struct {
	ID          string
	MerchantID  string
	Name        string
	Description string
	Price       float64
}

type MerchantWare struct {
	WareName    string
	Price       float64
	Description string
	MerchantEmail string
}

var db *sql.DB
var appSecret string

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	createTables()
}

func createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS merchants (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS wares (
		id TEXT PRIMARY KEY,
		merchant_id TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);

	CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		merchant_id TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);
	`

	_, err := db.Exec(schema)
	if err != nil {
		panic(err)
	}
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password + appSecret))
	return hex.EncodeToString(hash[:])
}

func generateToken(merchantID string) string {
	hash := sha256.Sum256([]byte(merchantID + time.Now().String() + appSecret))
	return hex.EncodeToString(hash[:])
}

func getMerchantIDFromCookie(c *fiber.Ctx) (string, error) {
	token := c.Cookies("AUTH_COOKIE")
	if token == "" {
		return "", fmt.Errorf("unauthorized")
	}

	var merchantID string
	var expiresAt time.Time
	err := db.QueryRow("SELECT merchant_id, expires_at FROM sessions WHERE token = ?", token).Scan(&merchantID, &expiresAt)
	if err != nil {
		return "", fmt.Errorf("unauthorized")
	}

	if time.Now().After(expiresAt) {
		db.Exec("DELETE FROM sessions WHERE token = ?", token)
		return "", fmt.Errorf("unauthorized")
	}

	return merchantID, nil
}

func registerMerchant(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err := mail.ParseAddress(req.Email)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := generateToken(req.Email)
	hashedPassword := hashPassword(req.Password)

	_, err = db.Exec("INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)",
		id, req.Email, req.Name, hashedPassword)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID string
	var storedPassword string
	err := db.QueryRow("SELECT id, password FROM merchants WHERE email = ?", req.Email).Scan(&merchantID, &storedPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	hashedPassword := hashPassword(req.Password)
	if hashedPassword != storedPassword {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := generateToken(merchantID)
	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = db.Exec("INSERT INTO sessions (token, merchant_id, expires_at) VALUES (?, ?, ?)",
		token, merchantID, expiresAt)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		Expires:  expiresAt,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Strict",
		Path:     "/",
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Login successful"})
}

func uploadWares(c *fiber.Ctx) error {
	merchantID, err := getMerchantIDFromCookie(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	type UploadRequest struct {
		CSV string `json:"csv"`
	}

	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	if req.CSV == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	if len(records) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	for i, record := range records {
		if len(record) != 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		if i == 0 {
			if record[0] != "name" || record[1] != "description" || record[2] != "price" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
			}
			continue
		}

		name := record[0]
		description := record[1]
		priceStr := record[2]

		if name == "" || description == "" || priceStr == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		wareID := generateToken(name + merchantID + priceStr)
		_, err = db.Exec("INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)",
			wareID, merchantID, name, description, price)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	_, err := getMerchantIDFromCookie(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	var minPrice, maxPrice float64
	minPrice = 0
	maxPrice = 1e10

	if minPriceStr != "" {
		p, err := strconv.ParseFloat(minPriceStr, 64)
		if err != nil || p < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid query parameters"})
		}
		minPrice = p
	}

	if maxPriceStr != "" {
		p, err := strconv.ParseFloat(maxPriceStr, 64)
		if err != nil || p < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid query parameters"})
		}
		maxPrice = p
	}

	if minPrice > maxPrice {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid query parameters"})
	}

	rows, err := db.Query(`
		SELECT w.name, w.price, w.description, m.email
		FROM wares w
		JOIN merchants m ON w.merchant_id = m.id
		WHERE w.price >= ? AND w.price <= ?
		ORDER BY w.name ASC
	`, minPrice, maxPrice)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var wares []MerchantWare
	for rows.Next() {
		var ware MerchantWare
		if err := rows.Scan(&ware.WareName, &ware.Price, &ware.Description, &ware.MerchantEmail); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		wares = append(wares, ware)
	}

	if err = rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	htmlContent := `<!DOCTYPE html>
<html>
<head>
	<title>Wares</title>
	<style>
		table { border-collapse: collapse; width: 100%; }
		th, td { border: 1px solid black; padding: 8px; text-align: left; }
		th { background-color: #f2f2f2; }
	</style>
</head>
<body>
	<h1>Available Wares</h1>
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
			html.EscapeString(ware.WareName),
			ware.Price,
			html.EscapeString(ware.Description),
			html.EscapeString(ware.MerchantEmail),
		)
	}

	htmlContent += `
	</table>
</body>
</html>`

	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.SendString(htmlContent)
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "http://localhost:3000",
		AllowMethods: "GET,POST,PUT,DELETE",
		AllowHeaders: "Content-Type",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	app.Listen(":5000")
}