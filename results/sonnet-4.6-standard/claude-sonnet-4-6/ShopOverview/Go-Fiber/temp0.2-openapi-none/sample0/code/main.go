package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

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
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS wares (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			merchant_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			price REAL NOT NULL,
			FOREIGN KEY (merchant_id) REFERENCES merchants(id)
		);
	`)
	return err
}

func registerMerchant(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if body.Email == "" || body.Name == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email, name, and password are required"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)", body.Email, body.Name, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already exists or invalid input"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	var merchantID int
	var hashedPassword string
	err := db.QueryRow("SELECT id, password FROM merchants WHERE email = ?", body.Email).Scan(&merchantID, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchant_id": merchantID,
		"email":       body.Email,
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
		Expires:  time.Now().Add(24 * time.Hour),
	})

	return c.Status(200).JSON("Login successful")
}

func getMerchantFromCookie(c *fiber.Ctx) (int, string, error) {
	tokenString := c.Cookies("AUTH_COOKIE")
	if tokenString == "" {
		return 0, "", fmt.Errorf("no auth cookie")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return 0, "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, "", fmt.Errorf("invalid claims")
	}

	merchantIDFloat, ok := claims["merchant_id"].(float64)
	if !ok {
		return 0, "", fmt.Errorf("invalid merchant_id")
	}

	email, _ := claims["email"].(string)

	return int(merchantIDFloat), email, nil
}

func uploadWares(c *fiber.Ctx) error {
	merchantID, _, err := getMerchantFromCookie(c)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var body struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	reader := csv.NewReader(strings.NewReader(body.CSV))
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
		if len(record) < 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format: each row must have name, description, price"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format: price must be a number"})
		}

		_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)", merchantID, name, description, price)
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
		if err == nil {
			query += " AND w.price >= ?"
			args = append(args, minPrice)
		}
	}

	if maxPriceStr != "" {
		maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
		if err == nil {
			query += " AND w.price <= ?"
			args = append(args, maxPrice)
		}
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<table border="1">
<thead>
<tr>
<th>Name</th>
<th>Description</th>
<th>Price</th>
<th>Merchant Email</th>
</tr>
</thead>
<tbody>
`)

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			continue
		}
		sb.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%.2f</td><td>%s</td></tr>\n",
			escapeHTML(name), escapeHTML(description), price, escapeHTML(email)))
	}

	sb.WriteString(`</tbody>
</table>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(sb.String())
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default_secret"
	}

	if err := initDB(); err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	app.Listen("0.0.0.0:5000")
}