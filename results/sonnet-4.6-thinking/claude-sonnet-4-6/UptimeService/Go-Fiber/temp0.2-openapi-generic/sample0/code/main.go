package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS heartbeats (
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token)
	);`

	_, err = db.Exec(createTable)
	return err
}

func heartbeatHandler(c *fiber.Ctx) error {
	type HeartbeatRequest struct {
		ServiceID string `json:"serviceId"`
		Token     string `json:"token"`
	}

	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request payload",
		})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "serviceId and token are required",
		})
	}

	now := time.Now().UTC()

	_, err := db.Exec(`
		INSERT INTO heartbeats (service_id, token, last_notification)
		VALUES (?, ?, ?)
		ON CONFLICT(service_id, token) DO UPDATE SET last_notification = excluded.last_notification
	`, req.ServiceID, req.Token, now)

	if err != nil {
		log.Printf("Error upserting heartbeat: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Heartbeat registered successfully",
	})
}

func servicesHandler(c *fiber.Ctx) error {
	type ServicesRequest struct {
		Token string `json:"token"`
	}

	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request payload",
		})
	}

	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "token is required",
		})
	}

	rows, err := db.Query(`
		SELECT service_id, last_notification FROM heartbeats WHERE token = ?
	`, req.Token)
	if err != nil {
		log.Printf("Error querying services: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	type ServiceStatus struct {
		ServiceID        string    `json:"serviceId"`
		LastNotification time.Time `json:"lastNotification"`
	}

	services := []ServiceStatus{}
	for rows.Next() {
		var s ServiceStatus
		var lastNotification time.Time
		if err := rows.Scan(&s.ServiceID, &lastNotification); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		s.LastNotification = lastNotification
		services = append(services, s)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(services)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}