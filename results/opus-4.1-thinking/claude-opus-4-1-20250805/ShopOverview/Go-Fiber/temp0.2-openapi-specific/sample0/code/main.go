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

type LoginAttempt struct {
	Count    int
	LastTime time.Time
}

var (
	db               *sql.DB
	appSecret        string
	loginAttempts    = make(map[string]*LoginAttempt)
	loginAttemptsMux sync.Mutex
)

func init() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-for-development"
	}
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createMerchantsTable := `
		CREATE TABLE IF NOT EXISTS merchants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			password TEXT NOT NULL
		);
	`
	if _, err = db.Exec(createMerchantsTable); err != nil {
		return err
	}

	createWaresTable := `
		CREATE TABLE IF NOT EXISTS wares (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			merchant_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			price REAL NOT NULL,
			FOREIGN KEY (merchant_id) REFERENCES merchants(id)
		);
	`
	if _, err = db.Exec(createWaresTable); err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred processing your request",
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
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if body.Email == "" || body.Name == "" || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
		body.Email, body.Name, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func loginMerchant(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	loginAttemptsMux.Lock()
	attempt, exists := loginAttempts[body.Email]
	if exists {
		if time.Since(attempt.LastTime) < time.Minute && attempt.Count >= 5 {
			loginAttemptsMux.Unlock()
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Too many failed login attempts",
			})
		}
		if time.Since(attempt.LastTime) >= time.Minute {
			attempt.Count = 0
		}
	} else {
		loginAttempts[body.Email] = &LoginAttempt{Count: 0}
		attempt = loginAttempts[body.Email]
	}
	attempt.LastTime = time.Now()
	loginAttemptsMux.Unlock()

	var merchantID int
	var merchantEmail, merchantName, merchantPassword string
	err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?", body.Email).
		Scan(&merchantID, &merchantEmail, &merchantName, &merchantPassword)
	if err != nil {
		loginAttemptsMux.Lock()
		attempt.Count++
		loginAttemptsMux.Unlock()
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(merchantPassword), []byte(body.Password)); err != nil {
		loginAttemptsMux.Lock()
		attempt.Count++
		loginAttemptsMux.Unlock()
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid email or password",
		})
	}

	loginAttemptsMux.Lock()
	delete(loginAttempts, body.Email)
	loginAttemptsMux.Unlock()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"merchant_id": merchantID,
		"exp":         time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    tokenString,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		SameSite: "Strict",
		Secure:   false,
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

	token, err := jwt.Parse(cookie, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	merchantID, ok := claims["merchant_id"].(float64)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	c.Locals("merchant_id", int(merchantID))
	return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
	merchantID := c.Locals("merchant_id").(int)

	var body struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid CSV format",
		})
	}

	reader := csv.NewReader(strings.NewReader(body.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid CSV format",
		})
	}

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid CSV format",
			})
		}

		name := record[0]
		description := record[1]
		priceStr := record[2]

		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid CSV format",
			})
		}

		_, err = db.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
			merchantID, name, description, price)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process request",
			})
		}
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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve wares",
		})
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