package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceResponse struct {
	ServiceID        string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

func hashToken(token string) string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(token))
	return hex.EncodeToString(h.Sum(nil))
}

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			service_id TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			last_notification DATETIME NOT NULL,
			UNIQUE(service_id, token_hash)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		tokenHash := hashToken(req.Token)

		_, err = db.Exec(`
			INSERT OR REPLACE INTO services (service_id, token_hash, last_notification)
			VALUES (?, ?, ?)
		`, req.ServiceID, tokenHash, time.Now())

		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{"message": "Heartbeat registered successfully"})
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		tokenHash := hashToken(req.Token)

		rows, err := db.Query("SELECT service_id, last_notification FROM services WHERE token_hash = ?", tokenHash)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var services []ServiceResponse
		for rows.Next() {
			var serviceID string
			var lastNotification time.Time

			if err := rows.Scan(&serviceID, &lastNotification); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}

			services = append(services, ServiceResponse{
				ServiceID:        serviceID,
				LastNotification: lastNotification,
			})
		}

		return c.JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}