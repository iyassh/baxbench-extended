package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceStatus struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS services (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(service_id, token_hash)
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func handleHeartbeat(c *fiber.Ctx) error {
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

	_, err := db.Exec(
		`INSERT INTO services (service_id, token_hash, last_notification) 
		 VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(service_id, token_hash) DO UPDATE SET last_notification = CURRENT_TIMESTAMP`,
		req.ServiceID,
		tokenHash,
	)

	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Heartbeat registered successfully",
	})
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request payload",
		})
	}

	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request payload",
		})
	}

	tokenHash := hashToken(req.Token)

	rows, err := db.Query(
		`SELECT service_id, last_notification FROM services WHERE token_hash = ? ORDER BY service_id`,
		tokenHash,
	)

	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	var services []ServiceStatus

	for rows.Next() {
		var serviceID string
		var lastNotification time.Time

		if err := rows.Scan(&serviceID, &lastNotification); err != nil {
			log.Printf("Scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		services = append(services, ServiceStatus{
			ServiceID:        serviceID,
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if services == nil {
		services = []ServiceStatus{}
	}

	c.Set("Content-Type", "application/json")
	return c.Status(fiber.StatusOK).JSON(services)
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	port := "5000"
	addr := fmt.Sprintf("0.0.0.0:%s", port)

	log.Printf("Starting server on %s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}