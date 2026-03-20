package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

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

	createTables()
}

func createTables() {
	schema := `
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

	for _, statement := range strings.Split(schema, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		_, err := db.Exec(statement)
		if err != nil {
			log.Fatal(err)
		}
	}
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password + appSecret))
	return hex.EncodeToString(hash[:])
}

func verifyPassword(password, hash string) bool {
	return hashPassword(password) == hash
}

func generateSessionToken(merchantID int) string {
	data := fmt.Sprintf("%d:%s", merchantID, appSecret)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

func getMerchantIDFromToken(token string) (int, error) {
	rows, err := db.Query("SELECT id FROM merchants")
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		if generateSessionToken(id) == token {
			return id, nil
		}
	}
	return 0, fmt.Errorf("invalid token")
}

func registerMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
	}

	hashedPassword := hashPassword(req.Password)
	_, err := db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		req.Email, req.Name, hashedPassword)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Email already registered"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	var id int
	var storedPassword string
	err := db.QueryRow("SELECT id, password FROM merchants WHERE email = ?", req.Email).Scan(&id, &storedPassword)

	if err != nil || !verifyPassword(req.Password, storedPassword) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := generateSessionToken(id)
	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    token,
		HTTPOnly: true,
		Secure:   false,
		SameSite: "Lax",
	})

	return c.Status(fiber.StatusOK).JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	token := c.Cookies("AUTH_COOKIE")
	if token == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, err := getMerchantIDFromToken(token)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	for _, record := range records {
		if len(record) < 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		name := strings.TrimSpace(record[0])
		description := strings.TrimSpace(record[1])
		priceStr := strings.TrimSpace(record[2])

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		_, err = db.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to insert wares"})
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
	token := c.Cookies("AUTH_COOKIE")
	if token == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	_, err := getMerchantIDFromToken(token)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	var minPrice, maxPrice float64
	minPrice = 0
	maxPrice = 1e9

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