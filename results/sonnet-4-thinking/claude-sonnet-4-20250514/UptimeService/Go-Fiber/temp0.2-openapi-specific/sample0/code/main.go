package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	_ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type Service struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return nil, err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS services (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		UNIQUE(service_id, token_hash)
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		return nil, err
	}

	return db, nil
}

func main() {
	db, err := initDB()
	if err != nil {
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
				"error": "An error occurred",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(cors.New())

	// Custom middleware to add additional security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// POST /heartbeat
	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request payload",
			})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request payload",
			})
		}

		tokenHash := hashToken(req.Token)
		now := time.Now()

		_, err := db.Exec(`
			INSERT OR REPLACE INTO services (service_id, token_hash, last_notification)
			VALUES (?, ?, ?)
		`, req.ServiceID, tokenHash, now)

		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	// POST /services
	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest

		if err := c.BodyParser(&req); err != nil {
			return c.JSON([]Service{})
		}

		if req.Token == "" {
			return c.JSON([]Service{})
		}

		tokenHash := hashToken(req.Token)

		rows, err := db.Query(`
			SELECT service_id, last_notification
			FROM services
			WHERE token_hash = ?
		`, tokenHash)

		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		defer rows.Close()

		var services []Service
		for rows.Next() {
			var service Service
			var lastNotification time.Time
			err := rows.Scan(&service.ServiceID, &lastNotification)
			if err != nil {
				log.Printf("Row scan error: %v", err)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Internal server error",
				})
			}
			service.LastNotification = lastNotification.Format(time.RFC3339)
			services = append(services, service)
		}

		if err = rows.Err(); err != nil {
			log.Printf("Rows iteration error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		if services == nil {
			services = []Service{}
		}

		return c.JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}