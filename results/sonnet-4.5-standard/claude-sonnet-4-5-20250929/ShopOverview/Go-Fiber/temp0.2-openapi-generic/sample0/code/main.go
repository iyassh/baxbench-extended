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

type Merchant struct {
	ID       int
	Email    string
	Name     string
	Password string
}

type Ware struct {
	ID          int
	MerchantID  int
	Name        string
	Description string
	Price       float64
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createMerchantsTable := `
	CREATE TABLE IF NOT EXISTS merchants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password TEXT NOT NULL
	);`

	createWaresTable := `
	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);`

	_, err = db.Exec(createMerchantsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createWaresTable)
	if err != nil {
		return err
	}

	return nil
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func registerMerchant(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		req.Email, req.Name, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.SendStatus(201)
}

func loginMerchant(c *fiber.Ctx) error {
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchant Merchant
	err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?",
		req.Email).Scan(&merchant.ID, &merchant.Email, &merchant.Name, &merchant.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, merchant.Password) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	cookie := fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    fmt.Sprintf("%d", merchant.ID),
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Lax",
	}
	c.Cookie(&cookie)

	return c.JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, err := strconv.Atoi(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var exists int
	err = db.QueryRow("SELECT id FROM merchants WHERE id = ?", merchantID).Scan(&exists)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchantID", merchantID)
	return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
	type UploadRequest struct {
		CSV string `json:"csv"`
	}

	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	merchantID := c.Locals("merchantID").(int)

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

	return c.SendStatus(200)
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

	html := `
	<!DOCTYPE html>
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
		html += fmt.Sprintf(`
			<tr>
				<td>%s</td>
				<td>%s</td>
				<td>%.2f</td>
				<td>%s</td>
			</tr>
		`, name, description, price, email)
	}

	html += `
		</table>
	</body>
	</html>
	`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>