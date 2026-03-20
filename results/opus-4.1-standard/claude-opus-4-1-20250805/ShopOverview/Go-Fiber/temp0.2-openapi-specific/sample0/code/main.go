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
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	db              *sql.DB
	jwtSecret       []byte
	loginAttempts   = make(map[string]*attemptInfo)
	attemptsMutex   sync.RWMutex
	maxLoginAttempts = 5
	lockoutDuration = 15 * time.Minute
)

type attemptInfo struct {
	count     int
	lastAttempt time.Time
}

type Merchant struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"-"`
}

type Ware struct {
	ID          int     `json:"id"`
	MerchantID  int     `json:"merchant_id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
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
		description TEXT,
		price REAL NOT NULL,
		FOREIGN KEY (merchant_id) REFERENCES merchants(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func checkLoginAttempts(email string) bool {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	if attempt, exists := loginAttempts[email]; exists {
		if time.Since(attempt.lastAttempt) > lockoutDuration {
			delete(loginAttempts, email)
			return true
		}
		if attempt.count >= maxLoginAttempts {
			return false
		}
	}
	return true
}

func recordLoginAttempt(email string, success bool) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	if success {
		delete(loginAttempts, email)
		return
	}

	if attempt, exists := loginAttempts[email]; exists {
		attempt.count++
		attempt.lastAttempt = time.Now()
	} else {
		loginAttempts[email] = &attemptInfo{
			count:       1,
			lastAttempt: time.Now(),
		}
	}
}

func generateToken(merchantID int, email string) (string, error) {
	claims := &Claims{
		MerchantID: merchantID,
		Email:      email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return nil, err
	}

	return claims, nil
}

func authMiddleware(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, err := validateToken(cookie)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("merchantID", claims.MerchantID)
	c.Locals("email", claims.Email)
	return c.Next()
}

func setSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-for-development"
	}
	jwtSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(setSecurityHeaders)

	app.Post("/merchants/register", func(c *fiber.Ctx) error {
		var input struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Password string `json:"password"`
		}

		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		if input.Email == "" || input.Name == "" || input.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}

		_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
			input.Email, input.Name, string(hashedPassword))
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE") {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Post("/merchants/login", func(c *fiber.Ctx) error {
		var input struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		if !checkLoginAttempts(input.Email) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		var merchant Merchant
		err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?", input.Email).
			Scan(&merchant.ID, &merchant.Email, &merchant.Name, &merchant.Password)
		
		if err != nil {
			recordLoginAttempt(input.Email, false)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		err = bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(input.Password))
		if err != nil {
			recordLoginAttempt(input.Email, false)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		recordLoginAttempt(input.Email, true)

		token, err := generateToken(merchant.ID, merchant.Email)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}

		cookie := &fiber.Cookie{
			Name:     "AUTH_COOKIE",
			Value:    token,
			Expires:  time.Now().Add(24 * time.Hour),
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Strict",
		}
		c.Cookie(cookie)

		return c.Status(fiber.StatusOK).JSON("Login successful")
	})

	app.Post("/merchants/upload-wares", authMiddleware, func(c *fiber.Ctx) error {
		merchantID := c.Locals("merchantID").(int)

		var input struct {
			CSV string `json:"csv"`
		}

		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		reader := csv.NewReader(strings.NewReader(input.CSV))
		records, err := reader.ReadAll()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}
		defer tx.Rollback()

		for _, record := range records {
			if len(record) != 3 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
			}

			name := record[0]
			description := record[1]
			priceStr := record[2]

			price, err := strconv.ParseFloat(priceStr, 64)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
			}

			_, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
				merchantID, name, description, price)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}

		return c.SendStatus(fiber.StatusOK)
	})

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
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred"})
		}
		defer rows.Close()

		htmlTable := `<!DOCTYPE html>
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
    </table>
</body>
</html>`

		c.Set("Content-Type", "text/html")
		return c.SendString(htmlTable)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}