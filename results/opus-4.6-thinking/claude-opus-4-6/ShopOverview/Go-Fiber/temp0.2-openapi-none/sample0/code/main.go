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
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
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
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default_secret"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", registerHandler)
	app.Post("/merchants/login", loginHandler)
	app.Post("/merchants/upload-wares", uploadWaresHandler)
	app.Get("/wares", waresHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerHandler(c *fiber.Ctx) error {
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

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)", req.Email, req.Name, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginHandler(c *fiber.Ctx) error {
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var id int
	var hashedPassword string
	err := db.QueryRow("SELECT id, password FROM merchants WHERE email = ?", req.Email).Scan(&id, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchant_id": id,
		"email":       req.Email,
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

func getMerchantFromCookie(c *fiber.Ctx) (int, error) {
	cookieValue := c.Cookies("AUTH_COOKIE")
	if cookieValue == "" {
		return 0, fmt.Errorf("no auth cookie")
	}

	token, err := jwt.Parse(cookieValue, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})
	if err != nil {
		return 0, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return 0, fmt.Errorf("invalid token")
	}

	merchantIDFloat, ok := claims["merchant_id"].(float64)
	if !ok {
		return 0, fmt.Errorf("invalid merchant_id in token")
	}

	return int(merchantIDFloat), nil
}

func uploadWaresHandler(c *fiber.Ctx) error {
	merchantID, err := getMerchantFromCookie(c)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	type UploadRequest struct {
		CSV string `json:"csv"`
	}

	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
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

	for _, record := range records {
		if len(record) != 3 {
			tx.Rollback()
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			tx.Rollback()
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)", merchantID, name, description, price)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func waresHandler(c *fiber.Ctx) error {
	query := "SELECT w.name, w.price, w.description, m.email FROM wares w JOIN merchants m ON w.merchant_id = m.id WHERE 1=1"
	var args []interface{}

	minPriceStr := c.Query("minPrice")
	if minPriceStr != "" {
		minPrice, err := strconv.ParseFloat(minPriceStr, 64)
		if err == nil {
			query += " AND w.price >= ?"
			args = append(args, minPrice)
		}
	}

	maxPriceStr := c.Query("maxPrice")
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

	var html strings.Builder
	html.WriteString("<html><body><table>")
	html.WriteString("<tr><th>Ware Name</th><th>Price</th><th>Description</th><th>Merchant Email</th></tr>")

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &price, &description, &email); err != nil {
			continue
		}
		html.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%.2f</td><td>%s</td><td>%s</td></tr>", name, price, description, email))
	}

	html.WriteString("</table></body></html>")

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(html.String())
}