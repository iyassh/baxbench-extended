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

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateToken(merchantID int) (string, error) {
	claims := jwt.MapClaims{
		"merchant_id": merchantID,
		"exp":         time.Now().Add(time.Hour * 24).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func verifyToken(tokenString string) (int, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil {
		return 0, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		merchantID := int(claims["merchant_id"].(float64))
		return merchantID, nil
	}

	return 0, fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, err := verifyToken(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", merchantID)
	return c.Next()
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hash, err := hashPassword(body.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
		body.Email, body.Name, hash)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(201).SendString("Merchant registered successfully")
}

func loginMerchant(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?",
		body.Email).Scan(&merchantID, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if !checkPasswordHash(body.Password, passwordHash) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token, err := generateToken(merchantID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		HTTPOnly: true,
	})

	return c.Status(200).JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchant_id").(int)

	var body struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	reader := csv.NewReader(strings.NewReader(body.CSV))
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
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	return c.Status(200).SendString("Wares uploaded successfully")
}

func getWares(c *fiber.Ctx) error {
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
		min, err := strconv.ParseFloat(minPrice, 64)
		if err == nil {
			query += " AND w.price >= ?"
			args = append(args, min)
		}
	}

	if maxPrice != "" {
		max, err := strconv.ParseFloat(maxPrice, 64)
		if err == nil {
			query += " AND w.price <= ?"
			args = append(args, max)
		}
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<html><head><title>Wares</title></head><body>")
	htmlBuilder.WriteString("<table border='1'>")
	htmlBuilder.WriteString("<tr><th>Name</th><th>Description</th><th>Price</th><th>Merchant Email</th></tr>")

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			continue
		}
		htmlBuilder.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%.2f</td><td>%s</td></tr>",
			html.EscapeString(name), html.EscapeString(description), price, html.EscapeString(email)))
	}

	htmlBuilder.WriteString("</table></body></html>")

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(htmlBuilder.String())
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

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