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

func init() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables()

	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-change-in-production"
	}
	jwtSecret = []byte(secret)
}

func createTables() {
	merchantTable := `
	CREATE TABLE IF NOT EXISTS merchants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password TEXT NOT NULL
	);`

	waresTable := `
	CREATE TABLE IF NOT EXISTS wares (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		merchant_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);`

	if _, err := db.Exec(merchantTable); err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(waresTable); err != nil {
		log.Fatal(err)
	}
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
	app.Get("/wares", authMiddleware, getWares)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerMerchant(c *fiber.Ctx) error {
	var input struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if input.Email == "" || input.Name == "" || input.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		input.Email, input.Name, string(hashedPassword))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func loginMerchant(c *fiber.Ctx) error {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	var merchant Merchant
	err := db.QueryRow("SELECT id, email, password FROM merchants WHERE email = ?", input.Email).
		Scan(&merchant.ID, &merchant.Email, &merchant.Password)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(input.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    tokenString,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
	})

	return c.JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(cookie, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	c.Locals("merchantID", claims.MerchantID)
	c.Locals("email", claims.Email)
	return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchantID").(int)

	var input struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid CSV format",
		})
	}

	reader := csv.NewReader(strings.NewReader(input.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid CSV format",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}
	defer tx.Rollback()

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid CSV format",
			})
		}

		name := record[0]
		description := record[1]
		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid CSV format",
			})
		}

		_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred",
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.SendString("Wares uploaded successfully")
}

func getWares(c *fiber.Ctx) error {
	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")

	query := `
		SELECT w.name, w.description, w.price, m.email 
		FROM wares w 
		JOIN merchants m ON w.merchant_id = m.id 
		WHERE 1=1`
	
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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}
	defer rows.Close()

	htmlTable := `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>`

	for rows.Next() {
		var name, description, email string
		var price float64
		if err := rows.Scan(&name, &description, &price, &email); err != nil {
			continue
		}
		htmlTable += fmt.Sprintf(`
            <tr>
                <td>%s</td>
                <td>%s</td>
                <td>%.2f</td>
                <td>%s</td>
            </tr>`,
			html.EscapeString(name),
			html.EscapeString(description),
			price,
			html.EscapeString(email))
	}

	htmlTable += `
        </tbody>
    </table>
</body>
</html>`

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlTable)
}