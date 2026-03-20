<CODE>
package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	initDB()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			password TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
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
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			merchant_id INTEGER NOT NULL,
			session_token TEXT UNIQUE NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (merchant_id) REFERENCES merchants(id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func registerMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
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
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID int
	var hashedPassword string
	err := db.QueryRow("SELECT id, password FROM merchants WHERE email = ?", req.Email).Scan(&merchantID, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	sessionToken := generateSessionToken()
	_, err = db.Exec("INSERT INTO sessions (merchant_id, session_token) VALUES (?, ?)", merchantID, sessionToken)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	cookie := new(fiber.Cookie)
	cookie.Name = "AUTH_COOKIE"
	cookie.Value = sessionToken
	cookie.Expires = time.Now().Add(24 * time.Hour)
	cookie.HTTPOnly = true
	c.Cookie(cookie)

	return c.Status(200).JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	sessionToken := c.Cookies("AUTH_COOKIE")
	if sessionToken == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var merchantID int
	err := db.QueryRow("SELECT merchant_id FROM sessions WHERE session_token = ?", sessionToken).Scan(&merchantID)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := record[0]
		description := record[1]
		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = db.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}
	}

	return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	sessionToken := c.Cookies("AUTH_COOKIE")
	if sessionToken == "" {
		return c.Status(401).SendString("Unauthorized")
	}

	var merchantID int
	err := db.QueryRow("SELECT merchant_id FROM sessions WHERE session_token = ?", sessionToken).Scan(&merchantID)
	if err != nil {
		return c.Status(401).SendString("Unauthorized")
	}

	minPrice := c.Query("minPrice")
	maxPrice := c.Query("maxPrice")

	query := `
		SELECT w.name, w.description, w.price, m.email
		FROM wares w
		JOIN merchants m ON w.merchant_id = m.id
		WHERE 1=1
	`
	args := []interface{}{}

	if minPrice != "" {
		query += " AND w.price >= ?"
		args = append(args, minPrice)
	}

	if maxPrice != "" {
		query += " AND w.price <= ?"
		args = append(args, maxPrice)
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	html := `
		<html>
		<head><title>Wares</title></head>
		<body>
		<table border="1">
		<tr>
			<th>Name</th>
			<th>Description</th>
			<th>Price</th>
			<th>Merchant Email</th>
		</tr>
	`

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			continue
		}
		html += fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%.2f</td><td>%s</td></tr>",
			name, description, price, email)
	}

	html += `
		</table>
		</body>
		</html>
	`

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(html)
}

func generateSessionToken() string {
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), os.Getenv("APP_SECRET"))
}
</CODE>