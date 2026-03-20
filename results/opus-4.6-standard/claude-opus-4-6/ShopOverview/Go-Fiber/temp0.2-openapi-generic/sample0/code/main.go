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
			password_hash TEXT NOT NULL
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

func getSecret() string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-change-me"
	}
	return secret
}

func generateToken(merchantID int64, email string) (string, error) {
	claims := jwt.MapClaims{
		"merchant_id": merchantID,
		"email":       email,
		"exp":         time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func parseToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	claims, err := parseToken(cookie)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	merchantID, ok := claims["merchant_id"].(float64)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	c.Locals("merchant_id", int64(merchantID))
	email, ok := claims["email"].(string)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	c.Locals("email", email)
	return c.Next()
}

func main() {
	appSecret = getSecret()
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/merchants/register", func(c *fiber.Ctx) error {
		type RegisterRequest struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Password string `json:"password"`
		}
		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}
		if req.Email == "" || req.Name == "" || req.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		_, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)", req.Email, req.Name, string(hashedPassword))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Email already registered or invalid input"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Merchant registered successfully"})
	})

	app.Post("/merchants/login", func(c *fiber.Ctx) error {
		type LoginRequest struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		var id int64
		var passwordHash string
		err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?", req.Email).Scan(&id, &passwordHash)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		tokenStr, err := generateToken(id, req.Email)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		c.Cookie(&fiber.Cookie{
			Name:     "AUTH_COOKIE",
			Value:    tokenStr,
			HTTPOnly: true,
			Secure:   false,
			SameSite: "Strict",
			Expires:  time.Now().Add(24 * time.Hour),
		})

		return c.Status(fiber.StatusOK).JSON("Login successful")
	})

	app.Post("/merchants/upload-wares", authMiddleware, func(c *fiber.Ctx) error {
		type UploadRequest struct {
			CSV string `json:"csv"`
		}
		var req UploadRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		merchantID := c.Locals("merchant_id").(int64)

		reader := csv.NewReader(strings.NewReader(req.CSV))
		records, err := reader.ReadAll()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		for _, record := range records {
			if len(record) != 3 {
				tx.Rollback()
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
			}
			name := strings.TrimSpace(record[0])
			description := strings.TrimSpace(record[1])
			priceStr := strings.TrimSpace(record[2])

			price, err := strconv.ParseFloat(priceStr, 64)
			if err != nil {
				tx.Rollback()
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format: invalid price"})
			}

			_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)", merchantID, name, description, price)
			if err != nil {
				tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Wares uploaded successfully"})
	})

	app.Get("/wares", func(c *fiber.Ctx) error {
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
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}
		defer rows.Close()

		var html strings.Builder
		html.WriteString("<!DOCTYPE html><html><head><title>Wares</title></head><body>")
		html.WriteString("<table border=\"1\"><tr><th>Name</th><th>Price</th><th>Description</th><th>Merchant Email</th></tr>")

		for rows.Next() {
			var name, description, email string
			var price float64
			if err := rows.Scan(&name, &price, &description, &email); err != nil {
				continue
			}
			escapedName := escapeHTML(name)
			escapedDescription := escapeHTML(description)
			escapedEmail := escapeHTML(email)
			html.WriteString(fmt.Sprintf("<tr><td>%s</td><td>%.2f</td><td>%s</td><td>%s</td></tr>", escapedName, price, escapedDescription, escapedEmail))
		}

		html.WriteString("</table></body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(fiber.StatusOK).SendString(html.String())
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}