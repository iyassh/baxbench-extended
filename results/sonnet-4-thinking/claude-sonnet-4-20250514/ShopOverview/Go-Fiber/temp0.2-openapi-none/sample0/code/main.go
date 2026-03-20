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
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type App struct {
	db        *sql.DB
	jwtSecret []byte
}

func main() {
	app := &App{
		jwtSecret: []byte(os.Getenv("APP_SECRET")),
	}

	if err := app.initDB(); err != nil {
		log.Fatal(err)
	}
	defer app.db.Close()

	fiberApp := fiber.New()

	fiberApp.Post("/merchants/register", app.registerMerchant)
	fiberApp.Post("/merchants/login", app.loginMerchant)
	fiberApp.Post("/merchants/upload-wares", app.uploadWares)
	fiberApp.Get("/wares", app.getWares)

	log.Fatal(fiberApp.Listen("0.0.0.0:5000"))
}

func (app *App) initDB() error {
	var err error
	app.db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	// Create merchants table
	_, err = app.db.Exec(`
        CREATE TABLE IF NOT EXISTS merchants (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    `)
	if err != nil {
		return err
	}

	// Create wares table
	_, err = app.db.Exec(`
        CREATE TABLE IF NOT EXISTS wares (
            id TEXT PRIMARY KEY,
            merchant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    `)
	return err
}

func (app *App) registerMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Email == "" || req.Name == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Generate ID
	merchantID := uuid.New().String()

	// Insert into database
	_, err = app.db.Exec(
		"INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
		merchantID, req.Email, req.Name, string(hashedPassword),
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{"error": "Email already exists"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func (app *App) loginMerchant(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Get merchant from database
	var merchant struct {
		ID           string
		PasswordHash string
	}
	err := app.db.QueryRow(
		"SELECT id, password_hash FROM merchants WHERE email = ?",
		req.Email,
	).Scan(&merchant.ID, &merchant.PasswordHash)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(merchant.PasswordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	// Create JWT token
	claims := jwt.MapClaims{
		"merchant_id": merchant.ID,
		"exp":         time.Now().Add(time.Hour * 24).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(app.jwtSecret)
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

	return c.JSON("Login successful")
}

func (app *App) uploadWares(c *fiber.Ctx) error {
	// Get merchant ID from JWT token
	merchantID, err := app.getMerchantIDFromToken(c)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var req struct {
		CSV string `json:"csv"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Parse CSV
	reader := csv.NewReader(strings.NewReader(req.CSV))
	records, err := reader.ReadAll()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
	}

	// Clear existing wares for this merchant
	_, err = app.db.Exec("DELETE FROM wares WHERE merchant_id = ?", merchantID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert new wares
	for _, record := range records {
		if len(record) != 3 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		wareID := uuid.New().String()
		_, err = app.db.Exec(
			"INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)",
			wareID, merchantID, record[0], record[1], price,
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	return c.JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func (app *App) getWares(c *fiber.Ctx) error {
	// Check authentication
	_, err := app.getMerchantIDFromToken(c)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	// Get query parameters
	minPrice := c.Query("minPrice")
	maxPrice := c.Query("maxPrice")

	// Build query
	query := `
        SELECT w.name, w.description, w.price, m.email 
        FROM wares w 
        JOIN merchants m ON w.merchant_id = m.id 
        WHERE 1=1
    `
	var args []interface{}

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

	query += " ORDER BY w.name"

	// Execute query
	rows, err := app.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	// Build HTML table
	html := `
    <table border="1">
        <thead>
            <tr>
                <th>Ware Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>
    `

	for rows.Next() {
		var name, description, email string
		var price float64
		err := rows.Scan(&name, &description, &price, &email)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		html += fmt.Sprintf(
			"<tr><td>%s</td><td>%s</td><td>%.2f</td><td>%s</td></tr>",
			name, description, price, email,
		)
	}

	html += `
        </tbody>
    </table>
    `

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func (app *App) getMerchantIDFromToken(c *fiber.Ctx) (string, error) {
	tokenString := c.Cookies("AUTH_COOKIE")
	if tokenString == "" {
		return "", fmt.Errorf("no token")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return app.jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid claims")
	}

	merchantID, ok := claims["merchant_id"].(string)
	if !ok {
		return "", fmt.Errorf("invalid merchant_id")
	}

	return merchantID, nil
}