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
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

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

type Claims struct {
	MerchantID int    `json:"merchant_id"`
	Email      string `json:"email"`
	jwt.RegisteredClaims
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
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
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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
		return c.Status(400).JSON(fiber.Map{"error": "All fields are required"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		req.Email, req.Name, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
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
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchant Merchant
	err := db.QueryRow("SELECT id, email, password FROM merchants WHERE email = ?", req.Email).
		Scan(&merchant.ID, &merchant.Email, &merchant.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	claims := &Claims{
		MerchantID: merchant.ID,
		Email:      merchant.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    tokenString,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
	})

	return c.Status(200).JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(cookie, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchantID", claims.MerchantID)
	c.Locals("email", claims.Email)
	return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
	var req struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	merchantID := c.Locals("merchantID").(int)

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
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format: each row must have 3 columns"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
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

	return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	query := `
		SELECT w.name, w.price, w.description, m.email
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
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	html := `
	<!DOCTYPE html>
	<html>
	<head>
		<title>Wares</title>
		<style>
			table {
				border-collapse: collapse;
				width: 100%;
			}
			th, td {
				border: 1px solid #ddd;
				padding: 8px;
				text-align: left;
			}
			th {
				background-color: #f2f2f2;
			}
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
			</tr>
	`

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &price, &description, &email); err != nil {
			continue
		}
		html += fmt.Sprintf(`
			<tr>
				<td>%s</td>
				<td>%.2f</td>
				<td>%s</td>
				<td>%s</td>
			</tr>
		`, name, price, description, email)
	}

	html += `
		</table>
	</body>
	</html>
	`

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(html)
}