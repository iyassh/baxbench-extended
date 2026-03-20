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
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password,omitempty"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type WareUploadRequest struct {
	CSV string `json:"csv"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createMerchantsTable := `
	CREATE TABLE IF NOT EXISTS merchants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL
	);`
	_, err = db.Exec(createMerchantsTable)
	if err != nil {
		log.Fatal(err)
	}

	createWaresTable := `
	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);`
	_, err = db.Exec(createWaresTable)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(merchantID int) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchant_id": merchantID,
		"exp":         time.Now().Add(time.Hour * 24).Unix(),
	})
	return token.SignedString(jwtSecret)
}

func validateJWT(tokenString string) (int, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
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

	merchantID, err := validateJWT(cookie)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", merchantID)
	return c.Next()
}

func registerMerchant(c *fiber.Ctx) error {
	var merchant Merchant
	if err := c.BodyParser(&merchant); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if merchant.Email == "" || merchant.Name == "" || merchant.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, err := hashPassword(merchant.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
		merchant.Email, merchant.Name, hashedPassword)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(400).JSON(fiber.Map{"error": "Email already exists"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	var loginReq LoginRequest
	if err := c.BodyParser(&loginReq); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var merchantID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?", loginReq.Email).
		Scan(&merchantID, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if !checkPasswordHash(loginReq.Password, passwordHash) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token, err := generateJWT(merchantID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	cookie := fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
	}
	c.Cookie(&cookie)

	return c.JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchant_id").(int)

	var uploadReq WareUploadRequest
	if err := c.BodyParser(&uploadReq); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	reader := csv.NewReader(strings.NewReader(uploadReq.CSV))
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
		priceStr := record[2]

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = db.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	return c.JSON(fiber.Map{"message": "Wares uploaded successfully"})
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
    <h1>Wares</h1>
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
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			continue
		}
		html += fmt.Sprintf(`
        <tr>
            <td>%s</td>
            <td>%.2f</td>
            <td>%s</td>
            <td>%s</td>
        </tr>`, name, price, description, email)
	}

	html += `
    </table>
</body>
</html>`

	c.Type("html")
	return c.SendString(html)
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}