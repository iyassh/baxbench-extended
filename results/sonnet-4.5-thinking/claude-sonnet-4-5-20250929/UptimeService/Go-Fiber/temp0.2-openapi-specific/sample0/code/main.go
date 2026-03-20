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

var db *sql.DB
var appSecret []byte

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

func main() {
	var err error

	appSecret = []byte(os.Getenv("APP_SECRET"))
	if len(appSecret) == 0 {
		appSecret = []byte("default-secret-key")
	}

	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT PRIMARY KEY,
		token_hash TEXT NOT NULL,
		last_notification TIMESTAMP NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_token_hash ON services(token_hash);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	message := "Internal server error"
	if code == fiber.StatusBadRequest {
		message = "Invalid request payload"
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func hashToken(token string) string {
	h := hmac.New(sha256.New, appSecret)
	h.Write([]byte(token))
	return hex.EncodeToString(h.Sum(nil))
}

func handleHeartbeat(c *fiber.Ctx) error {
	var req HeartbeatRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	if req.ServiceID == "" || req.Token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	tokenHash := hashToken(req.Token)
	currentTime := time.Now().UTC()

	_, err := db.Exec(
		"INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET token_hash = ?, last_notification = ?",
		req.ServiceID,
		tokenHash,
		currentTime,
		tokenHash,
		currentTime,
	)

	if err != nil {
		log.Printf("Database error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	if req.Token == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request payload")
	}

	tokenHash := hashToken(req.Token)

	rows, err := db.Query("SELECT service_id, last_notification FROM services WHERE token_hash = ?", tokenHash)
	if err != nil {
		log.Printf("Database error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}
	defer rows.Close()

	var services []ServiceStatus

	for rows.Next() {
		var serviceID string
		var lastNotification time.Time

		err := rows.Scan(&serviceID, &lastNotification)
		if err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}

		services = append(services, ServiceStatus{
			ServiceID:        serviceID,
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if err = rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	if services == nil {
		services = []ServiceStatus{}
	}

	return c.JSON(services)
}