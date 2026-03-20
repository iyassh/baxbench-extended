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

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
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

	// Get JWT secret from environment
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)
}

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

func main() {
	app := fiber.New()

	// Register merchant
	app.Post("/merchants/register", func(c *fiber.Ctx) error {
		var payload struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Password string `json:"password"`
		}

		if err := c.BodyParser(&payload); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if payload.Email == "" || payload.Name == "" || payload.Password == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		// Hash password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(payload.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		// Insert merchant
		_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
			payload.Email, payload.Name, string(hashedPassword))
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
	})

	// Login merchant
	app.Post("/merchants/login", func(c *fiber.Ctx) error {
		var payload struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		if err := c.BodyParser(&payload); err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		// Find merchant
		var merchant Merchant
		err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?", payload.Email).
			Scan(&merchant.ID, &merchant.Email, &merchant.Name, &merchant.Password)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		// Check password
		err = bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(payload.Password))
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		// Create JWT token
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"merchant_id": merchant.ID,
			"email":       merchant.Email,
			"exp":         time.Now().Add(time.Hour * 24).Unix(),
		})

		tokenString, err := token.SignedString(jwtSecret)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		// Set cookie
		c.Cookie(&fiber.Cookie{
			Name:     "AUTH_COOKIE",
			Value:    tokenString,
			Expires:  time.Now().Add(time.Hour * 24),
			HTTPOnly: true,
		})

		return c.Status(200).JSON("Login successful")
	})

	// Upload wares
	app.Post("/merchants/upload-wares", authMiddleware, func(c *fiber.Ctx) error {
		merchantID := c.Locals("merchant_id").(int)

		var payload struct {
			CSV string `json:"csv"`
		}

		if err := c.BodyParser(&payload); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		// Parse CSV
		reader := csv.NewReader(strings.NewReader(payload.CSV))
		records, err := reader.ReadAll()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		// Insert wares
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
				return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
			}
		}

		return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
	})

	// Get wares
	app.Get("/wares", authMiddleware, func(c *fiber.Ctx) error {
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

		// Build HTML table
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

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(html)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	token, err := jwt.Parse(cookie, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	merchantID, ok := claims["merchant_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchant_id", int(merchantID))
	return c.Next()
}