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
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB
var appSecret string

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS services (
			service_id TEXT PRIMARY KEY,
			token_hash TEXT NOT NULL,
			last_notification DATETIME NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func hashToken(token string) string {
	h := hmac.New(sha256.New, []byte(appSecret))
	h.Write([]byte(token))
	return hex.EncodeToString(h.Sum(nil))
}

func handleHeartbeat(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	tokenHash := hashToken(req.Token)
	now := time.Now()

	_, err := db.Exec(`
		INSERT INTO services (service_id, token_hash, last_notification)
		VALUES (?, ?, ?)
		ON CONFLICT(service_id) DO UPDATE SET
			token_hash = excluded.token_hash,
			last_notification = excluded.last_notification
	`, req.ServiceID, tokenHash, now)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.SendStatus(200)
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	tokenHash := hashToken(req.Token)

	rows, err := db.Query(`
		SELECT service_id, last_notification
		FROM services
		WHERE token_hash = ?
	`, tokenHash)
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
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if err := rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if services == nil {
		services = []ServiceResponse{}
	}

	return c.JSON(services)
}