package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification TEXT NOT NULL,
		PRIMARY KEY (service_id, token_hash)
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

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
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload."})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload."})
		}

		now := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec(`
			INSERT INTO services (service_id, token_hash, last_notification)
			VALUES (?, ?, ?)
			ON CONFLICT(service_id, token_hash)
			DO UPDATE SET last_notification = excluded.last_notification
		`, req.ServiceID, req.Token, now)

		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error."})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Heartbeat registered successfully."})
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error."})
		}

		if req.Token == "" {
			return c.Status(fiber.StatusOK).JSON([]ServiceStatus{})
		}

		rows, err := db.Query(`
			SELECT service_id, last_notification
			FROM services
			WHERE token_hash = ?
		`, req.Token)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error."})
		}
		defer rows.Close()

		services := make([]ServiceStatus, 0)
		for rows.Next() {
			var s ServiceStatus
			if err := rows.Scan(&s.ServiceID, &s.LastNotification); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error."})
			}
			services = append(services, s)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error."})
		}

		return c.Status(fiber.StatusOK).JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}