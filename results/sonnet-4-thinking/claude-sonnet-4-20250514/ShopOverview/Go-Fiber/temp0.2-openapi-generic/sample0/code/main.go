package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"log"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

type Claims struct {
	MerchantID string `json:"merchant_id"`
	Email      string `json:"email"`
	jwt.RegisteredClaims
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UploadWaresRequest struct {
	CSV string `json:"csv"`
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	merchantTable := `
	CREATE TABLE IF NOT EXISTS merchants (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL
	);`

	waresTable := `
	CREATE TABLE IF NOT EXISTS wares (
		id TEXT PRIMARY KEY,
		merchant_id TEXT NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants (id)
	);`

	_, err = db.Exec(merchantTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(waresTable)
	if err != nil {
		log.Fatal(err)
	}
}

func generateJWT(merchantID, email string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	claims := &Claims{
		MerchantID: merchantID,
		Email:      email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func verifyJWT(tokenString string) (*Claims, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

func authRequired(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, err := verifyJWT(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", claims.MerchantID)
	c.Locals("email", claims.Email)
	return c.Next()
}

func isValidEmail(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

func registerMerchant(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if !isValidEmail(req.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	merchantID := uuid.New().String()
	_, err = db.Exec("INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
		merchantID, req.Email, req.Name, string(hashedPassword))

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).Send(nil)
}

func loginMerchant(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID, email, passwordHash string
	err := db.QueryRow("SELECT id, email, password_hash FROM merchants WHERE email = ?", req.Email).
		Scan(&merchantID, &email, &passwordHash)

	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token, err := generateJWT(merchantID, email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Strict",
	})

	return c.Status(200).JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchant_id").(string)

	var req UploadWaresRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	_, err = db.Exec("DELETE FROM wares WHERE merchant_id = ?", merchantID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		wareID := uuid.New().String()
		_, err = db.Exec("INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)",
			wareID, merchantID, name, description, price)

		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
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
	
	query += " ORDER BY w.name"

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Wares</title>
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
		</tr>`

	for rows.Next() {
		var name, description, email string
		var price float64
		err := rows.Scan(&name, &description, &price, &email)
		if err != nil {
			continue
		}

		html += fmt.Sprintf(`
		<tr>
			<td>%s</td>
			<td>%s</td>
			<td>%.2f</td>
			<td>%s</td>
		</tr>`, escapeHTML(name), escapeHTML(description), price, escapeHTML(email))
	}

	html += `
	</table>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(html)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authRequired, uploadWares)
	app.Get("/wares", authRequired, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}