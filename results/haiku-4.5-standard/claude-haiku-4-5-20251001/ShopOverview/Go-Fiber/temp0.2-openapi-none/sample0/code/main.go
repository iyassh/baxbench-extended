package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"log"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTables()
}

func createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS merchants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		price REAL NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		token TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);
	`

	_, err := db.Exec(schema)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password + appSecret))
	return hex.EncodeToString(hash[:])
}

func generateToken() string {
	hash := sha256.Sum256([]byte(time.Now().String() + appSecret))
	return hex.EncodeToString(hash[:])
}

func getMerchantIDFromCookie(c *fiber.Ctx) (int, error) {
	token := c.Cookies("AUTH_COOKIE")
	if token == "" {
		return 0, fmt.Errorf("no auth cookie")
	}

	var merchantID int
	err := db.QueryRow(
		"SELECT merchant_id FROM sessions WHERE token = ? AND expires_at > datetime('now')",
		token,
	).Scan(&merchantID)

	if err != nil {
		return 0, fmt.Errorf("invalid session")
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
	}

	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid email format"})
	}

	hashedPassword := hashPassword(req.Password)

	_, err := db.Exec(
		"INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		req.Email, req.Name, hashedPassword,
	)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Email already registered"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Registration failed"})
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
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword := hashPassword(req.Password)

	var merchantID int
	err := db.QueryRow(
		"SELECT id FROM merchants WHERE email = ? AND password = ?",
		req.Email, hashedPassword,
	).Scan(&merchantID)

	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := generateToken()
	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = db.Exec(
		"INSERT INTO sessions (merchant_id, token, expires_at) VALUES (?, ?, ?)",
		merchantID, token, expiresAt,
	)

	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Login failed"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		Expires:  expiresAt,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Lax",
	})

	return c.Status(fiber.StatusOK).JSON("Login successful")
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	if len(records) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Empty CSV"})
	}

	for i, record := range records {
		if len(record) != 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid price format"})
		}

		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Ware name cannot be empty"})
		}

		if i == 0 && (name == "name" || name == "Name") {
			continue
		}

		_, err = db.Exec(
			"INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price,
		)

		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to upload wares"})
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
	maxPrice = 999999999

	if minPriceStr != "" {
		if p, err := strconv.ParseFloat(minPriceStr, 64); err == nil {
			minPrice = p
		}
	}

	if maxPriceStr != "" {
		if p, err := strconv.ParseFloat(maxPriceStr, 64); err == nil {
			maxPrice = p
		}
	}

	query := `
	SELECT w.name, w.price, w.description, m.email
	FROM wares w
	JOIN merchants m ON w.merchant_id = m.id
	WHERE w.price >= ? AND w.price <= ?
	ORDER BY w.name
	`

	rows, err := db.Query(query, minPrice, maxPrice)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Wares</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		table { border-collapse: collapse; width: 100%; }
		th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
		th { background-color: #4CAF50; color: white; }
		tr:nth-child(even) { background-color: #f2f2f2; }
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

	for rows.Next() {
		var name, description, email string
		var price float64

		if err := rows.Scan(&name, &price, &description, &email); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error reading data"})
		}

		html += fmt.Sprintf(`
		<tr>
			<td>%s</td>
			<td>$%.2f</td>
			<td>%s</td>
			<td>%s</td>
		</tr>`, name, price, description, email)
	}

	html += `
	</table>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func main() {
	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}